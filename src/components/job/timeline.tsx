import type { JobEventType } from "@/db/generated/enums";
import type { JobEvidence } from "@/web/jobs/detail";
import { Timestamp } from "../format";
import { cn } from "../ui/cn";
import { EmptyState, Panel } from "../ui/layout";

const typeLabels: Record<JobEventType, string> = {
  JOB_CREATED: "Created",
  STATE_CHANGED: "State",
  CANCEL_REQUESTED: "Cancel",
  OPERATION: "Step",
  COMMAND: "Command",
  MODEL_CALL: "Model",
  TOOL_CALL: "Tool",
  VERIFICATION: "Verify",
  DECISION: "Decision",
  LIMIT: "Limit",
  ERROR: "Error",
};

function details(data: unknown): [string, string][] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [];
  }
  return Object.entries(data).flatMap(([key, value]): [string, string][] =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [[key, String(value)]]
      : [],
  );
}

export function JobTimeline(props: { events: JobEvidence["events"] }) {
  if (props.events.length === 0) {
    return (
      <EmptyState
        description="Events appear here as soon as the job is created."
        title="No events"
      />
    );
  }
  return (
    <Panel>
      <ol className="divide-y divide-border">
        {props.events.map((event) => {
          const pairs = details(event.data);
          return (
            <li
              className="grid grid-cols-[5.5rem_4.5rem_1fr] items-baseline gap-x-3 px-4 py-2.5 text-sm"
              key={String(event.id)}
            >
              <span className="font-mono text-xs text-muted">
                <Timestamp precision="second" value={event.createdAt} />
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  event.level === "ERROR"
                    ? "text-danger"
                    : event.level === "WARN"
                      ? "text-warning"
                      : "text-muted",
                )}
              >
                {typeLabels[event.type]}
              </span>
              <div className="min-w-0">
                <p className={cn("break-words", event.type === "STATE_CHANGED" && "font-medium")}>
                  {event.message}
                </p>
                {pairs.length > 0 ? (
                  <p className="mt-0.5 font-mono text-xs break-words text-muted">
                    {pairs.map(([key, value]) => `${key}=${value}`).join("  ")}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
