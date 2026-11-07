import type { JobErrorCategory } from "@/db/generated/enums";

// A job that stops because finishing would not be safe or correct. The summary is shown to
// the user verbatim, so it states facts: what was attempted and what blocked it.
export class NeedsHumanError extends Error {
  constructor(
    readonly category: JobErrorCategory,
    summary: string,
  ) {
    super(summary);
    this.name = "NeedsHumanError";
  }
}

// A job that stops because something broke: infrastructure, credentials, the provider.
export class JobFailure extends Error {
  constructor(
    readonly category: JobErrorCategory,
    summary: string,
    options?: ErrorOptions,
  ) {
    super(summary, options);
    this.name = "JobFailure";
  }
}

export class JobCancelledError extends Error {
  constructor() {
    super("The job was cancelled by a user.");
    this.name = "JobCancelledError";
  }
}

export class JobTimeoutError extends Error {
  constructor(readonly limitMs: number) {
    super(`The job exceeded its time limit of ${Math.round(limitMs / 60_000)} minutes.`);
    this.name = "JobTimeoutError";
  }
}

export class WorkerShutdownError extends Error {
  constructor() {
    super("The worker process was shut down while the job was running.");
    this.name = "WorkerShutdownError";
  }
}
