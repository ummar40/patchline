import {
  type GitHubApp,
  type RepositoryRef,
  type TokenPermissions,
  createRepositoryToken,
  getRepositoryState,
  openPullRequest,
} from "@/core/github/app";

// The three GitHub operations a job needs. Kept as an interface so the pipeline can be
// exercised end to end in tests without reaching GitHub.
export interface GitHubGateway {
  repositoryState(
    repository: RepositoryRef,
  ): Promise<{ defaultBranch: string; isArchived: boolean; isDisabled: boolean }>;
  repositoryToken(params: {
    installationId: bigint;
    githubRepoId: bigint;
    permissions: TokenPermissions;
  }): Promise<string>;
  openPullRequest(
    repository: RepositoryRef,
    params: { title: string; body: string; head: string; base: string },
  ): Promise<{ number: number; url: string }>;
}

export function createGitHubGateway(app: GitHubApp): GitHubGateway {
  return {
    repositoryState: (repository) => getRepositoryState(app, repository),
    repositoryToken: (params) => createRepositoryToken(app, params),
    openPullRequest: (repository, params) => openPullRequest(app, repository, params),
  };
}
