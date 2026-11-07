import type { ReactNode } from "react";
import type { Tone } from "@/web/copy";
import type { JobEvidence } from "@/web/jobs/detail";
import { Badge } from "../ui/badge";
import { EmptyState, Panel } from "../ui/layout";

function Block(props: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        {props.badge}
      </div>
      <div className="space-y-4 px-5 py-4 text-sm">{props.children}</div>
    </Panel>
  );
}

function Prose(props: { label: string; children: string | null | undefined }) {
  if (!props.children) {
    return null;
  }
  return (
    <div>
      <p className="text-xs text-muted">{props.label}</p>
      <p className="mt-1 leading-6 whitespace-pre-wrap">{props.children}</p>
    </div>
  );
}

function FileList(props: { label: string; files: { path: string; note: string }[] }) {
  if (props.files.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="text-xs text-muted">{props.label}</p>
      <ul className="mt-1 space-y-1.5">
        {props.files.map((file) => (
          <li key={file.path}>
            <code className="font-mono text-xs">{file.path}</code>
            <span className="text-muted"> - {file.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const reproductionCopy = {
  reproduced: { label: "Reproduced", tone: "success" },
  not_reproduced: { label: "Not reproduced", tone: "warning" },
  not_attempted: { label: "Not attempted", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

const verdictCopy = {
  approve: { label: "Approved", tone: "success" },
  request_changes: { label: "Changes requested", tone: "warning" },
  escalate: { label: "Escalated", tone: "danger" },
} as const satisfies Record<string, { label: string; tone: Tone }>;

const severityTone = { blocker: "danger", major: "warning", minor: "neutral" } as const;

export function JobReasoning(props: { evidence: JobEvidence }) {
  const { analysis, reproduction, plan, implementation, review, detection, reviewCount } =
    props.evidence;
  if (!analysis && !detection) {
    return (
      <EmptyState
        description="The repository analysis, reproduction result, repair plan and diff review are recorded here as the job reaches each step."
        title="Nothing recorded yet"
      />
    );
  }

  const commands = analysis?.commands ?? detection?.candidateCommands;
  return (
    <div className="space-y-4">
      <Block title="Repository analysis">
        <Prose label="Summary">{analysis?.summary}</Prose>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Languages</dt>
            <dd className="mt-0.5">
              {(analysis?.languages ?? detection?.ecosystems ?? []).join(", ") || "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Package or build system</dt>
            <dd className="mt-0.5">
              {analysis?.package_manager ?? detection?.packageManager ?? "None detected"}
            </dd>
          </div>
          {commands
            ? (Object.entries(commands) as [string, string | null][]).map(([name, command]) => (
                <div key={name}>
                  <dt className="text-xs text-muted capitalize">{name} command</dt>
                  <dd className="mt-0.5 font-mono text-xs">{command ?? "None"}</dd>
                </div>
              ))
            : null}
        </dl>
        <FileList
          files={(analysis?.relevant_files ?? []).map((file) => ({
            path: file.path,
            note: file.reason,
          }))}
          label="Relevant files"
        />
        <Prose label="Repository conventions">{analysis?.conventions}</Prose>
      </Block>

      {reproduction ? (
        <Block
          badge={
            <Badge tone={reproductionCopy[reproduction.status].tone}>
              {reproductionCopy[reproduction.status].label}
            </Badge>
          }
          title="Reproduction"
        >
          <Prose label="What was observed">{reproduction.summary}</Prose>
        </Block>
      ) : null}

      {plan ? (
        <Block title="Repair plan">
          <Prose label="Root cause">{plan.root_cause}</Prose>
          <Prose label="Approach">{plan.approach}</Prose>
          <FileList
            files={plan.files_to_change.map((file) => ({ path: file.path, note: file.change }))}
            label="Files to change"
          />
          <Prose label="Regression test">{plan.regression_test}</Prose>
          <Prose label="Risks">{plan.risks}</Prose>
        </Block>
      ) : null}

      {implementation ? (
        <Block
          badge={
            <Badge tone={implementation.regression_test_added ? "success" : "neutral"}>
              {implementation.regression_test_added
                ? "Regression test added"
                : "No regression test"}
            </Badge>
          }
          title="Implementation"
        >
          <Prose label="Summary">{implementation.summary}</Prose>
          <Prose label="Test coverage">{implementation.regression_test_notes}</Prose>
        </Block>
      ) : null}

      {review ? (
        <Block
          badge={
            <Badge tone={verdictCopy[review.verdict].tone}>
              {verdictCopy[review.verdict].label}
            </Badge>
          }
          title={reviewCount > 1 ? `Diff review (round ${reviewCount})` : "Diff review"}
        >
          <Prose label="Assessment">{review.summary}</Prose>
          {review.findings.length > 0 ? (
            <div>
              <p className="text-xs text-muted">Findings</p>
              <ul className="mt-1 space-y-2">
                {review.findings.map((finding, index) => (
                  <li className="flex items-start gap-2" key={index}>
                    <Badge tone={severityTone[finding.severity]}>{finding.severity}</Badge>
                    <span>
                      {finding.path ? (
                        <code className="font-mono text-xs">{finding.path}: </code>
                      ) : null}
                      {finding.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Block>
      ) : null}
    </div>
  );
}
