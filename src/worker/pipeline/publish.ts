import type { Plan, Reproduction } from "@/core/jobs/artifacts";
import { transitionJob } from "@/core/jobs/service";
import { product } from "@/core/product";
import { GitError, publishChangeSet } from "../git/operations";
import type { VerificationResult } from "../verification/run";
import { type RunContext, detailOf } from "./context";
import type { AcceptedChange } from "./implement";
import { JobCancelledError, JobFailure } from "./outcomes";
import { buildBranchName, buildCommitMessage, buildPullRequestBody } from "./pull-request";

// CREATING_PR -> COMPLETED. Publishing is not cancellable because the branch becomes visible
// on GitHub part-way through, so the cancellation watch is stopped before it starts and a
// request that arrived just before is honoured one last time.
export async function publishChange(
  run: RunContext,
  input: AcceptedChange & {
    remoteUrl: string;
    reproduction: Reproduction;
    plan: Plan;
    baseline: VerificationResult[];
    stopCancellationWatch: () => void;
  },
): Promise<void> {
  const { config, db, github } = run.deps;
  const { job } = run;
  const branch = buildBranchName(config.git.branchPrefix, job.id, job.title);

  input.stopCancellationWatch();
  const latest = await db.maintenanceJob.findUnique({
    where: { id: job.id },
    select: { cancelRequestedAt: true },
  });
  if (latest?.cancelRequestedAt) {
    throw new JobCancelledError();
  }
  await run.enter("CREATING_PR", `Publishing branch ${branch}`, { workBranch: branch });

  const jobUrl = `${config.appUrl}/jobs/${job.id}`;
  const writeToken = await run.token({ contents: "write" });
  const { headSha } = await run
    .timed("Push branch", () =>
      publishChangeSet(run.sandbox, {
        remote: { url: input.remoteUrl, token: writeToken },
        baseCommitSha: run.baseCommitSha,
        branch,
        patch: input.changes.patch,
        commitMessage: buildCommitMessage({
          title: job.title,
          summary: input.implementation.summary,
          jobUrl,
        }),
        authorName: config.git.authorName,
        authorEmail: config.git.authorEmail,
        signal: run.signal,
      }),
    )
    .catch((error: unknown) => {
      if (error instanceof GitError) {
        throw new JobFailure(
          "PUBLISH_FAILED",
          `The branch could not be pushed. ${detailOf(error)}`,
          { cause: error },
        );
      }
      throw error;
    });

  const requestedBy = job.createdBy.identities.find(
    (identity) => identity.provider === "GITHUB",
  )?.login;
  const pullRequest = await run
    .timed("Open pull request", () =>
      github.openPullRequest(run.repositoryRef, {
        title: job.title,
        head: branch,
        base: job.baseBranch,
        body: buildPullRequestBody({
          productName: product.name,
          jobUrl,
          requestedBy,
          problemDescription: job.problemDescription,
          reproduction: input.reproduction,
          plan: input.plan,
          implementation: input.implementation,
          review: input.review,
          files: input.changes.files,
          baseline: input.baseline,
          candidate: input.candidate,
          preExistingFailures: input.preExistingFailures,
        }),
      }),
    )
    .catch((error: unknown) => {
      throw new JobFailure(
        "PUBLISH_FAILED",
        `Branch ${branch} was pushed, but GitHub did not accept the pull request: ${detailOf(error)} You can open the pull request from that branch manually.`,
        { cause: error },
      );
    });

  await db.pullRequestResult.create({
    data: {
      jobId: job.id,
      number: pullRequest.number,
      url: pullRequest.url,
      title: job.title,
      headBranch: branch,
      baseBranch: job.baseBranch,
      headSha,
    },
  });
  await transitionJob(db, {
    jobId: job.id,
    to: "COMPLETED",
    message: `Pull request #${pullRequest.number} opened`,
    outcomeSummary: `Pull request #${pullRequest.number} was opened with ${input.changes.files.length} changed file(s) after verification and review passed.`,
    data: { pullRequestNumber: pullRequest.number, headSha },
  });
  run.status = "COMPLETED";
}
