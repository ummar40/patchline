import { type ExecResult, REPOSITORY_DIR, type Sandbox } from "../sandbox/types";

const GIT_TIMEOUT_MS = 120_000;
const NETWORK_GIT_TIMEOUT_MS = 600_000;
const MAX_PATCH_CAPTURE_BYTES = 8 * 1024 * 1024;

const SAFE_REF = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,200}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

// Build output and dependency directories that some repositories forget to ignore. They
// are excluded locally so they never enter a change set. Tracked files are unaffected.
const LOCAL_EXCLUDES = [
  "node_modules/",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".tox/",
  ".coverage",
  "coverage/",
  ".nyc_output/",
  ".next/",
  ".turbo/",
  "*.tsbuildinfo",
];

export class GitError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export type GitRemote = {
  url: string;
  // Present for private remotes. Sent as an HTTP header scoped to the remote's origin and
  // handed to git through the environment, so it is never written into .git/config.
  token?: string;
};

export type ChangedFile = {
  path: string;
  status: "ADDED" | "MODIFIED" | "DELETED";
  additions: number | null;
  deletions: number | null;
};

export type ChangeSet = {
  patch: string;
  files: ChangedFile[];
  truncated: boolean;
};

export function isSafeRefName(name: string): boolean {
  return SAFE_REF.test(name) && !name.endsWith("/") && !name.endsWith(".lock");
}

function credentialEnvironment(remote: GitRemote): Record<string, string> | undefined {
  if (!remote.token) {
    return undefined;
  }
  const origin = new URL(remote.url).origin;
  const basic = Buffer.from(`x-access-token:${remote.token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

// Platform-issued git commands ignore the global config, which lives in a home directory
// that repository code may have written to.
const PLATFORM_GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null" };

function ensureSucceeded(result: ExecResult, action: string): ExecResult {
  if (result.timedOut) {
    throw new GitError(`${action} timed out`, result.stderr);
  }
  if (result.exitCode !== 0) {
    throw new GitError(
      `${action} failed with exit code ${result.exitCode}`,
      result.stderr || result.stdout,
    );
  }
  return result;
}

export async function cloneRepository(
  sandbox: Sandbox,
  options: { remote: GitRemote; branch: string; depth: number; signal?: AbortSignal },
): Promise<{ baseCommitSha: string }> {
  if (!isSafeRefName(options.branch)) {
    throw new GitError("Branch name contains characters that are not supported", options.branch);
  }
  ensureSucceeded(
    await sandbox.exec({
      argv: [
        "git",
        "clone",
        "--quiet",
        "--depth",
        String(options.depth),
        "--single-branch",
        "--no-tags",
        "--branch",
        options.branch,
        "--",
        options.remote.url,
        REPOSITORY_DIR,
      ],
      network: "egress",
      timeoutMs: NETWORK_GIT_TIMEOUT_MS,
      env: PLATFORM_GIT_ENV,
      secretEnv: credentialEnvironment(options.remote),
      signal: options.signal,
    }),
    "Clone",
  );

  const excludes = await sandbox.exec({
    argv: ["sh", "-c", 'cat >> "$1"', "sh", `${REPOSITORY_DIR}/.git/info/exclude`],
    stdin: `${LOCAL_EXCLUDES.join("\n")}\n`,
    timeoutMs: GIT_TIMEOUT_MS,
    signal: options.signal,
  });
  ensureSucceeded(excludes, "Writing local excludes");

  const head = ensureSucceeded(
    await runGit(sandbox, ["rev-parse", "HEAD"], options.signal),
    "Reading HEAD",
  );
  const baseCommitSha = head.stdout.trim();
  if (!COMMIT_SHA.test(baseCommitSha)) {
    throw new GitError("Clone produced an unexpected HEAD", baseCommitSha);
  }
  return { baseCommitSha };
}

// `exact` returns stdout byte-for-byte. It is required wherever the output is parsed on NUL
// separators or applied later as a patch; display-oriented clean-up would corrupt both.
export function runGit(
  sandbox: Sandbox,
  args: readonly string[],
  signal?: AbortSignal,
  exact = false,
) {
  return sandbox.exec({
    argv: ["git", "--no-pager", ...args],
    workdir: REPOSITORY_DIR,
    timeoutMs: GIT_TIMEOUT_MS,
    env: PLATFORM_GIT_ENV,
    maxOutputBytes: MAX_PATCH_CAPTURE_BYTES,
    rawOutput: exact,
    signal,
  });
}

// Discards modifications made while installing dependencies or running the baseline, so the
// change set only ever contains what happened after the agent started working.
export async function resetTrackedFiles(sandbox: Sandbox, signal?: AbortSignal): Promise<void> {
  ensureSucceeded(
    await runGit(sandbox, ["checkout", "--quiet", "--", "."], signal),
    "Restoring tracked files",
  );
}

export async function excludeUntrackedFiles(
  sandbox: Sandbox,
  signal?: AbortSignal,
): Promise<string[]> {
  const status = ensureSucceeded(
    await runGit(
      sandbox,
      ["status", "--porcelain", "--untracked-files=normal", "-z"],
      signal,
      true,
    ),
    "Reading status",
  );
  const untracked = status.stdout
    .split("\0")
    .filter((entry) => entry.startsWith("?? "))
    .map((entry) => entry.slice(3));
  if (untracked.length === 0) {
    return [];
  }
  const patterns = untracked.map((path) => `/${path.replace(/([*?[\]\\!#])/g, "\\$1")}`);
  ensureSucceeded(
    await sandbox.exec({
      argv: ["sh", "-c", 'cat >> "$1"', "sh", `${REPOSITORY_DIR}/.git/info/exclude`],
      stdin: `${patterns.join("\n")}\n`,
      timeoutMs: GIT_TIMEOUT_MS,
      signal,
    }),
    "Writing local excludes",
  );
  return untracked;
}

export async function captureChangeSet(
  sandbox: Sandbox,
  baseCommitSha: string,
  signal?: AbortSignal,
): Promise<ChangeSet> {
  ensureSucceeded(await runGit(sandbox, ["add", "--all"], signal), "Staging changes");

  const diffArgs = [
    "diff",
    "--cached",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
  ];
  const names = ensureSucceeded(
    await runGit(sandbox, [...diffArgs, "--name-status", "-z", baseCommitSha], signal, true),
    "Listing changed files",
  );
  const stats = ensureSucceeded(
    await runGit(sandbox, [...diffArgs, "--numstat", "-z", baseCommitSha], signal, true),
    "Reading change statistics",
  );
  const patch = ensureSucceeded(
    await runGit(sandbox, [...diffArgs, "--binary", "--full-index", baseCommitSha], signal, true),
    "Reading patch",
  );

  const lineCounts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const entry of stats.stdout.split("\0")) {
    const [added, deleted, ...pathParts] = entry.split("\t");
    const path = pathParts.join("\t");
    if (added !== undefined && deleted !== undefined && path) {
      lineCounts.set(path, {
        additions: added === "-" ? null : Number(added),
        deletions: deleted === "-" ? null : Number(deleted),
      });
    }
  }

  const files: ChangedFile[] = [];
  const tokens = names.stdout.split("\0");
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const code = tokens[index];
    const path = tokens[index + 1];
    if (!code || !path) {
      continue;
    }
    files.push({
      path,
      status: code.startsWith("A") ? "ADDED" : code.startsWith("D") ? "DELETED" : "MODIFIED",
      additions: lineCounts.get(path)?.additions ?? null,
      deletions: lineCounts.get(path)?.deletions ?? null,
    });
  }

  return { patch: patch.stdout, files, truncated: patch.truncated };
}

export type PublishRequest = {
  remote: GitRemote;
  baseCommitSha: string;
  branch: string;
  patch: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  signal?: AbortSignal;
};

const FETCH_SCRIPT = `set -eu
git init --quiet "$1"
cd "$1"
git remote add origin "$2"
git fetch --quiet --depth 1 origin "$3"
git checkout --quiet -b "$4" FETCH_HEAD`;

const COMMIT_SCRIPT = `set -eu
cd "$1"
git apply --index --whitespace=nowarn -
git -c user.name="$2" -c user.email="$3" commit --quiet --no-verify -m "$4"
git rev-parse HEAD`;

// The working copy that ran repository code is never given credentials. The commit is
// rebuilt from the patch in a volume only platform code has touched: fetch (token, network),
// apply and commit (neither), push (token, network, hooks disabled).
export async function publishChangeSet(
  sandbox: Sandbox,
  request: PublishRequest,
): Promise<{ headSha: string }> {
  if (!isSafeRefName(request.branch) || !COMMIT_SHA.test(request.baseCommitSha)) {
    throw new GitError("Refusing to publish with an unsafe ref", request.branch);
  }
  const secretEnv = credentialEnvironment(request.remote);
  const shared = { profile: "publish" as const, env: PLATFORM_GIT_ENV, signal: request.signal };

  ensureSucceeded(
    await sandbox.exec({
      ...shared,
      argv: [
        "sh",
        "-c",
        FETCH_SCRIPT,
        "fetch",
        REPOSITORY_DIR,
        request.remote.url,
        request.baseCommitSha,
        request.branch,
      ],
      network: "egress",
      secretEnv,
      timeoutMs: NETWORK_GIT_TIMEOUT_MS,
    }),
    "Fetching the base commit",
  );

  const commit = ensureSucceeded(
    await sandbox.exec({
      ...shared,
      argv: [
        "sh",
        "-c",
        COMMIT_SCRIPT,
        "commit",
        REPOSITORY_DIR,
        request.authorName,
        request.authorEmail,
        request.commitMessage,
      ],
      stdin: request.patch,
      timeoutMs: GIT_TIMEOUT_MS,
    }),
    "Applying the change set",
  );
  const headSha = commit.stdout.trim().split("\n").at(-1) ?? "";
  if (!COMMIT_SHA.test(headSha)) {
    throw new GitError("Commit produced an unexpected HEAD", commit.stdout);
  }

  ensureSucceeded(
    await sandbox.exec({
      ...shared,
      argv: [
        "git",
        "-c",
        "core.hooksPath=/dev/null",
        "push",
        "--quiet",
        "origin",
        `HEAD:refs/heads/${request.branch}`,
      ],
      workdir: REPOSITORY_DIR,
      network: "egress",
      secretEnv,
      timeoutMs: NETWORK_GIT_TIMEOUT_MS,
    }),
    "Pushing the branch",
  );

  return { headSha };
}
