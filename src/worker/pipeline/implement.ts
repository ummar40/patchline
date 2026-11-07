import type { Analysis, Implementation, Plan, Reproduction, Review } from "@/core/jobs/artifacts";
import type { VerificationCategory } from "@/db/generated/enums";
import {
  REVIEW_INSTRUCTION,
  phaseInstruction,
  repairInstruction,
  reviewTask,
} from "../agent/prompts";
import type { AgentSession } from "../agent/session";
import { shorten } from "../agent/tools";
import { type ChangeSet, captureChangeSet } from "../git/operations";
import { type CategoryEvidence, evaluateGate } from "../verification/policy";
import {
  type VerificationResult,
  describeFailures,
  describeResults,
  runVerification,
} from "../verification/run";
import { checkChangeSet } from "./changeset-policy";
import type { RunContext } from "./context";
import { NeedsHumanError } from "./outcomes";

const REVIEW_PATCH_CHARS = 60_000;

export type Groundwork = {
  analysis: Analysis;
  reproduction: Reproduction;
  plan: Plan;
  baseline: VerificationResult[];
};

export type AcceptedChange = {
  implementation: Implementation;
  review: Review;
  changes: ChangeSet;
  candidate: VerificationResult[];
  preExistingFailures: VerificationCategory[];
};

const listFindings = (review: Review) =>
  review.findings
    .map(
      (finding) =>
        `- ${finding.severity}${finding.path ? ` ${finding.path}` : ""}: ${finding.detail}`,
    )
    .join("\n");

// IMPLEMENTING -> VERIFYING -> REVIEWING, repeated until the change is accepted or the repair
// budget is spent. Round 1 is the implementation; every later round is a repair attempt.
export async function implementUntilAccepted(
  run: RunContext,
  session: AgentSession,
  groundwork: Groundwork,
): Promise<AcceptedChange> {
  const { config } = run.deps;
  const maxRepairs = config.agent.maxRepairIterations;
  let instruction = phaseInstruction("IMPLEMENTING");

  for (let round = 1; ; round += 1) {
    const repairsUsed = round - 1;
    const repairsLeftAfterNext = maxRepairs - repairsUsed - 1;
    const exhausted = repairsUsed >= maxRepairs;

    await run.enter(
      "IMPLEMENTING",
      round === 1 ? "Implementing the change" : `Repair attempt ${repairsUsed} of ${maxRepairs}`,
    );
    await run.recorder.setRepairIterations(repairsUsed);
    session.addInstruction(instruction);
    const implementation = await session.runPhase("IMPLEMENTING", "implementation");
    await run.recorder.jsonArtifact(
      "IMPLEMENTATION",
      `implementation-${round}.json`,
      implementation,
    );

    await run.enter("VERIFYING", "Running the repository's verification commands");
    // This exact patch is what gets verified, reviewed and published.
    const changes = await captureChangeSet(run.sandbox, run.baseCommitSha, run.signal);
    await run.storePatch(changes);
    if (changes.files.length === 0) {
      if (exhausted) {
        throw new NeedsHumanError(
          "MODEL_BEHAVIOR",
          "The implementation phase finished without changing any file, so there is nothing to propose.",
        );
      }
      instruction = repairInstruction(
        "empty",
        "Make the planned change, or call request_human if no code change is appropriate.",
        repairsLeftAfterNext,
      );
      continue;
    }
    const policy = checkChangeSet(changes, config.changeset);
    if (!policy.ok) {
      throw new NeedsHumanError("POLICY_VIOLATION", policy.reason);
    }

    const candidate = await runVerification(run.sandbox, run.recorder, {
      commands: groundwork.analysis.commands,
      stage: "CANDIDATE",
      iteration: round,
      phase: "VERIFYING",
      timeoutMs: config.sandbox.commandTimeoutMs,
      signal: run.signal,
    });
    const evidence: CategoryEvidence[] = candidate.map((result) => ({
      category: result.category,
      baseline:
        groundwork.baseline.find((item) => item.category === result.category)?.status ?? null,
      candidate: result.status,
    }));
    const gate = evaluateGate(evidence);

    if (gate.verdict === "no_evidence") {
      throw new NeedsHumanError(
        "NO_VERIFICATION",
        "None of the repository's verification commands passes, before or after the change, so there is no evidence that the change is correct.",
      );
    }
    if (gate.verdict === "fail") {
      if (exhausted) {
        throw new NeedsHumanError(
          "VERIFICATION_FAILED",
          `Verification still fails after ${maxRepairs} repair attempt(s): ${gate.blocking.join(", ")}. The latest diff and all command output are recorded on this job.`,
        );
      }
      await run.recorder.event(
        "DECISION",
        `Verification failed: ${gate.blocking.join(", ")}`,
        { round },
        "WARN",
      );
      instruction = repairInstruction(
        "verification",
        describeFailures(candidate, gate.blocking),
        repairsLeftAfterNext,
      );
      continue;
    }

    await run.enter("REVIEWING", "Reviewing the diff");
    const review = await reviewChange(run, { ...groundwork, implementation, changes, candidate });
    await run.recorder.jsonArtifact("REVIEW", `review-${round}.json`, review);
    await run.recorder.event("DECISION", `Review verdict: ${review.verdict}`, {
      round,
      findings: review.findings.length,
    });

    if (review.verdict === "approve") {
      return {
        implementation,
        review,
        changes,
        candidate,
        preExistingFailures: gate.preExistingFailures,
      };
    }
    if (review.verdict === "escalate" || exhausted) {
      throw new NeedsHumanError(
        "REVIEW_REJECTED",
        `The diff review did not approve the change. ${review.summary}\n${listFindings(review)}`,
      );
    }
    instruction = repairInstruction(
      "review",
      `${review.summary}\n${listFindings(review)}`,
      repairsLeftAfterNext,
    );
  }
}

// A separate conversation: the reviewer sees the captured patch and the platform's
// verification results, not the author's reasoning, and has read-only tools.
async function reviewChange(
  run: RunContext,
  input: Groundwork & {
    implementation: Implementation;
    changes: ChangeSet;
    candidate: VerificationResult[];
  },
): Promise<Review> {
  const session = run.createSession("review");
  session.addTask(
    reviewTask({
      title: run.job.title,
      problemDescription: run.job.problemDescription,
      expectedBehavior: run.job.expectedBehavior,
      analysis: input.analysis,
      reproduction: input.reproduction,
      plan: input.plan,
      implementation: input.implementation,
      verificationSummary: describeResults(input.candidate),
      changedFiles: input.changes.files.map((file) => `${file.status} ${file.path}`).join("\n"),
      patch: shorten(input.changes.patch, REVIEW_PATCH_CHARS),
    }),
  );
  session.addInstruction(REVIEW_INSTRUCTION);
  return session.runPhase("REVIEWING", "review");
}
