import { type NextRequest, NextResponse } from "next/server";
import { OAuthExchangeError } from "@/core/github/oauth";
import { baseCookieOptions, cookieNames, decodeOAuthState, statesMatch } from "@/web/auth/cookies";
import { completeGitHubSignIn } from "@/web/auth/oauth";
import { createSession, destroySession } from "@/web/auth/session";
import { services } from "@/web/services";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { config, db, logger } = services();
  const names = cookieNames(config.appUrl);
  const params = request.nextUrl.searchParams;

  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/sign-in?error=${reason}`, config.appUrl));
    response.cookies.delete(names.oauthState);
    return response;
  };

  if (params.get("error")) {
    return fail("access_denied");
  }

  // A callback without our state cookie was not started by this browser. That includes
  // GitHub-initiated redirects, which are answered by asking the user to sign in normally
  // rather than by consuming a code we did not request.
  const expected = decodeOAuthState(request.cookies.get(names.oauthState)?.value);
  const code = params.get("code");
  if (!expected || !code || !statesMatch(expected.state, params.get("state"))) {
    return fail("state_mismatch");
  }

  try {
    const { user, installationCount, repositoryCount } = await completeGitHubSignIn(code);
    const previousToken = request.cookies.get(names.session)?.value;
    if (previousToken) {
      await destroySession(db, previousToken);
    }
    const session = await createSession(db, user.id, config.session.ttlHours);
    logger.info({ userId: user.id, installationCount, repositoryCount }, "User signed in");

    const response = NextResponse.redirect(new URL(expected.returnTo, config.appUrl));
    response.cookies.delete(names.oauthState);
    response.cookies.set(names.session, session.token, {
      ...baseCookieOptions(config.appUrl),
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    logger.error({ err: error }, "GitHub sign-in failed");
    return fail(error instanceof OAuthExchangeError ? "code_rejected" : "github_unavailable");
  }
}
