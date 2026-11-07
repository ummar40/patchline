import { App, Octokit } from "octokit";
import { registerSecret } from "../logging/redaction";

export type GitHubApp = App;

export type RepositoryRef = {
  installationId: bigint;
  owner: string;
  name: string;
};

export function createGitHubApp(config: {
  appId: string;
  privateKey: string;
  apiUrl: string;
}): GitHubApp {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    Octokit: Octokit.defaults({ baseUrl: config.apiUrl }),
  });
}

export function createUserOctokit(config: { apiUrl: string }, userToken: string): Octokit {
  return new Octokit({ baseUrl: config.apiUrl, auth: userToken });
}

export type TokenPermissions = { contents: "read" | "write"; pull_requests?: "write" };

// Tokens handed to git are narrowed to one repository and the minimum permission for the
// step. They expire within the hour and are never persisted.
export async function createRepositoryToken(
  app: GitHubApp,
  params: { installationId: bigint; githubRepoId: bigint; permissions: TokenPermissions },
): Promise<string> {
  const { data } = await app.octokit.rest.apps.createInstallationAccessToken({
    installation_id: Number(params.installationId),
    repository_ids: [Number(params.githubRepoId)],
    permissions: params.permissions,
  });
  registerSecret(data.token);
  return data.token;
}

export type RepositoryPermission = "admin" | "write" | "read" | "none";

export async function getUserRepositoryPermission(
  app: GitHubApp,
  repository: RepositoryRef,
  username: string,
): Promise<RepositoryPermission> {
  const octokit = await app.getInstallationOctokit(Number(repository.installationId));
  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
    owner: repository.owner,
    repo: repository.name,
    username,
  });
  const permission = data.permission;
  return permission === "admin" || permission === "write" || permission === "read"
    ? permission
    : "none";
}

export async function getRepositoryState(app: GitHubApp, repository: RepositoryRef) {
  const octokit = await app.getInstallationOctokit(Number(repository.installationId));
  const { data } = await octokit.rest.repos.get({ owner: repository.owner, repo: repository.name });
  return {
    githubRepoId: BigInt(data.id),
    defaultBranch: data.default_branch,
    isArchived: data.archived,
    isDisabled: data.disabled,
  };
}

export async function openPullRequest(
  app: GitHubApp,
  repository: RepositoryRef,
  params: { title: string; body: string; head: string; base: string },
): Promise<{ number: number; url: string }> {
  const octokit = await app.getInstallationOctokit(Number(repository.installationId));
  const { data } = await octokit.rest.pulls.create({
    owner: repository.owner,
    repo: repository.name,
    title: params.title,
    body: params.body,
    head: params.head,
    base: params.base,
  });
  return { number: data.number, url: data.html_url };
}
