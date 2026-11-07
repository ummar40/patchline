import "server-only";
import { createUserOctokit } from "@/core/github/app";
import { exchangeAuthorizationCode } from "@/core/github/oauth";
import { fetchUserView, persistUserView, upsertUserFromProfile } from "@/core/github/user-view";
import { services } from "../services";

export function oauthRedirectUri(appUrl: string): string {
  return `${appUrl}/api/auth/github/callback`;
}

// One pass with a short-lived user token: identify the user, record exactly which
// installations and repositories GitHub lets them reach, then let the token go out of scope.
export async function completeGitHubSignIn(code: string) {
  const { config, db } = services();
  const userToken = await exchangeAuthorizationCode(config.github, {
    code,
    redirectUri: oauthRedirectUri(config.appUrl),
  });
  const view = await fetchUserView(createUserOctokit(config.github, userToken));
  const user = await upsertUserFromProfile(db, view.profile);
  await persistUserView(db, user.id, view);
  return {
    user,
    installationCount: view.installations.length,
    repositoryCount: view.installations.reduce(
      (total, item) => total + item.repositories.length,
      0,
    ),
  };
}
