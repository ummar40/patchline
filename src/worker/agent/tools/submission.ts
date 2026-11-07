import { z } from "zod";
import {
  analysisSchema,
  implementationSchema,
  planSchema,
  reproductionSchema,
  reviewSchema,
} from "@/core/jobs/artifacts";
import { evaluateCommand } from "../command-policy";
import { type AgentTool, type Submission, defineTool, failure } from "./shared";

function submitTool<Schema extends z.ZodType>(
  name: string,
  description: string,
  parameters: Schema,
  kind: Submission["kind"],
  check?: (value: z.output<Schema>) => string | undefined,
): AgentTool {
  return defineTool({
    spec: { name, description, parameters },
    execute(value) {
      const problem = check?.(value);
      return Promise.resolve(
        problem
          ? failure(problem)
          : { output: "Recorded.", submission: { kind, value } as Submission },
      );
    },
  });
}

// The platform runs these commands itself later, outside the model's control, so they are
// held to the same policy as commands the model runs directly.
function checkVerificationCommands(analysis: z.output<typeof analysisSchema>): string | undefined {
  for (const [name, command] of Object.entries(analysis.commands)) {
    if (command !== null) {
      const verdict = evaluateCommand(command);
      if (!verdict.allowed) {
        return `the ${name} command is not permitted: ${verdict.reason}`;
      }
    }
  }
  return undefined;
}

export const submissionTools = [
  submitTool(
    "submit_analysis",
    "Finish the analysis phase. Report only commands you have confirmed exist in this repository.",
    analysisSchema,
    "analysis",
    checkVerificationCommands,
  ),
  submitTool(
    "submit_reproduction",
    "Finish the reproduction phase with what was observed.",
    reproductionSchema,
    "reproduction",
  ),
  submitTool("submit_plan", "Finish the planning phase with the repair plan.", planSchema, "plan"),
  submitTool(
    "submit_implementation",
    "Finish the implementation phase. The platform then runs the verification commands itself.",
    implementationSchema,
    "implementation",
  ),
  submitTool(
    "submit_review",
    "Finish the review with a verdict on the diff.",
    reviewSchema,
    "review",
  ),
  submitTool(
    "request_human",
    "Stop and hand the job to a person. Use this when the task cannot be completed safely or correctly: missing information, a change outside the permitted scope, a needed dependency change, or a problem that cannot be fixed in code.",
    z.object({
      reason: z
        .string()
        .describe("Factual explanation of what blocks progress and what a person should do."),
    }),
    "human",
  ),
];
