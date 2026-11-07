import type { VerificationCategory, VerificationStatus } from "@/db/generated/enums";
import { type Tone, jobStatusCopy, verificationCategoryCopy } from "@/web/copy";
import type { JobEvidence } from "@/web/jobs/detail";
import { Timestamp, formatDuration } from "../format";
import { Badge } from "../ui/badge";
import { EmptyState, Panel } from "../ui/layout";

const verificationTone: Record<VerificationStatus, Tone> = {
  PASSED: "success",
  FAILED: "danger",
  TIMED_OUT: "warning",
  ERRORED: "warning",
};

const verificationLabel: Record<VerificationStatus, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  TIMED_OUT: "Timed out",
  ERRORED: "Could not run",
};

const CATEGORIES: VerificationCategory[] = ["TEST", "LINT", "TYPECHECK", "BUILD"];

function Output(props: { text: string; truncated: boolean }) {
  if (props.text.trim() === "") {
    return <p className="px-4 py-3 text-xs text-muted">The command produced no output.</p>;
  }
  return (
    <>
      <pre className="max-h-96 overflow-auto px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap">
        {props.text}
      </pre>
      {props.truncated ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted">
          Output was longer than the capture limit. The beginning and end are shown.
        </p>
      ) : null}
    </>
  );
}

export function JobVerification(props: {
  runs: JobEvidence["verificationRuns"];
  configured: JobEvidence["analysis"];
}) {
  if (props.runs.length === 0) {
    return (
      <EmptyState
        description="The repository's test, lint, type check and build commands run once before any change (baseline) and again after each implementation attempt."
        title="No verification has run yet"
      />
    );
  }

  const groups = new Map<string, JobEvidence["verificationRuns"]>();
  for (const run of props.runs) {
    const key =
      run.stage === "BASELINE"
        ? "Baseline, before any change"
        : `After change, attempt ${run.iteration}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const missing = props.configured
    ? CATEGORIES.filter((category) => {
        const key = category.toLowerCase() as keyof NonNullable<
          JobEvidence["analysis"]
        >["commands"];
        return props.configured?.commands[key] === null;
      })
    : [];

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([title, runs]) => (
        <section className="space-y-2" key={title}>
          <h3 className="text-sm font-semibold">{title}</h3>
          <Panel className="divide-y divide-border">
            {runs.map((run) => (
              <details className="group" key={run.id}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-surface">
                  <span className="w-24 shrink-0 font-medium">
                    {verificationCategoryCopy[run.category]}
                  </span>
                  <Badge tone={verificationTone[run.status]}>{verificationLabel[run.status]}</Badge>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
                    {run.command}
                  </code>
                  <span className="font-mono text-xs text-muted tabular-nums">
                    exit {run.exitCode ?? "none"} - {formatDuration(run.durationMs)}
                  </span>
                </summary>
                <div className="border-t border-border bg-surface">
                  <Output
                    text={run.commandExecution?.output ?? ""}
                    truncated={run.commandExecution?.outputTruncated ?? false}
                  />
                </div>
              </details>
            ))}
          </Panel>
        </section>
      ))}
      {missing.length > 0 ? (
        <p className="text-sm text-muted">
          Not available in this repository:{" "}
          {missing.map((category) => verificationCategoryCopy[category]).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

const sourceLabel = { SYSTEM: "Platform", AGENT: "Agent", VERIFICATION: "Verification" } as const;

export function JobCommands(props: { commands: JobEvidence["commands"] }) {
  if (props.commands.length === 0) {
    return (
      <EmptyState
        description="Every command executed in the sandbox is listed here with its exit code, duration and output."
        title="No commands have run yet"
      />
    );
  }
  return (
    <Panel className="divide-y divide-border">
      {props.commands.map((command) => (
        <details key={command.id}>
          <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-surface">
            <span className="font-mono text-xs text-muted">
              <Timestamp precision="second" value={command.startedAt} />
            </span>
            <Badge
              tone={command.timedOut ? "warning" : command.exitCode === 0 ? "success" : "danger"}
            >
              {command.timedOut ? "timed out" : `exit ${command.exitCode ?? "none"}`}
            </Badge>
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{command.command}</code>
            <span className="flex items-center gap-2 text-xs text-muted">
              {command.networkEnabled ? <Badge tone="warning">network</Badge> : null}
              <span>{sourceLabel[command.source]}</span>
              <span>{jobStatusCopy[command.phase].label}</span>
              <span className="font-mono tabular-nums">{formatDuration(command.durationMs)}</span>
            </span>
          </summary>
          <div className="border-t border-border bg-surface">
            {command.purpose ? (
              <p className="px-4 pt-3 text-xs text-muted">Purpose: {command.purpose}</p>
            ) : null}
            <Output text={command.output} truncated={command.outputTruncated} />
          </div>
        </details>
      ))}
    </Panel>
  );
}
