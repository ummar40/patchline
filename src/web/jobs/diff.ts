export type DiffLine = {
  kind: "context" | "add" | "remove" | "hunk" | "note";
  text: string;
  oldNumber?: number;
  newNumber?: number;
};

export type DiffFile = {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED";
  binary: boolean;
  additions: number;
  deletions: number;
  lines: DiffLine[];
};

const FILE_HEADER = /^diff --git a\/(.*) b\/(.*)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function unquote(path: string): string {
  return path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;
}

// Parses `git diff` output as produced by the worker (no renames, no colour).
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;

  for (const line of patch.split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      current = {
        path: unquote(header[2] ?? header[1] ?? ""),
        status: "MODIFIED",
        binary: false,
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) {
      continue;
    }

    if (!inHunk) {
      if (line.startsWith("new file mode")) {
        current.status = "ADDED";
      } else if (line.startsWith("deleted file mode")) {
        current.status = "DELETED";
      } else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
        current.binary = true;
      }
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      inHunk = true;
      current.lines.push({ kind: "hunk", text: line });
      continue;
    }
    if (!inHunk || current.binary) {
      continue;
    }

    if (line.startsWith("+")) {
      current.additions += 1;
      current.lines.push({ kind: "add", text: line.slice(1), newNumber });
      newNumber += 1;
    } else if (line.startsWith("-")) {
      current.deletions += 1;
      current.lines.push({ kind: "remove", text: line.slice(1), oldNumber });
      oldNumber += 1;
    } else if (line.startsWith("\\")) {
      current.lines.push({ kind: "note", text: line.slice(2) });
    } else if (line.startsWith(" ") || line === "") {
      current.lines.push({ kind: "context", text: line.slice(1), oldNumber, newNumber });
      oldNumber += 1;
      newNumber += 1;
    }
  }

  for (const file of files) {
    while (file.lines.at(-1)?.kind === "context" && file.lines.at(-1)?.text === "") {
      file.lines.pop();
    }
  }
  return files;
}
