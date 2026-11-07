import { type DiffFile, parseUnifiedDiff } from "@/web/jobs/diff";
import { Badge } from "../ui/badge";
import { cn } from "../ui/cn";
import { EmptyState, Panel } from "../ui/layout";

const MAX_RENDERED_LINES_PER_FILE = 600;

const statusTone = { ADDED: "success", MODIFIED: "info", DELETED: "danger" } as const;
const statusLabel = { ADDED: "Added", MODIFIED: "Modified", DELETED: "Deleted" } as const;

function FileDiff({ file }: { file: DiffFile }) {
  const lines = file.lines.slice(0, MAX_RENDERED_LINES_PER_FILE);
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium">{file.path}</span>
          <Badge tone={statusTone[file.status]}>{statusLabel[file.status]}</Badge>
        </div>
        <span className="font-mono text-xs tabular-nums">
          <span className="text-success">+{file.additions}</span>{" "}
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      {file.binary ? (
        <p className="px-4 py-3 text-sm text-muted">Binary file. Contents are not shown.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {lines.map((line, index) =>
                line.kind === "hunk" || line.kind === "note" ? (
                  <tr className="bg-subtle text-muted" key={index}>
                    <td className="px-4 py-0.5" colSpan={3}>
                      {line.text}
                    </td>
                  </tr>
                ) : (
                  <tr
                    className={cn(
                      line.kind === "add" && "bg-diff-add",
                      line.kind === "remove" && "bg-diff-remove",
                    )}
                    key={index}
                  >
                    <td className="w-12 px-2 text-right text-muted select-none">
                      {line.kind === "add" ? "" : line.oldNumber}
                    </td>
                    <td className="w-12 px-2 text-right text-muted select-none">
                      {line.kind === "remove" ? "" : line.newNumber}
                    </td>
                    <td className="px-2 whitespace-pre">
                      <span className="select-none">
                        {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                      </span>
                      {line.text}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {file.lines.length > lines.length ? (
            <p className="border-t border-border px-4 py-2 text-xs text-muted">
              {file.lines.length - lines.length} more lines are not shown here. The full change is
              in the pull request.
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function JobChanges(props: { patch: string | undefined; published: boolean }) {
  const files = props.patch ? parseUnifiedDiff(props.patch) : [];
  if (files.length === 0) {
    return (
      <EmptyState
        description="Changed files and their diff appear here once the job has modified the working copy."
        title="No changes recorded"
      />
    );
  }
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {files.length} {files.length === 1 ? "file" : "files"} changed, {additions} additions,{" "}
        {deletions} deletions.{" "}
        {props.published
          ? "This is the exact patch that was pushed."
          : "This is the latest captured state of the working copy. It has not been pushed."}
      </p>
      {files.map((file) => (
        <FileDiff file={file} key={file.path} />
      ))}
    </div>
  );
}
