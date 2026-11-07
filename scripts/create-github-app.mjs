// Registers a GitHub App for this deployment through GitHub's app manifest flow and writes
// its credentials into .env. Nothing secret is printed.
//
//   npm run github:create-app                  register under your personal account
//   npm run github:create-app -- --org acme    register under an organization you administer
//
// The app requests the minimum permissions the product needs: repository contents and pull
// requests (read and write) and metadata (read). It does not request the workflows permission.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { loadEnvFile } from "node:process";

const ENV_FILE = ".env";
const LOCAL_PORT = Number(process.env.GITHUB_APP_SETUP_PORT ?? 3457);

if (!existsSync(ENV_FILE)) {
  await copyFile(".env.example", ENV_FILE);
  console.log("Created .env from .env.example.");
}
loadEnvFile(ENV_FILE);

const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const githubWebUrl = (process.env.GITHUB_WEB_URL ?? "https://github.com").replace(/\/+$/, "");
const githubApiUrl = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, "");
const orgIndex = process.argv.indexOf("--org");
const organization = orgIndex === -1 ? undefined : process.argv[orgIndex + 1];
const publiclyReachable = appUrl.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(appUrl);

if (process.env.GITHUB_APP_ID) {
  console.error(
    "GITHUB_APP_ID is already set in .env. Remove the GitHub App values first if you want to register a new app.",
  );
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const manifest = {
  name: `Patchline ${randomBytes(3).toString("hex")}`,
  url: appUrl,
  description: "Opens verified pull requests for maintenance jobs.",
  public: false,
  redirect_url: `http://localhost:${LOCAL_PORT}/callback`,
  callback_urls: [`${appUrl}/api/auth/github/callback`],
  setup_url: `${appUrl}/api/github/setup`,
  setup_on_update: true,
  request_oauth_on_install: false,
  // GitHub cannot deliver webhooks to a local address, so they start disabled there. The app
  // works without them; they only keep repository metadata fresh between sign-ins.
  hook_attributes: { url: `${appUrl}/api/github/webhook`, active: publiclyReachable },
  default_permissions: { contents: "write", pull_requests: "write", metadata: "read" },
  default_events: publiclyReachable ? ["repository"] : [],
};

const registrationUrl = organization
  ? `${githubWebUrl}/organizations/${encodeURIComponent(organization)}/settings/apps/new?state=${state}`
  : `${githubWebUrl}/settings/apps/new?state=${state}`;

const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function setEnvValues(content, values) {
  let result = content;
  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^#?\\s*${name}=.*$`, "m");
    result = pattern.test(result)
      ? result.replace(pattern, line)
      : `${result.trimEnd()}\n${line}\n`;
  }
  return result;
}

async function finish(code) {
  const response = await fetch(
    `${githubApiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub rejected the manifest code (HTTP ${response.status}).`);
  }
  const app = await response.json();

  // Commits are attributed to the app's bot account so they link to the app on GitHub.
  const botLogin = `${app.slug}[bot]`;
  const bot = await fetch(`${githubApiUrl}/users/${encodeURIComponent(botLogin)}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  const botId = bot.ok ? (await bot.json()).id : undefined;

  const updated = setEnvValues(await readFile(ENV_FILE, "utf8"), {
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_SLUG: app.slug,
    GITHUB_APP_CLIENT_ID: app.client_id,
    GITHUB_APP_CLIENT_SECRET: app.client_secret,
    GITHUB_WEBHOOK_SECRET: app.webhook_secret ?? "",
    GITHUB_APP_PRIVATE_KEY: Buffer.from(app.pem).toString("base64"),
    GIT_COMMIT_AUTHOR_NAME: botLogin,
    GIT_COMMIT_AUTHOR_EMAIL: `${botId ? `${botId}+` : ""}${botLogin}@users.noreply.github.com`,
  });
  await writeFile(ENV_FILE, updated, { mode: 0o600 });
  return app;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${LOCAL_PORT}`);

  if (url.pathname === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<title>Register GitHub App</title>
<body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto;">
<h1>Register the GitHub App</h1>
<p>You will be sent to GitHub to confirm the app's name and permissions.</p>
<form action="${escapeHtml(registrationUrl)}" method="post">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Continue to GitHub</button>
</form>
</body>`);
    return;
  }

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.get("state") !== state) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("The state parameter did not match. Start again.");
      return;
    }
    finish(code)
      .then((app) => {
        const installUrl = `${githubWebUrl}/apps/${app.slug}/installations/new`;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html>
<title>GitHub App registered</title>
<body style="font-family: system-ui; max-width: 40rem; margin: 4rem auto;">
<h1>GitHub App registered</h1>
<p>Credentials were written to .env. Next, <a href="${escapeHtml(installUrl)}">install the app</a> on a test repository, then start the web app and the worker.</p>
</body>`);
        console.log(
          `Registered GitHub App "${app.slug}" and wrote its credentials to ${ENV_FILE}.`,
        );
        console.log(`Install it on a repository: ${installUrl}`);
        server.close();
      })
      .catch((error) => {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("Registration failed. See the terminal for details.");
        console.error(error instanceof Error ? error.message : error);
        server.close(() => process.exit(1));
      });
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(LOCAL_PORT, "127.0.0.1", () => {
  console.log(`Open http://localhost:${LOCAL_PORT} in your browser to register the GitHub App.`);
  console.log(`App URL: ${appUrl}${organization ? `, organization: ${organization}` : ""}`);
});
