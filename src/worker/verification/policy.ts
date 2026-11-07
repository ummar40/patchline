import type { VerificationCategory, VerificationStatus } from "@/db/generated/enums";

export type CategoryEvidence = {
  category: VerificationCategory;
  // null means the category did not run at that stage.
  baseline: VerificationStatus | null;
  candidate: VerificationStatus | null;
};

export type GateDecision =
  | { verdict: "pass"; passed: VerificationCategory[]; preExistingFailures: VerificationCategory[] }
  | {
      verdict: "fail";
      blocking: VerificationCategory[];
      preExistingFailures: VerificationCategory[];
    }
  | { verdict: "no_evidence"; preExistingFailures: VerificationCategory[] };

// Decides whether verification results support opening a pull request.
//  - Tests must pass after the change whenever the repository has tests.
//  - Lint, type check and build must not get worse: a category that already failed before
//    the change is reported as pre-existing instead of blocking.
//  - At least one category has to pass, otherwise nothing supports the change.
export function evaluateGate(evidence: readonly CategoryEvidence[]): GateDecision {
  const ran = evidence.filter((item) => item.candidate !== null);
  const passed = ran.filter((item) => item.candidate === "PASSED").map((item) => item.category);
  const failing = ran.filter((item) => item.candidate !== "PASSED");

  const preExistingFailures = failing
    .filter(
      (item) => item.category !== "TEST" && item.baseline !== null && item.baseline !== "PASSED",
    )
    .map((item) => item.category);
  const blocking = failing
    .map((item) => item.category)
    .filter((category) => !preExistingFailures.includes(category));

  if (blocking.length > 0) {
    return { verdict: "fail", blocking, preExistingFailures };
  }
  if (passed.length === 0) {
    return { verdict: "no_evidence", preExistingFailures };
  }
  return { verdict: "pass", passed, preExistingFailures };
}
