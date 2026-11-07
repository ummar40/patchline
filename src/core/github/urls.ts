export function repositoryUrl(webUrl: string, fullName: string): string {
  return `${webUrl}/${fullName}`;
}

export function cloneUrl(webUrl: string, fullName: string): string {
  return `${webUrl}/${fullName}.git`;
}

export function commitUrl(webUrl: string, fullName: string, sha: string): string {
  return `${webUrl}/${fullName}/commit/${sha}`;
}

export function branchUrl(webUrl: string, fullName: string, branch: string): string {
  return `${webUrl}/${fullName}/tree/${branch.split("/").map(encodeURIComponent).join("/")}`;
}

export function newInstallationUrl(webUrl: string, appSlug: string): string {
  return `${webUrl}/apps/${appSlug}/installations/new`;
}

export function installationSettingsUrl(
  webUrl: string,
  installation: {
    githubInstallationId: bigint;
    accountLogin: string;
    accountType: "USER" | "ORGANIZATION";
  },
): string {
  return installation.accountType === "ORGANIZATION"
    ? `${webUrl}/organizations/${installation.accountLogin}/settings/installations/${installation.githubInstallationId}`
    : `${webUrl}/settings/installations/${installation.githubInstallationId}`;
}
