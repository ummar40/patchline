import { z } from "zod";
import { runShellCommand } from "../../pipeline/commands";
import { evaluateCommand } from "../command-policy";
import { MAX_LINES_PER_READ, defineTool, failure, shorten } from "./shared";

const runCommand = defineTool({
  spec: {
    name: "run_command",
    description:
      "Run a shell command in the repository root inside the sandbox. There is no network access. Use it to run tests, builds, linters or small scripts. Dependencies are already installed; installing or changing them is not possible.",
    parameters: z.object({
      command: z.string().describe("A single shell command line. Pipes and && are allowed."),
      purpose: z.string().describe("One sentence on why this command is being run."),
      timeout_seconds: z
        .number()
        .int()
        .nullable()
        .describe("Time limit in seconds, or null for the default."),
    }),
  },
  async execute(args, context) {
    const verdict = evaluateCommand(args.command);
    if (!verdict.allowed) {
      await context.recorder.event(
        "TOOL_CALL",
        "Command rejected by policy",
        { command: args.command, reason: verdict.reason },
        "WARN",
      );
      return failure(`command not permitted: ${verdict.reason}`);
    }
    const timeoutMs = Math.min(
      context.commandTimeoutMs,
      args.timeout_seconds === null
        ? context.commandTimeoutMs
        : Math.max(1, args.timeout_seconds) * 1000,
    );
    const result = await runShellCommand(context.sandbox, context.recorder, {
      command: args.command,
      purpose: args.purpose,
      source: "AGENT",
      phase: context.phase,
      timeoutMs,
      signal: context.signal,
    });
    const status = result.timedOut
      ? `timed out after ${Math.round(timeoutMs / 1000)}s`
      : `exit_code: ${result.exitCode}`;
    const header = `command_id: ${result.commandId}\n${status}\nduration_ms: ${result.durationMs}`;
    const budget = Math.max(2_000, context.maxOutputChars - header.length - 200);
    const body = shorten(result.output, budget);
    const hint =
      body.length < result.output.length
        ? "\n[use read_command_output with this command_id to see more]"
        : "";
    return {
      output: `${header}\noutput:\n${body}${hint}`,
      failed: result.timedOut || result.exitCode !== 0,
      fingerprint: `${args.command}\n${result.timedOut ? "timeout" : result.exitCode}`,
    };
  },
});

const readCommandOutput = defineTool({
  spec: {
    name: "read_command_output",
    description:
      "Read more of the stored output of an earlier run_command call, by line range or by filtering for a substring.",
    parameters: z.object({
      command_id: z.string(),
      start_line: z.number().int().nullable().describe("First line to return (1-based), or null."),
      max_lines: z
        .number()
        .int()
        .nullable()
        .describe(`Number of lines to return (up to ${MAX_LINES_PER_READ}), or null.`),
      contains: z
        .string()
        .nullable()
        .describe("Only return lines containing this text (case-insensitive), or null."),
    }),
  },
  async execute(args, context) {
    const output = await context.recorder.commandOutput(args.command_id);
    if (output === null) {
      return failure("unknown command_id");
    }
    const numbered = output.split("\n").map((line, index) => ({ number: index + 1, line }));
    const needle = args.contains?.toLowerCase();
    const filtered = needle
      ? numbered.filter(({ line }) => line.toLowerCase().includes(needle))
      : numbered;
    const start = Math.max(1, args.start_line ?? 1);
    const limit = Math.max(1, Math.min(args.max_lines ?? MAX_LINES_PER_READ, MAX_LINES_PER_READ));
    const body = filtered
      .filter(({ number }) => number >= start)
      .slice(0, limit)
      .map(({ number, line }) => `${String(number).padStart(6)}| ${line}`)
      .join("\n");
    return {
      output: shorten(
        `${numbered.length} lines total, ${filtered.length} selected\n${body}`,
        context.maxOutputChars,
      ),
    };
  },
});

export const executionTools = [runCommand, readCommandOutput];
