import { describe, expect, it } from "vitest";
import { canTransition } from "@/core/jobs/state-machine";
import { ModelProviderError } from "../agent/model/types";
import { GitError } from "../git/operations";
import { SandboxError } from "../sandbox/types";
import { describeOutcome } from "./conclude";
import {
  JobCancelledError,
  JobFailure,
  JobTimeoutError,
  NeedsHumanError,
  WorkerShutdownError,
} from "./outcomes";

describe("describeOutcome", () => {
  it("treats a user cancellation as CANCELLED without an error category", () => {
    expect(describeOutcome(new JobCancelledError(), "ANALYZING")).toMatchObject({
      status: "CANCELLED",
      category: undefined,
      unexpected: false,
    });
  });

  it("keeps the category and the explanation of a deliberate stop", () => {
    const outcome = describeOutcome(
      new NeedsHumanError("VERIFICATION_FAILED", "Tests still fail after 3 repair attempt(s)."),
      "VERIFYING",
    );
    expect(outcome).toEqual({
      status: "NEEDS_HUMAN",
      category: "VERIFICATION_FAILED",
      summary: "Tests still fail after 3 repair attempt(s).",
      unexpected: false,
    });
  });

  it("separates broken infrastructure from work that needs a person", () => {
    expect(
      describeOutcome(new JobFailure("CLONE_FAILED", "Clone failed"), "CLONING"),
    ).toMatchObject({
      status: "FAILED",
      category: "CLONE_FAILED",
    });
    expect(describeOutcome(new SandboxError("docker is down"), "PREPARING")).toMatchObject({
      status: "FAILED",
      category: "SANDBOX",
    });
    expect(
      describeOutcome(new GitError("Reading patch failed", "fatal: bad object"), "VERIFYING"),
    ).toMatchObject({
      status: "FAILED",
      category: "SANDBOX",
      summary: "Reading patch failed: fatal: bad object",
    });
    expect(
      describeOutcome(
        new ModelProviderError("Model request failed (authentication)", "authentication", 0, 12),
        "PLANNING",
      ),
    ).toMatchObject({ status: "FAILED", category: "MODEL_PROVIDER" });
  });

  it("reports limits and interruptions with where the job was", () => {
    expect(describeOutcome(new JobTimeoutError(3_600_000), "IMPLEMENTING")).toMatchObject({
      status: "NEEDS_HUMAN",
      category: "LIMIT_EXCEEDED",
      summary: "The job exceeded its time limit of 60 minutes. Work stopped during IMPLEMENTING.",
    });
    expect(describeOutcome(new WorkerShutdownError(), "REVIEWING")).toMatchObject({
      status: "FAILED",
      category: "WORKER_INTERRUPTED",
    });
  });

  it("flags anything unrecognised as an internal error and redacts its message", () => {
    const token = `ghs_${"x".repeat(36)}`;
    const outcome = describeOutcome(new TypeError(`cannot read ${token}`), "ANALYZING");
    expect(outcome).toMatchObject({ status: "FAILED", category: "INTERNAL", unexpected: true });
    expect(outcome.summary).not.toContain(token);
    expect(describeOutcome("a thrown string", "PLANNING").category).toBe("INTERNAL");
  });

  it("warns that a branch may exist when publishing was interrupted", () => {
    const outcome = describeOutcome(
      new JobFailure("PUBLISH_FAILED", "The branch could not be pushed."),
      "CREATING_PR",
    );
    expect(outcome.summary).toMatch(/may already exist on GitHub/);
    expect(describeOutcome(new JobFailure("CLONE_FAILED", "x"), "CLONING").summary).not.toMatch(
      /GitHub/,
    );
  });

  it("only produces outcomes the state machine can reach, given the FAILED fallback", () => {
    const reasons = [
      new JobCancelledError(),
      new NeedsHumanError("AGENT_ESCALATION", "x"),
      new JobFailure("INTERNAL", "x"),
    ];
    for (const stoppedIn of ["PREPARING", "CLONING", "IMPLEMENTING", "CREATING_PR"] as const) {
      for (const reason of reasons) {
        const { status } = describeOutcome(reason, stoppedIn);
        expect(canTransition(stoppedIn, status) || canTransition(stoppedIn, "FAILED")).toBe(true);
      }
    }
  });
});
