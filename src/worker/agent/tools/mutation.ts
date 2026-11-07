import { z } from "zod";
import { REPOSITORY_DIR } from "../../sandbox/types";
import { resolveWritablePath } from "../path-policy";
import {
  FILE_TOOL_TIMEOUT_MS,
  MAX_WRITE_BYTES,
  defineTool,
  failure,
  readRepositoryFile,
  writeRepositoryFile,
} from "./shared";

const writeFile = defineTool({
  spec: {
    name: "write_file",
    description:
      "Create a file, or replace the whole content of an existing file. Prefer edit_file for changes to existing files.",
    parameters: z.object({
      path: z.string().describe("File path relative to the repository root."),
      content: z.string().describe("Complete new content of the file."),
    }),
  },
  async execute(args, context) {
    const path = resolveWritablePath(args.path);
    if (Buffer.byteLength(args.content) > MAX_WRITE_BYTES) {
      return failure(`content is larger than ${MAX_WRITE_BYTES} bytes`);
    }
    const problem = await writeRepositoryFile(context, path, args.content);
    return problem
      ? failure(problem)
      : { output: `Wrote ${path} (${args.content.split("\n").length} lines).`, mutated: true };
  },
});

const editFile = defineTool({
  spec: {
    name: "edit_file",
    description:
      "Replace an exact piece of text in an existing file. old_text must match the file exactly, including indentation, and must be unique unless replace_all is true. Include enough surrounding lines to make it unique.",
    parameters: z.object({
      path: z.string().describe("File path relative to the repository root."),
      old_text: z.string().describe("Exact text to replace."),
      new_text: z.string().describe("Replacement text."),
      replace_all: z
        .boolean()
        .describe("Replace every occurrence instead of requiring a unique match."),
    }),
  },
  async execute(args, context) {
    const path = resolveWritablePath(args.path);
    if (args.old_text === "" || args.old_text === args.new_text) {
      return failure("old_text must be non-empty and differ from new_text");
    }
    const file = await readRepositoryFile(context, path);
    if ("error" in file) {
      return failure(file.error);
    }
    if (file.oversized) {
      return failure("file is too large to edit with this tool");
    }

    // Files with Windows line endings are matched with the endings the file actually uses,
    // so an edit never rewrites every line of the file.
    const usesCrlf = file.content.includes("\r\n");
    const adapt = (text: string) => (usesCrlf ? text.replace(/\r?\n/g, "\r\n") : text);
    const oldText = adapt(args.old_text);
    const occurrences = file.content.split(oldText).length - 1;
    if (occurrences === 0) {
      return failure("old_text was not found. Read the file again and copy the text exactly");
    }
    if (occurrences > 1 && !args.replace_all) {
      return failure(
        `old_text matches ${occurrences} places. Add surrounding lines or set replace_all`,
      );
    }
    const updated = file.content.split(oldText).join(adapt(args.new_text));
    if (Buffer.byteLength(updated) > MAX_WRITE_BYTES * 2) {
      return failure("resulting file would be too large");
    }
    const problem = await writeRepositoryFile(context, path, updated);
    return problem
      ? failure(problem)
      : {
          output: `Edited ${path} (${occurrences} replacement${occurrences === 1 ? "" : "s"}).`,
          mutated: true,
        };
  },
});

const deleteFile = defineTool({
  spec: {
    name: "delete_file",
    description: "Delete a file from the repository.",
    parameters: z.object({
      path: z.string().describe("File path relative to the repository root."),
    }),
  },
  async execute(args, context) {
    const path = resolveWritablePath(args.path);
    const result = await context.sandbox.exec({
      argv: ["rm", "--", `${REPOSITORY_DIR}/${path}`],
      timeoutMs: FILE_TOOL_TIMEOUT_MS,
      signal: context.signal,
    });
    return result.exitCode === 0
      ? { output: `Deleted ${path}.`, mutated: true }
      : failure(result.stderr.trim());
  },
});

export const mutationTools = [writeFile, editFile, deleteFile];
