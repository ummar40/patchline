import type {
  GitHubInstallationView,
  GitHubRepositoryView,
  GitHubUserView,
} from "@/core/github/user-view";
import { persistUserView, upsertUserFromProfile } from "@/core/github/user-view";
import { createJob } from "@/core/jobs/service";
import type { Database } from "@/db";

let sequence = 1_000;
const next = () => (sequence += 1);

export function repositoryView(
  fullName: string,
  overrides: Partial<GitHubRepositoryView> = {},
): GitHubRepositoryView {
  const [ownerLogin = "", name = ""] = fullName.split("/");
  return {
    githubRepoId: BigInt(next()),
    ownerLogin,
    name,
    fullName,
    isPrivate: true,
    isArchived: false,
    defaultBranch: "main",
    canPush: true,
    ...overrides,
  };
}

export function installationView(
  accountLogin: string,
  repositories: GitHubRepositoryView[],
  overrides: Partial<GitHubInstallationView> = {},
): GitHubInstallationView {
  return {
    githubInstallationId: BigInt(next()),
    accountGithubId: BigInt(next()),
    accountLogin,
    accountType: "ORGANIZATION",
    accountAvatarUrl: null,
    repositorySelection: "SELECTED",
    suspendedAt: null,
    repositories,
    ...overrides,
  };
}

// Signs a user in the same way the OAuth callback does, from a GitHub view.
export async function signIn(db: Database, login: string, installations: GitHubInstallationView[]) {
  const view: GitHubUserView = {
    profile: { githubUserId: BigInt(next()), login, name: login, email: null, avatarUrl: null },
    installations,
  };
  const user = await upsertUserFromProfile(db, view.profile);
  await persistUserView(db, user.id, view);
  return { user, view };
}

export async function repositoryByName(db: Database, fullName: string) {
  return db.repository.findFirstOrThrow({ where: { fullName } });
}

export async function queueJob(
  db: Database,
  userId: string,
  repositoryId: string,
  title = "Fix the rounding bug",
) {
  return createJob(db, {
    repositoryId,
    createdById: userId,
    baseBranch: "main",
    title,
    problemDescription: "Totals are rounded down instead of to the nearest cent.",
    reproductionSteps: undefined,
    expectedBehavior: undefined,
    maxActiveJobsPerUser: 10,
  });
}
