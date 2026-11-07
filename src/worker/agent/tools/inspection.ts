import { z } from "zod";
import { captureChangeSet, runGit } from "../../git/operations";
import { REPOSITORY_DIR } from "../../sandbox/types";
import { resolveRepositoryPath } from "../path-policy";
import {
  FILE_TOOL_TIMEOUT_MS,
  MAX_LINES_PER_READ,
  defineTool,
  failure,
  readRepositoryFile,
  shorten,
} from "./shared";

const MAX_LISTED_FILES = 500;
const MAX_SEARCH_RESULTS = 200;

const listFiles = defineTool({
  spec: {
    name: "list_files",
    description:
      "List files under a directory of the repository, honouring .gitignore. Use it to learn the structure before reading files.",
    parameters: z.object({
      path: z.string().describe('Directory relative to the repository root. Use "." for the root.'),
      max_depth: z
        .number()
        .int()
        .nullable()
        .describe("How many directory levels to descend, or null for no limit."),
    }),
  },
  async execute(args, context) {
    const path = resolveRepositoryPath(args.path);
    const depth =
      args.max_depth === null
        ? []
        : ["--max-depth", String(Math.max(1, Math.min(args.max_depth, 20)))];
    const result = await context.sandbox.exec({
      argv: [
        "rg",
        "--files",
        "--hidden",
        "--glob",
        "!.git",
        "--sort",
        "path",
        ...depth,
        "--",
        path,
      ],
      workdir: REPOSITORY_DIR,
      timeoutMs: FILE_TOOL_TIMEOUT_MS,
      signal: context.signal,
    });
    if (result.exitCode !== 0 && result.stdout === "") {
      return result.exitCode === 1 ? { output: "No files." } : failure(result.stderr.trim());
    }
    const files = result.stdout.split("\n").filter(Boolean);
    const shown = files.slice(0, MAX_LISTED_FILES);
    const note =
      files.length > shown.length
        ? `\n[${files.length - shown.length} more files not shown; list a subdirectory]`
        : "";
    return { output: `${files.length} files\n${shown.join("\n")}${note}` };
  },
});

const readFile = defineTool({
  spec: {
    name: "read_file",
    description: `Read a text file from the repository with line numbers. Returns at most ${MAX_LINES_PER_READ} lines per call; request further ranges as needed.`,
    parameters: z.object({
      path: z.string().describe("File path relative to the repository root."),
      start_line: z
        .number()
        .int()
        .nullable()
        .describe("First line to return (1-based), or null for the beginning."),
      end_line: z.number().int().nullable().describe("Last line to return (inclusive), or null."),
    }),
  },
  async execute(args, context) {
    const path = resolveRepositoryPath(args.path);
    const file = await readRepositoryFile(context, path);
    if ("error" in file) {
      return failure(file.error);
    }
    const lines = file.content.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    const start = Math.max(1, args.start_line ?? 1);
    const end = Math.min(
      lines.length,
      args.end_line ?? start + MAX_LINES_PER_READ - 1,
      start + MAX_LINES_PER_READ - 1,
    );
    if (start > lines.length) {
      return failure(`${path} has ${lines.length} lines`);
    }
    const body = lines
      .slice(start - 1, end)
      .map((line, index) => `${String(start + index).padStart(6)}| ${line.replace(/\r$/, "")}`)
      .join("\n");
    const size = file.oversized
      ? " (file is larger than the read limit; later content is unavailable)"
      : "";
    return {
      output: shorten(
        `${path} lines ${start}-${end} of ${lines.length}${size}\n${body}`,
        context.maxOutputChars,
      ),
    };
  },
});

const searchText = defineTool({
  spec: {
    name: "search_text",
    description:
      "Search file contents in the repository. Returns matching lines as path:line:text.",
    parameters: z.object({
      query: z.string().describe("Text or regular expression to search for."),
      path: z
        .string()
        .describe(
          'Directory or file to search, relative to the repository root. Use "." for everything.',
        ),
      is_regex: z
        .boolean()
        .describe("True to treat the query as a regular expression, false for a literal string."),
      case_sensitive: z.boolean(),
    }),
  },
  async execute(args, context) {
    if (args.query === "" || args.query.length > 500) {
      return failure("query must be between 1 and 500 characters");
    }
    const path = resolveRepositoryPath(args.path);
    const flags = [
      "--line-number",
      "--no-heading",
      "--color",
      "never",
      "--hidden",
      "--glob",
      "!.git",
      "--max-columns",
      "300",
      "--max-count",
      "50",
      ...(args.is_regex ? [] : ["--fixed-strings"]),
      ...(args.case_sensitive ? [] : ["--ignore-case"]),
    ];
    const result = await context.sandbox.exec({
      argv: ["rg", ...flags, "-e", args.query, "--", path],
      workdir: REPOSITORY_DIR,
      timeoutMs: FILE_TOOL_TIMEOUT_MS,
      signal: context.signal,
    });
    if (result.exitCode === 1) {
      return { output: "No matches." };
    }
    if (result.exitCode !== 0) {
      return failure(result.stderr.trim() || "search failed");
    }
    const matches = result.stdout.split("\n").filter(Boolean);
    const shown = matches.slice(0, MAX_SEARCH_RESULTS);
    const note =
      matches.length > shown.length
        ? `\n[${matches.length - shown.length} more matches not shown; narrow the search]`
        : "";
    return { output: shorten(`${shown.join("\n")}${note}`, context.maxOutputChars) };
  },
});

const gitLog = defineTool({
  spec: {
    name: "git_log",
    description:
      "Show recent commit history, optionally limited to one path. History depth is limited by the clone.",
    parameters: z.object({
      path: z
        .string()
        .nullable()
        .describe("File or directory to limit history to, or null for the whole repository."),
      max_count: z.number().int().describe("Number of commits to show (1-50)."),
    }),
  },
  async execute(args, context) {
    const count = String(Math.max(1, Math.min(args.max_count, 50)));
    const scope = args.path === null ? [] : ["--", resolveRepositoryPath(args.path)];
    const result = await runGit(
      context.sandbox,
      ["log", "--no-color", "-n", count, "--date=short", "--format=%h %ad %an: %s", ...scope],
      context.signal,
    );
    return result.exitCode === 0
      ? { output: shorten(result.stdout || "No commits.", context.maxOutputChars) }
      : failure(result.stderr.trim());
  },
});

const gitShow = defineTool({
  spec: {
    name: "git_show",
    description: "Show the changes introduced by one commit, optionally limited to one path.",
    parameters: z.object({
      revision: z.string().describe("Abbreviated or full commit hash, or HEAD / HEAD~N."),
      path: z.string().nullable().describe("File to limit the output to, or null."),
    }),
  },
  async execute(args, context) {
    if (!/^(HEAD(~\d{1,3})?|[0-9a-f]{7,40})$/.test(args.revision)) {
      return failure("revision must be a commit hash, HEAD or HEAD~N");
    }
    const scope = args.path === null ? [] : ["--", resolveRepositoryPath(args.path)];
    const result = await runGit(
      context.sandbox,
      [
        "show",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--stat",
        "--patch",
        args.revision,
        ...scope,
      ],
      context.signal,
    );
    return result.exitCode === 0
      ? { output: shorten(result.stdout, context.maxOutputChars) }
      : failure(result.stderr.trim());
  },
});

const gitDiff = defineTool({
  spec: {
    name: "git_diff",
    description:
      "Show every change made in the working copy so far, relative to the commit the job started from.",
    parameters: z.object({}),
  },
  async execute(_args, context) {
    const changes = await captureChangeSet(context.sandbox, context.baseCommitSha, context.signal);
    if (changes.files.length === 0) {
      return { output: "The working copy has no changes." };
    }
    const summary = changes.files
      .map(
        (file) =>
          `${file.status} ${file.path} (+${file.additions ?? "?"} -${file.deletions ?? "?"})`,
      )
      .join("\n");
    return { output: shorten(`${summary}\n\n${changes.patch}`, context.maxOutputChars) };
  },
});

export const inspectionTools = [listFiles, readFile, searchText, gitLog, gitShow, gitDiff];
