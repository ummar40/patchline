import type { Implementation, Plan, Reproduction, Review } from "@/core/jobs/artifacts";
import type { VerificationCategory } from "@/db/generated/enums";
import { type ChangedFile, isSafeRefName } from "../git/operations";
import type { VerificationResult } from "../verification/run";

const MAX_SLUG_LENGTH = 40;
const MAX_SECTION_CHARS = 3_000;

const CATEGORY_LABELS: Record<VerificationCategory, string> = {
  TEST: "Tests",
  LINT: "Lint",
  TYPECHECK: "Type check",
  BUILD: "Build",
};

export function buildBranchName(prefix: string, jobId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
  const name = `${prefix}/${slug || "change"}-${jobId.slice(-8)}`;
  if (!isSafeRefName(name)) {
    throw new Error("Could not derive a safe branch name");
  }
  return name;
}

// Text written by the model or the user is placed in a pull request under the app's
// identity. Mentions are defused so that text cannot be used to notify arbitrary accounts.
function sanitize(text: string): string {
  const trimmed = text.trim().slice(0, MAX_SECTION_CHARS);
  return trimmed.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@ ");
}

export function buildCommitMessage(input: {
  title: string;
  summary: string;
  jobUrl: string;
}): string {
  return `${input.title}\n\n${input.summary.trim().slice(0, MAX_SECTION_CHARS)}\n\nMaintenance job: ${input.jobUrl}`;
}

export function buildPullRequestBody(input: {
  productName: string;
  jobUrl: string;
  requestedBy: string | undefined;
  problemDescription: string;
  reproduction: Reproduction;
  plan: Plan;
  implementation: Implementation;
  review: Review;
  files: readonly ChangedFile[];
  baseline: readonly VerificationResult[];
  candidate: readonly VerificationResult[];
  preExistingFailures: readonly VerificationCategory[];
}): string {
  const baselineByCategory = new Map(
    input.baseline.map((result) => [result.category, result.status]),
  );
  const rows = input.candidate.map(
    (result) =>
      `| ${CATEGORY_LABELS[result.category]} | \`${result.command.replace(/\|/g, "\\|")}\` | ${(baselineByCategory.get(result.category) ?? "not run").toLowerCase().replace("_", " ")} | ${result.status.toLowerCase().replace("_", " ")} |`,
  );
  const notRun = (Object.keys(CATEGORY_LABELS) as VerificationCategory[])
    .filter((category) => !input.candidate.some((result) => result.category === category))
    .map((category) => CATEGORY_LABELS[category]);
  const minorFindings = input.review.findings.map(
    (finding) =>
      `- ${finding.severity}${finding.path ? ` (\`${finding.path}\`)` : ""}: ${sanitize(finding.detail)}`,
  );

  const sections = [
    "## Problem",
    sanitize(input.problemDescription),
    "## Root cause",
    sanitize(input.plan.root_cause),
    "## Change",
    sanitize(input.implementation.summary),
    input.files.map((file) => `- \`${file.path}\` (${file.status.toLowerCase()})`).join("\n"),
    "## Reproduction",
    `${input.reproduction.status.replace("_", " ")}: ${sanitize(input.reproduction.summary)}`,
    "## Regression test",
    sanitize(input.implementation.regression_test_notes),
    "## Verification",
    "Commands were run in an isolated sandbox before the change and again after it. Exit codes decide the result.",
    ["| Check | Command | Before | After |", "| --- | --- | --- | --- |", ...rows].join("\n"),
    ...(input.preExistingFailures.length > 0
      ? [
          `Already failing before this change and not addressed here: ${input.preExistingFailures.map((category) => CATEGORY_LABELS[category]).join(", ")}.`,
        ]
      : []),
    ...(notRun.length > 0 ? [`Not available in this repository: ${notRun.join(", ")}.`] : []),
    "## Review notes",
    sanitize(input.review.summary),
    ...(minorFindings.length > 0 ? [minorFindings.join("\n")] : []),
    "---",
    `Prepared by ${input.productName}${input.requestedBy ? `, requested by ${input.requestedBy}` : ""}. Full evidence, including every command and its output: ${input.jobUrl}`,
    "This pull request was prepared automatically. It has not been merged and should be reviewed like any other change.",
  ];
  return sections.join("\n\n");
}
