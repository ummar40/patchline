import type { JobErrorCategory, JobStatus } from "@/db/generated/enums";
import { ModelProviderError } from "../agent/model/types";
import { GitError } from "../git/operations";
import { SandboxError } from "../sandbox/types";
import { detailOf } from "./context";
import {
  JobCancelledError,
  JobFailure,
  JobTimeoutError,
  NeedsHumanError,
  WorkerShutdownError,
} from "./outcomes";

export type Outcome = {
  status: "FAILED" | "NEEDS_HUMAN" | "CANCELLED";
  category: JobErrorCategory | undefined;
  summary: string;
  unexpected: boolean;
};

// Maps whatever stopped a run to a terminal status and a factual explanation for the user.
// NEEDS_HUMAN means finishing would not have been safe or correct; FAILED means something
// broke.
export function describeOutcome(reason: unknown, stoppedIn: JobStatus): Outcome {
  const outcome = classify(reason, stoppedIn);
  if (stoppedIn === "CREATING_PR") {
    outcome.summary +=
      "\nThe job stopped while publishing, so its work branch may already exist on GitHub without a pull request.";
  }
  return outcome;
}

function classify(reason: unknown, stoppedIn: JobStatus): Outcome {
  if (reason instanceof JobCancelledError) {
    return {
      status: "CANCELLED",
      category: undefined,
      summary:
        "Cancelled by a user while the job was running. The workspace was removed and nothing was pushed.",
      unexpected: false,
    };
  }
  if (reason instanceof JobTimeoutError) {
    return {
      status: "NEEDS_HUMAN",
      category: "LIMIT_EXCEEDED",
      summary: `${reason.message} Work stopped during ${stoppedIn}.`,
      unexpected: false,
    };
  }
  if (reason instanceof WorkerShutdownError) {
    return {
      status: "FAILED",
      category: "WORKER_INTERRUPTED",
      summary: `${reason.message} Nothing was pushed. Create a follow-up job to run it again.`,
      unexpected: false,
    };
  }
  if (reason instanceof NeedsHumanError) {
    return {
      status: "NEEDS_HUMAN",
      category: reason.category,
      summary: reason.message,
      unexpected: false,
    };
  }
  if (reason instanceof JobFailure) {
    return {
      status: "FAILED",
      category: reason.category,
      summary: reason.message,
      unexpected: false,
    };
  }
  if (reason instanceof ModelProviderError) {
    return {
      status: "FAILED",
      category: "MODEL_PROVIDER",
      summary: reason.message,
      unexpected: false,
    };
  }
  if (reason instanceof SandboxError || reason instanceof GitError) {
    return { status: "FAILED", category: "SANDBOX", summary: detailOf(reason), unexpected: false };
  }
  return {
    status: "FAILED",
    category: "INTERNAL",
    summary: `An unexpected error stopped the job during ${stoppedIn}: ${detailOf(reason)}`,
    unexpected: true,
  };
}
