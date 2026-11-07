import { z } from "zod";

// Structured results written by the worker and rendered by the job page. The same schemas
// define the model's submit_* tool parameters, so what the model may say, what is stored and
// what the UI expects cannot drift apart.

const text = (description: string) => z.string().describe(description);
const nullableCommand = (description: string) => z.string().nullable().describe(description);

export const verificationCommandsSchema = z.object({
  test: nullableCommand(
    "Command that runs the automated tests, or null if the repository has none.",
  ),
  lint: nullableCommand("Command that runs the linter, or null."),
  typecheck: nullableCommand("Command that runs static type checking, or null."),
  build: nullableCommand("Command that builds the project, or null."),
});
export type VerificationCommands = z.output<typeof verificationCommandsSchema>;

export const analysisSchema = z.object({
  summary: text("How the repository is organised, in relation to the reported problem."),
  languages: z.array(z.string()).describe("Primary programming languages."),
  package_manager: z.string().nullable().describe("Package or build system in use, or null."),
  commands: verificationCommandsSchema,
  relevant_files: z
    .array(
      z.object({
        path: text("Repository-relative path."),
        reason: text("Why it matters for this problem."),
      }),
    )
    .describe("Files most likely involved in the problem."),
  conventions: z
    .string()
    .nullable()
    .describe(
      "Contribution rules found in AGENTS.md, CONTRIBUTING, README or configuration, or null.",
    ),
});
export type Analysis = z.output<typeof analysisSchema>;

export const reproductionSchema = z.object({
  status: z
    .enum(["reproduced", "not_reproduced", "not_attempted"])
    .describe("Whether the reported problem was observed in the sandbox."),
  summary: text("What was tried and what was observed. Facts only."),
  evidence_command_id: z
    .string()
    .nullable()
    .describe("The command_id of the run_command call that demonstrates the problem, or null."),
});
export type Reproduction = z.output<typeof reproductionSchema>;

export const planSchema = z.object({
  root_cause: text("The most likely root cause, with the evidence for it."),
  approach: text("The smallest change that fixes the root cause."),
  files_to_change: z
    .array(
      z.object({
        path: text("Repository-relative path."),
        change: text("What will change in this file."),
      }),
    )
    .describe("Every file the change is expected to touch."),
  regression_test: z
    .string()
    .nullable()
    .describe("The regression test to add or update, or null with the reason stated in risks."),
  risks: z.string().nullable().describe("Risks, open questions or side effects, or null."),
});
export type Plan = z.output<typeof planSchema>;

export const implementationSchema = z.object({
  summary: text("What was changed and why, suitable for a pull request description."),
  regression_test_added: z.boolean().describe("Whether a regression test was added or updated."),
  regression_test_notes: text("Which test covers the fix, or why none was appropriate."),
});
export type Implementation = z.output<typeof implementationSchema>;

export const reviewSchema = z.object({
  verdict: z
    .enum(["approve", "request_changes", "escalate"])
    .describe(
      "approve: safe to open a pull request. request_changes: fixable problems. escalate: needs a person.",
    ),
  summary: text("Overall assessment of the diff against the reported problem."),
  findings: z
    .array(
      z.object({
        severity: z.enum(["blocker", "major", "minor"]),
        path: z.string().nullable().describe("File the finding refers to, or null."),
        detail: text("What is wrong and what should change."),
      }),
    )
    .describe("Specific problems found. Empty when there are none."),
});
export type Review = z.output<typeof reviewSchema>;

export const detectionSchema = z.object({
  ecosystems: z.array(z.string()),
  packageManager: z.string().nullable(),
  installCommands: z.array(z.string()),
  candidateCommands: verificationCommandsSchema,
  instructionFiles: z.array(z.string()),
  ciFiles: z.array(z.string()),
});
export type Detection = z.output<typeof detectionSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  status: z.enum(["ADDED", "MODIFIED", "DELETED"]),
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
});
export type ChangedFileSummary = z.output<typeof changedFileSchema>;
