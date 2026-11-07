import type { ToolSpec } from "../model/types";
import { PathPolicyError } from "../path-policy";
import { executionTools } from "./execution";
import { inspectionTools } from "./inspection";
import { mutationTools } from "./mutation";
import { type AgentTool, type ToolContext, type ToolOutcome, failure } from "./shared";
import { submissionTools } from "./submission";

export { shorten } from "./shared";
export type { Submission, ToolContext, ToolOutcome } from "./shared";

const TOOLS: readonly AgentTool[] = [
  ...inspectionTools,
  ...executionTools,
  ...mutationTools,
  ...submissionTools,
];

// The list sent to the model never changes during a job, which keeps the prompt cache
// warm. What a phase may actually call is narrowed separately.
export const TOOL_SPECS: readonly ToolSpec[] = TOOLS.map((tool) => tool.spec);

const INSPECTION = inspectionTools.map((tool) => tool.spec.name);
const EXECUTION = executionTools.map((tool) => tool.spec.name);
const MUTATION = mutationTools.map((tool) => tool.spec.name);

export type AgentPhase = "ANALYZING" | "REPRODUCING" | "PLANNING" | "IMPLEMENTING" | "REVIEWING";

export const PHASE_TOOLS: Record<AgentPhase, readonly string[]> = {
  ANALYZING: [...INSPECTION, ...EXECUTION, "submit_analysis", "request_human"],
  REPRODUCING: [...INSPECTION, ...EXECUTION, ...MUTATION, "submit_reproduction", "request_human"],
  PLANNING: [...INSPECTION, ...EXECUTION, "submit_plan", "request_human"],
  IMPLEMENTING: [
    ...INSPECTION,
    ...EXECUTION,
    ...MUTATION,
    "submit_implementation",
    "request_human",
  ],
  // The reviewer judges a captured patch. It cannot run or change anything.
  REVIEWING: [...INSPECTION, "read_command_output", "submit_review"],
};

// Validates and dispatches one model tool call. The phase check is enforced here as well as
// through tool_choice, so a model that ignores the restriction still cannot act outside it.
export async function executeToolCall(
  call: { name: string; arguments: string },
  phase: AgentPhase,
  context: ToolContext,
): Promise<ToolOutcome> {
  const tool = TOOLS.find((candidate) => candidate.spec.name === call.name);
  if (!tool) {
    return failure(`unknown tool ${call.name}`);
  }
  if (!PHASE_TOOLS[phase].includes(call.name)) {
    return failure(`${call.name} is not available during the ${phase.toLowerCase()} phase`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments);
  } catch {
    return failure("arguments are not valid JSON");
  }
  const parsed = tool.spec.parameters.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`,
    );
    return failure(`invalid arguments: ${issues.join("; ")}`);
  }

  try {
    return await tool.execute(parsed.data, context);
  } catch (error) {
    if (error instanceof PathPolicyError) {
      return failure(error.message);
    }
    throw error;
  }
}
