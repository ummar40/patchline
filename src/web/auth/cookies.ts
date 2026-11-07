import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const DEFAULT_RETURN_PATH = "/overview";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

const oauthStateSchema = z.object({ state: z.string().min(16), returnTo: z.string() });
export type OAuthState = z.output<typeof oauthStateSchema>;

// The __Host- prefix pins the cookie to this exact origin, but browsers only accept it over
// HTTPS, so plain-HTTP local development falls back to unprefixed names.
export function cookieNames(appUrl: string) {
  const secure = appUrl.startsWith("https://");
  return {
    secure,
    session: secure ? "__Host-patchline_session" : "patchline_session",
    oauthState: secure ? "__Host-patchline_oauth" : "patchline_oauth",
  };
}

export function baseCookieOptions(appUrl: string) {
  return {
    httpOnly: true,
    secure: cookieNames(appUrl).secure,
    sameSite: "lax" as const,
    path: "/",
  };
}

// Only same-origin absolute paths are accepted, which rules out open redirects through
// values such as "//evil.example" or "/\evil.example".
export function sanitizeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) {
    return DEFAULT_RETURN_PATH;
  }
  return value;
}

export function encodeOAuthState(value: OAuthState): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeOAuthState(cookie: string | undefined): OAuthState | null {
  if (!cookie) {
    return null;
  }
  try {
    const parsed = oauthStateSchema.safeParse(
      JSON.parse(Buffer.from(cookie, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function statesMatch(expected: string, received: string | null): boolean {
  if (!received) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}
