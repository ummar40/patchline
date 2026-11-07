import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/core/github/oauth";
import {
  OAUTH_STATE_MAX_AGE_SECONDS,
  baseCookieOptions,
  cookieNames,
  encodeOAuthState,
  sanitizeReturnPath,
} from "@/web/auth/cookies";
import { oauthRedirectUri } from "@/web/auth/oauth";
import { services } from "@/web/services";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const { config } = services();
  const state = randomBytes(24).toString("base64url");
  const returnTo = sanitizeReturnPath(request.nextUrl.searchParams.get("returnTo"));

  const response = NextResponse.redirect(
    buildAuthorizationUrl(config.github, { state, redirectUri: oauthRedirectUri(config.appUrl) }),
  );
  response.cookies.set(
    cookieNames(config.appUrl).oauthState,
    encodeOAuthState({ state, returnTo }),
    {
      ...baseCookieOptions(config.appUrl),
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    },
  );
  return response;
}
