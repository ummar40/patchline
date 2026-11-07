import type { JobStatus } from "@/db/generated/enums";
import { isTerminal } from "@/core/jobs/state-machine";
import { jobStatusCopy } from "@/web/copy";
import { Badge } from "./ui/badge";

export function JobStatusBadge(props: { status: JobStatus }) {
  const copy = jobStatusCopy[props.status];
  const active = !isTerminal(props.status) && props.status !== "QUEUED";
  return (
    <Badge tone={copy.tone}>
      {active ? (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {copy.label}
    </Badge>
  );
}
