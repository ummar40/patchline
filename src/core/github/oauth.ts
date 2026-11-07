import { z } from "zod";

export type OAuthClientConfig = {
  webUrl: string;
  clientId: string;
  clientSecret: string;
};

export class OAuthExchangeError extends Error {
  constructor(readonly reason: string) {
    super(`GitHub rejected the authorization code: ${reason}`);
    this.name = "OAuthExchangeError";
  }
}

const tokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);

export function buildAuthorizationUrl(
  config: OAuthClientConfig,
  params: { state: string; redirectUri: string },
): string {
  const url = new URL("/login/oauth/authorize", config.webUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  return url.toString();
}

// The returned user token is used for one synchronisation pass and then dropped. It is never
// persisted, so callers must not hold on to it either.
export async function exchangeAuthorizationCode(
  config: OAuthClientConfig,
  params: { code: string; redirectUri: string },
): Promise<string> {
  const response = await fetch(new URL("/login/oauth/access_token", config.webUrl), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: params.code,
      redirect_uri: params.redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new OAuthExchangeError(`HTTP ${response.status}`);
  }
  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new OAuthExchangeError("unexpected response shape");
  }
  if ("error" in parsed.data) {
    throw new OAuthExchangeError(parsed.data.error);
  }
  return parsed.data.access_token;
}
