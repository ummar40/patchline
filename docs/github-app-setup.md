# GitHub App setup

The product uses one GitHub App for three things: signing users in, discovering which
repositories they can reach, and acting on repositories with short-lived installation tokens.

## Automatic registration (recommended)

```bash
npm run github:create-app                 # personal account
npm run github:create-app -- --org acme   # organization you administer
```

Open the printed local URL, confirm on GitHub, and the script writes these values into `.env`:
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
`GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_PRIVATE_KEY` (base64) and the commit author identity of the
app's bot account. It uses `APP_URL` from `.env` for the callback and setup URLs, so set that
first if you are not using `http://localhost:3000`.

## Manual registration

GitHub > Settings > Developer settings > GitHub Apps > New GitHub App.

| Field                                                  | Value                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Homepage URL                                           | `<APP_URL>`                                                                                                   |
| Callback URL                                           | `<APP_URL>/api/auth/github/callback`                                                                          |
| Expire user authorization tokens                       | enabled                                                                                                       |
| Request user authorization (OAuth) during installation | disabled                                                                                                      |
| Setup URL                                              | `<APP_URL>/api/github/setup`                                                                                  |
| Redirect on update                                     | enabled                                                                                                       |
| Webhook                                                | Active only if `<APP_URL>` is reachable from GitHub; URL `<APP_URL>/api/github/webhook`, with a random secret |
| Repository permissions                                 | Contents: Read and write. Pull requests: Read and write. Metadata: Read-only                                  |
| Organization and account permissions                   | none                                                                                                          |
| Subscribe to events                                    | Repository (optional; installation events are always delivered)                                               |
| Where can this app be installed                        | Only on this account, until you are ready for customers                                                       |

Do not grant the Workflows permission. The product refuses to modify CI workflow files, and
without the permission GitHub would reject such a push anyway.

After creating the app: generate a private key, generate a client secret, and fill in `.env`. The
private key can be pasted as one line with `\n` escapes or as base64 of the PEM file:

```bash
base64 -w0 your-app.private-key.pem        # Linux
base64 -i your-app.private-key.pem         # macOS
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("your-app.private-key.pem"))
```

For commits to link to the app, set:

```
GIT_COMMIT_AUTHOR_NAME=<app-slug>[bot]
GIT_COMMIT_AUTHOR_EMAIL=<bot-user-id>+<app-slug>[bot]@users.noreply.github.com
```

where the bot user id comes from `https://api.github.com/users/<app-slug>[bot]`.

## Webhooks in local development

GitHub cannot reach `localhost`. The product works without webhooks: access is synchronised every
time a user signs in or presses "Sync with GitHub". To exercise the webhook handler locally,
forward deliveries with a tunnel (for example `npx smee-client`), activate the webhook in the app
settings, and set `GITHUB_WEBHOOK_SECRET`. Deliveries with a missing or wrong signature are
rejected with 401.

## How installation ownership is established

1. The user signs in through the app's OAuth flow.
2. With that short-lived user token the server calls `GET /user/installations` and, per
   installation, `GET /user/installations/{id}/repositories`, stores the result as access rows,
   and discards the token.
3. After installing or reconfiguring the app, GitHub redirects to the Setup URL. The
   `installation_id` in that redirect can be forged, so it is ignored; the handler simply repeats
   step 1 and 2.
4. Creating a job checks live, with an installation token, that the user has write access.
