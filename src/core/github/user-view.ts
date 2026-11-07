import type { Octokit } from "octokit";
import type { Database } from "@/db";

export type GitHubProfile = {
  githubUserId: bigint;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type GitHubRepositoryView = {
  githubRepoId: bigint;
  ownerLogin: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  isArchived: boolean;
  defaultBranch: string;
  canPush: boolean;
};

export type GitHubInstallationView = {
  githubInstallationId: bigint;
  accountGithubId: bigint;
  accountLogin: string;
  accountType: "USER" | "ORGANIZATION";
  accountAvatarUrl: string | null;
  repositorySelection: "ALL" | "SELECTED";
  suspendedAt: Date | null;
  repositories: GitHubRepositoryView[];
};

export type GitHubUserView = {
  profile: GitHubProfile;
  installations: GitHubInstallationView[];
};

// Reads what GitHub says this user can reach through the app. This is the only source of
// access grants: nothing a browser sends (such as an installation_id) is trusted.
export async function fetchUserView(octokit: Octokit): Promise<GitHubUserView> {
  const { data: user } = await octokit.rest.users.getAuthenticated();
  const installations = await octokit.paginate(
    octokit.rest.apps.listInstallationsForAuthenticatedUser,
    { per_page: 100 },
  );

  const views: GitHubInstallationView[] = [];
  for (const installation of installations) {
    const account = installation.account;
    if (!account || !("login" in account)) {
      continue;
    }
    const repositories = await octokit.paginate(
      octokit.rest.apps.listInstallationReposForAuthenticatedUser,
      { installation_id: installation.id, per_page: 100 },
    );
    views.push({
      githubInstallationId: BigInt(installation.id),
      accountGithubId: BigInt(account.id),
      accountLogin: account.login,
      accountType: account.type === "Organization" ? "ORGANIZATION" : "USER",
      accountAvatarUrl: account.avatar_url ?? null,
      repositorySelection: installation.repository_selection === "all" ? "ALL" : "SELECTED",
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
      repositories: repositories.map((repository) => ({
        githubRepoId: BigInt(repository.id),
        ownerLogin: repository.owner.login,
        name: repository.name,
        fullName: repository.full_name,
        isPrivate: repository.private,
        isArchived: repository.archived,
        defaultBranch: repository.default_branch,
        canPush: repository.permissions?.push === true,
      })),
    });
  }

  return {
    profile: {
      githubUserId: BigInt(user.id),
      login: user.login,
      name: user.name ?? null,
      email: user.email ?? null,
      avatarUrl: user.avatar_url ?? null,
    },
    installations: views,
  };
}

export async function upsertUserFromProfile(
  db: Database,
  profile: GitHubProfile,
  now = new Date(),
) {
  const providerAccountId = profile.githubUserId.toString();
  const details = {
    name: profile.name ?? profile.login,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  };

  const identity = await db.authIdentity.findUnique({
    where: { provider_providerAccountId: { provider: "GITHUB", providerAccountId } },
  });
  if (identity) {
    await db.authIdentity.update({
      where: { id: identity.id },
      data: { login: profile.login, lastSignInAt: now },
    });
    return db.user.update({ where: { id: identity.userId }, data: details });
  }
  return db.user.create({
    data: {
      ...details,
      identities: {
        create: { provider: "GITHUB", providerAccountId, login: profile.login, lastSignInAt: now },
      },
    },
  });
}

// Replaces the user's access grants with exactly what GitHub reported. Repositories and
// installations themselves are shared rows; only this user's access rows are removed when
// something is no longer visible to them.
export async function persistUserView(
  db: Database,
  userId: string,
  view: GitHubUserView,
  now = new Date(),
): Promise<void> {
  const installationIds: string[] = [];

  for (const installation of view.installations) {
    const details = {
      accountGithubId: installation.accountGithubId,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      accountAvatarUrl: installation.accountAvatarUrl,
      repositorySelection: installation.repositorySelection,
      suspendedAt: installation.suspendedAt,
      uninstalledAt: null,
    };
    const installationRow = await db.gitHubInstallation.upsert({
      where: { githubInstallationId: installation.githubInstallationId },
      create: { githubInstallationId: installation.githubInstallationId, ...details },
      update: details,
    });
    installationIds.push(installationRow.id);

    await db.installationAccess.upsert({
      where: { userId_installationId: { userId, installationId: installationRow.id } },
      create: { userId, installationId: installationRow.id, verifiedAt: now },
      update: { verifiedAt: now },
    });

    const repositoryIds: string[] = [];
    for (const repository of installation.repositories) {
      const { githubRepoId, canPush, ...fields } = repository;
      const repositoryRow = await db.repository.upsert({
        where: { githubRepoId },
        create: { githubRepoId, installationId: installationRow.id, ...fields },
        update: { installationId: installationRow.id, removedAt: null, ...fields },
      });
      repositoryIds.push(repositoryRow.id);
      await db.repositoryAccess.upsert({
        where: { userId_repositoryId: { userId, repositoryId: repositoryRow.id } },
        create: { userId, repositoryId: repositoryRow.id, canPush, verifiedAt: now },
        update: { canPush, verifiedAt: now },
      });
    }

    await db.repositoryAccess.deleteMany({
      where: {
        userId,
        repository: { installationId: installationRow.id },
        repositoryId: { notIn: repositoryIds },
      },
    });
  }

  await db.repositoryAccess.deleteMany({
    where: { userId, repository: { installationId: { notIn: installationIds } } },
  });
  await db.installationAccess.deleteMany({
    where: { userId, installationId: { notIn: installationIds } },
  });
}
