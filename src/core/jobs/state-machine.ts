import type { JobStatus } from "@/db/generated/enums";

export const TERMINAL_STATUSES = [
  "COMPLETED",
  "FAILED",
  "NEEDS_HUMAN",
  "CANCELLED",
] as const satisfies readonly JobStatus[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

// The pipeline order. VERIFYING and REVIEWING may loop back to IMPLEMENTING for another
// repair iteration; every other step only moves forward.
const FORWARD: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ["PREPARING"],
  PREPARING: ["CLONING"],
  CLONING: ["ANALYZING"],
  ANALYZING: ["REPRODUCING"],
  REPRODUCING: ["PLANNING"],
  PLANNING: ["IMPLEMENTING"],
  IMPLEMENTING: ["VERIFYING"],
  VERIFYING: ["IMPLEMENTING", "REVIEWING"],
  REVIEWING: ["IMPLEMENTING", "CREATING_PR"],
  CREATING_PR: ["COMPLETED"],
  COMPLETED: [],
  FAILED: [],
  NEEDS_HUMAN: [],
  CANCELLED: [],
};

export function isTerminal(status: JobStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly JobStatus[]).includes(status);
}

// Once publishing starts the branch may already exist on GitHub, so the job runs to
// completion instead of leaving a half-published change behind.
export function isCancellable(status: JobStatus): boolean {
  return !isTerminal(status) && status !== "CREATING_PR";
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (isTerminal(from) || from === to) {
    return false;
  }
  switch (to) {
    case "FAILED":
      return true;
    case "CANCELLED":
      return isCancellable(from);
    case "NEEDS_HUMAN":
      return from !== "QUEUED";
    default:
      return FORWARD[from].includes(to);
  }
}

export function allowedSources(to: JobStatus): JobStatus[] {
  return (Object.keys(FORWARD) as JobStatus[]).filter((from) => canTransition(from, to));
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Job cannot move from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}
