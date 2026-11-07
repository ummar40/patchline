import { cloneUrl } from "@/core/github/urls";
import { shorten } from "../agent/tools";
import { type DetectionResult, detectRepository } from "../analysis/detect";
import {
  GitError,
  cloneRepository,
  excludeUntrackedFiles,
  resetTrackedFiles,
} from "../git/operations";
import { runShellCommand } from "./commands";
import { type RunContext, detailOf } from "./context";
import { JobFailure, NeedsHumanError } from "./outcomes";

const INSTALL_FAILURE_EXCERPT_CHARS = 1_500;

// PREPARING through the deterministic part of ANALYZING: confirm access, create the sandbox,
// clone, detect tooling and install dependencies. No model is involved yet.
export async function prepareWorkspace(
  run: RunContext,
): Promise<{ remoteUrl: string; detection: DetectionResult }> {
  const { config, github, sandboxes } = run.deps;
  const { repository } = run.job;
  const remoteUrl = cloneUrl(config.github.webUrl, repository.fullName);

  if (
    repository.removedAt ||
    repository.installation.uninstalledAt ||
    repository.installation.suspendedAt
  ) {
    throw new JobFailure(
      "GITHUB_ACCESS",
      "The GitHub App no longer has access to this repository.",
    );
  }
  const state = await github.repositoryState(run.repositoryRef).catch((error: unknown) => {
    throw new JobFailure(
      "GITHUB_ACCESS",
      `The repository could not be read through the GitHub App: ${detailOf(error)}`,
      { cause: error },
    );
  });
  if (state.isArchived || state.isDisabled) {
    throw new JobFailure(
      "GITHUB_ACCESS",
      "The repository is archived or disabled, so a pull request cannot be opened.",
    );
  }
  run.attachSandbox(await run.timed("Create sandbox", () => sandboxes.create(run.job.id)));

  await run.enter("CLONING", `Cloning ${repository.fullName} at ${run.job.baseBranch}`);
  const readToken = await run.token({ contents: "read" });
  const { baseCommitSha } = await run
    .timed("Clone repository", () =>
      cloneRepository(run.sandbox, {
        remote: { url: remoteUrl, token: readToken },
        branch: run.job.baseBranch,
        depth: config.git.cloneDepth,
        signal: run.signal,
      }),
    )
    .catch((error: unknown) => {
      if (error instanceof GitError) {
        throw new JobFailure("CLONE_FAILED", detailOf(error), { cause: error });
      }
      throw error;
    });
  run.setBaseCommit(baseCommitSha);

  await run.enter("ANALYZING", "Inspecting the repository", { baseCommitSha });
  const detection = await run.timed("Detect tooling", () =>
    detectRepository(run.sandbox, run.signal),
  );
  await run.recorder.jsonArtifact("DETECTION", "detection.json", detection);
  if (detection.ecosystems.length === 0 && detection.unsupportedEcosystems.length > 0) {
    throw new NeedsHumanError(
      "UNSUPPORTED_REPOSITORY",
      `This repository uses ${detection.unsupportedEcosystems.join(", ")}, and the sandbox image does not include that toolchain. Its tests could not be run, so no change was attempted.`,
    );
  }

  await installDependencies(run, detection);
  return { remoteUrl, detection };
}

// The only step where repository code runs with network access. The commands come from
// lockfile detection in platform code, never from the model.
async function installDependencies(run: RunContext, detection: DetectionResult): Promise<void> {
  for (const command of detection.installCommands) {
    const result = await runShellCommand(run.sandbox, run.recorder, {
      command,
      source: "SYSTEM",
      phase: "ANALYZING",
      purpose: "Install dependencies",
      network: "egress",
      timeoutMs: run.deps.config.sandbox.installTimeoutMs,
      signal: run.signal,
    });
    if (result.timedOut || result.exitCode !== 0) {
      const how = result.timedOut ? "timed out" : `exit ${result.exitCode}`;
      throw new JobFailure(
        "DEPENDENCY_INSTALL",
        `Dependencies could not be installed with \`${command}\` (${how}).\n${shorten(result.output, INSTALL_FAILURE_EXCERPT_CHARS)}`,
      );
    }
  }
  await discardIncidentalChanges(run);
}

// Whatever installation, analysis or a baseline run left behind is not part of the change.
export async function discardIncidentalChanges(run: RunContext): Promise<void> {
  await resetTrackedFiles(run.sandbox, run.signal);
  await excludeUntrackedFiles(run.sandbox, run.signal);
}
