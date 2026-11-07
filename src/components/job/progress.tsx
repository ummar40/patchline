import { Check, CircleDashed, LoaderCircle, OctagonAlert } from "lucide-react";
import { isTerminal } from "@/core/jobs/state-machine";
import type { JobStatus } from "@/db/generated/enums";
import { jobStatusCopy } from "@/web/copy";
import { cn } from "../ui/cn";

const PHASES: JobStatus[] = [
  "QUEUED",
  "PREPARING",
  "CLONING",
  "ANALYZING",
  "REPRODUCING",
  "PLANNING",
  "IMPLEMENTING",
  "VERIFYING",
  "REVIEWING",
  "CREATING_PR",
];

type PhaseEvent = { toStatus: JobStatus | null; fromStatus: JobStatus | null };

export function JobProgress(props: { status: JobStatus; events: PhaseEvent[] }) {
  const visits = new Map<JobStatus, number>();
  for (const event of props.events) {
    if (event.toStatus) {
      visits.set(event.toStatus, (visits.get(event.toStatus) ?? 0) + 1);
    }
  }
  // Every job starts queued exactly once, whether or not its creation event is in view.
  visits.set("QUEUED", 1);
  // For a job that stopped early, the phase it stopped in is the source of its last transition.
  const stoppedIn =
    isTerminal(props.status) && props.status !== "COMPLETED"
      ? props.events.findLast((event) => event.toStatus === props.status)?.fromStatus
      : undefined;

  return (
    <ol aria-label="Job progress" className="flex flex-wrap gap-x-1 gap-y-2 text-xs">
      {PHASES.map((phase) => {
        const count = visits.get(phase) ?? 0;
        const current = props.status === phase;
        const stopped = stoppedIn === phase;
        const done = count > 0 && !current && !stopped;
        const Icon = stopped ? OctagonAlert : current ? LoaderCircle : done ? Check : CircleDashed;
        return (
          <li
            aria-current={current ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              current && "border-info/40 bg-info-subtle font-medium text-info",
              stopped && "border-warning/40 bg-warning-subtle font-medium text-warning",
              done && "border-border text-foreground",
              count === 0 && "border-dashed border-border text-muted",
            )}
            key={phase}
            title={jobStatusCopy[phase].description}
          >
            <Icon
              aria-hidden
              className={cn("size-3.5", current && phase !== "QUEUED" && "animate-spin")}
              strokeWidth={2}
            />
            {jobStatusCopy[phase].label}
            {count > 1 ? <span className="tabular-nums text-muted">x{count}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
