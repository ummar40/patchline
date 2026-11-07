import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Timestamp, formatDuration } from "@/components/format";
import { JobChanges } from "@/components/job/changes";
import { AutoRefresh, CancelJobButton } from "@/components/job/controls";
import { JobCommands, JobVerification } from "@/components/job/evidence";
import { JobProgress } from "@/components/job/progress";
import { JobReasoning } from "@/components/job/reasoning";
import { JobTimeline } from "@/components/job/timeline";
import { JobUsage } from "@/components/job/usage";
import { JobStatusBadge } from "@/components/job-status-badge";
import { ButtonLink, ExternalButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DefinitionList, Notice, PageHeader, Panel } from "@/components/ui/layout";
import { findAccessibleJob } from "@/core/access";
import { branchUrl, commitUrl } from "@/core/github/urls";
import { isCancellable, isTerminal } from "@/core/jobs/state-machine";
import { requireUser } from "@/web/auth/current-user";
import { errorCategoryCopy, jobStatusCopy } from "@/web/copy";
import { loadJobEvidence } from "@/web/jobs/detail";
import { parseUnifiedDiff } from "@/web/jobs/diff";
import { services } from "@/web/services";

export const metadata: Metadata = { title: "Job" };

const REFRESH_INTERVAL_MS = 3_000;
const TABS = ["timeline", "changes", "verification", "commands", "reasoning", "usage"] as const;
type Tab = (typeof TABS)[number];

export default async function JobPage(props: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { config, db } = services();
  const { jobId } = await props.params;

  const job = await findAccessibleJob(db, user.id, jobId);
  if (!job) {
    notFound();
  }
  const evidence = await loadJobEvidence(db, job.id);

  const requested = (await props.searchParams).tab;
  const tab: Tab = TABS.find((candidate) => candidate === requested) ?? "timeline";
  const finished = isTerminal(job.status);
  const changedFiles = evidence.patch ? parseUnifiedDiff(evidence.patch).length : 0;
  const elapsed = job.startedAt
    ? (job.finishedAt ?? new Date()).getTime() - job.startedAt.getTime()
    : null;
  const webUrl = config.github.webUrl;

  const tabLabels: Record<Tab, string> = {
    timeline: `Timeline (${evidence.events.length})`,
    changes: `Changes (${changedFiles})`,
    verification: `Verification (${evidence.verificationRuns.length})`,
    commands: `Commands (${evidence.commands.length})`,
    reasoning: "Analysis and plan",
    usage: "Usage",
  };

  return (
    <>
      {finished ? null : <AutoRefresh intervalMs={REFRESH_INTERVAL_MS} />}

      <PageHeader
        actions={
          <>
            {isCancellable(job.status) ? (
              <CancelJobButton alreadyRequested={job.cancelRequestedAt !== null} jobId={job.id} />
            ) : null}
            {finished && job.status !== "COMPLETED" ? (
              <ButtonLink href={`/jobs/new?from=${job.id}`} size="sm">
                Create follow-up job
              </ButtonLink>
            ) : null}
            {job.pullRequest ? (
              <ExternalButtonLink href={job.pullRequest.url} size="sm" variant="primary">
                Open pull request #{job.pullRequest.number}
              </ExternalButtonLink>
            ) : null}
          </>
        }
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link className="hover:underline" href="/jobs">
              Jobs
            </Link>
            <span aria-hidden>/</span>
            <Link
              className="font-mono text-xs hover:underline"
              href={`/repositories/${job.repository.id}`}
            >
              {job.repository.fullName}
            </Link>
          </span>
        }
        title={job.title}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <JobStatusBadge status={job.status} />
        <span>{jobStatusCopy[job.status].description}</span>
      </div>

      {job.status === "COMPLETED" && job.pullRequest ? (
        <Notice role="status" title="Pull request opened" tone="success">
          {job.outcomeSummary ?? "The change passed verification and review."} Review and merge it
          on GitHub when you are satisfied. Nothing is merged for you.
        </Notice>
      ) : null}
      {job.status === "NEEDS_HUMAN" || job.status === "FAILED" ? (
        <Notice
          role="alert"
          title={
            job.errorCategory
              ? errorCategoryCopy[job.errorCategory]
              : jobStatusCopy[job.status].label
          }
          tone={job.status === "FAILED" ? "danger" : "warning"}
        >
          <p className="whitespace-pre-wrap">
            {job.outcomeSummary ?? jobStatusCopy[job.status].description}
          </p>
          <p className="mt-2 text-muted">
            No pull request was opened. Everything the job did is recorded below, including any diff
            it produced.
          </p>
        </Notice>
      ) : null}
      {job.status === "CANCELLED" ? (
        <Notice role="status" tone="neutral">
          {job.outcomeSummary ?? "This job was cancelled."}
        </Notice>
      ) : null}
      {!finished && job.cancelRequestedAt ? (
        <Notice role="status" tone="warning">
          Cancellation requested. The worker stops at the next safe point and removes the workspace.
        </Notice>
      ) : null}

      <JobProgress events={evidence.events} status={job.status} />

      <Panel className="px-5 py-4">
        <DefinitionList
          items={[
            { term: "Job ID", value: <span className="font-mono text-xs">{job.id}</span> },
            { term: "Created by", value: job.createdBy.name ?? "Unknown user" },
            { term: "Created", value: <Timestamp value={job.createdAt} /> },
            { term: "Elapsed", value: elapsed === null ? "Not started" : formatDuration(elapsed) },
            {
              term: "Base",
              value: job.baseCommitSha ? (
                <a
                  className="font-mono text-xs hover:underline"
                  href={commitUrl(webUrl, job.repository.fullName, job.baseCommitSha)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {job.baseBranch} @ {job.baseCommitSha.slice(0, 7)}
                </a>
              ) : (
                <span className="font-mono text-xs">{job.baseBranch}</span>
              ),
            },
            {
              term: "Work branch",
              value: job.workBranch ? (
                <a
                  className="font-mono text-xs hover:underline"
                  href={branchUrl(webUrl, job.repository.fullName, job.workBranch)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {job.workBranch}
                </a>
              ) : (
                "Not created"
              ),
            },
          ]}
        />
      </Panel>

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium hover:bg-surface">
          Problem description
        </summary>
        <div className="space-y-4 border-t border-border px-5 py-4 text-sm">
          <p className="leading-6 whitespace-pre-wrap">{job.problemDescription}</p>
          {job.reproductionSteps ? (
            <div>
              <p className="text-xs text-muted">How to reproduce</p>
              <pre className="mt-1 font-mono text-xs leading-5 whitespace-pre-wrap">
                {job.reproductionSteps}
              </pre>
            </div>
          ) : null}
          {job.expectedBehavior ? (
            <div>
              <p className="text-xs text-muted">Expected behavior</p>
              <p className="mt-1 leading-6 whitespace-pre-wrap">{job.expectedBehavior}</p>
            </div>
          ) : null}
        </div>
      </details>

      <div className="space-y-5">
        <nav
          aria-label="Job evidence"
          className="flex gap-1 overflow-x-auto border-b border-border"
        >
          {TABS.map((candidate) => (
            <Link
              aria-current={candidate === tab ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                candidate === tab
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
              href={`/jobs/${job.id}?tab=${candidate}`}
              key={candidate}
              scroll={false}
            >
              {tabLabels[candidate]}
            </Link>
          ))}
        </nav>

        {tab === "timeline" ? <JobTimeline events={evidence.events} /> : null}
        {tab === "changes" ? (
          <JobChanges patch={evidence.patch} published={job.pullRequest !== null} />
        ) : null}
        {tab === "verification" ? (
          <JobVerification configured={evidence.analysis} runs={evidence.verificationRuns} />
        ) : null}
        {tab === "commands" ? <JobCommands commands={evidence.commands} /> : null}
        {tab === "reasoning" ? <JobReasoning evidence={evidence} /> : null}
        {tab === "usage" ? <JobUsage job={job} usageByPhase={evidence.usageByPhase} /> : null}
      </div>
    </>
  );
}
