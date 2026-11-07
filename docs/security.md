# Security model

Every customer repository is treated as hostile. This document states what the system relies on,
what is enforced where, and what is not yet covered. Keep it honest: if a control is missing, it
belongs under "Known limitations", not in the list of controls.

## Trust boundaries

| Zone                                 | Trusted                    | Holds secrets                                       | Runs repository code                       |
| ------------------------------------ | -------------------------- | --------------------------------------------------- | ------------------------------------------ |
| Web process                          | yes                        | session store, OAuth client secret, GitHub App key  | never (lint-enforced: no process spawning) |
| Worker process                       | yes                        | OpenAI key, GitHub App key, database and Redis URLs | never; it only starts the container CLI    |
| Sandbox container, workspace profile | no                         | none                                                | yes                                        |
| Sandbox container, publish profile   | platform git commands only | a one-repository token, only for fetch and push     | no                                         |
| Model output                         | no                         | none                                                | n/a; it can only request typed tools       |

## Controls

### Sandbox (src/worker/sandbox)

- One `docker run --rm` per command. When the command ends its PID namespace is destroyed, so no
  process started by a test suite survives to tamper with later steps.
- State lives in three per-job named volumes (workspace, home, publish). No host path is mounted.
  The Docker socket is never mounted.
- `--network none` unless platform code asks for egress. Egress is used for: clone, dependency
  installation with commands chosen by platform code from lockfile detection, fetch and push.
  Commands requested by the model never get network access.
- Non-root user, `--cap-drop ALL`, `no-new-privileges`, read-only root filesystem, size-limited
  tmpfs, CPU, memory (swap disabled) and PID limits, wall-clock timeout enforced by killing the
  container, bounded output capture.
- The container environment is an explicit allow-list. The Docker CLI itself is started with an
  allow-listed environment, so worker secrets cannot be forwarded even by mistake
  (test: "does not expose the worker's environment").
- Resources are labelled with the job id and a deployment namespace, removed when the job ends,
  and swept (own namespace only) at worker start and on every reconcile tick.
- `SANDBOX_RUNTIME` selects a hardened OCI runtime (for example gVisor) without code changes.

### Credentials

- No GitHub token is stored. User tokens live for one synchronisation pass. Installation tokens
  are minted per step, restricted to one repository and to `contents: read` (clone) or
  `contents: write` (push), handed to git through environment-based config (never written to
  `.git/config`, never in argv), and unregistered from the redactor when the job ends.
- Publishing never runs git with credentials in the working copy, because repository code could
  have planted hooks or config there. The commit is rebuilt from a patch in a fresh clone on a
  separate volume with a throwaway home directory; apply and commit run without network or token;
  push runs with hooks disabled.
- The GitHub App requests contents, pull requests and metadata only. It has no workflows
  permission, never merges, never force-pushes and never deletes refs.

### Authorization

- Access rows are written only from `GET /user/installations` and
  `GET /user/installations/{id}/repositories` called with the signed-in user's own token. The
  `installation_id` sent to the Setup URL is ignored. Webhooks update shared rows but never grant
  access.
- Every read goes through `src/core/access`. Job creation additionally asks GitHub, at that
  moment, whether the user has write access.
- Sessions: 256-bit random token, SHA-256 digest stored, HttpOnly, SameSite=Lax, `__Host-` prefix
  and Secure over HTTPS. OAuth uses a per-attempt state cookie compared in constant time; a
  callback without matching state is never exchanged. Mutations are Server Actions (same-origin
  enforced by the framework).

### Model and prompt injection

- Repository content reaches the model only as tool output. System instructions are a constant
  string; user-supplied job text is delimited and labelled as description, not instruction.
- Capability restriction is the real defence: tools are typed and validated, paths are confined
  to the repository and exclude `.git` and CI workflows, commands pass a policy and run without
  network or credentials, the phase decides which tools are callable (enforced server-side as
  well as through `tool_choice`), and the only output is a pull request a person must review.
- The change set is checked independently of how files were changed: size and file-count limits,
  protected paths, dependency lockfiles, non-UTF-8 content. Verification is run by the platform,
  not the model, and an independent review conversation sees the captured patch, not the author's
  reasoning. Mentions in model- or user-written pull request text are defused.
- Requests use `store: false`; reasoning state is carried as encrypted items.

### Logging

- Structured logs and persisted events pass through redaction: token, key, JWT, PEM and URL
  credential patterns, exact values loaded from configuration, and per-job tokens. Whole
  environment objects are never logged.

## Known limitations

1. **Container isolation is kernel-shared.** With the default runtime a kernel exploit escapes the
   sandbox. For untrusted repositories run the worker on dedicated hosts with gVisor or Kata
   (`SANDBOX_RUNTIME`) or replace the driver with a microVM implementation.
2. **Egress during dependency installation is not filtered by the application.** Install scripts
   can reach the internet and, depending on the Docker network, the host and internal services. In
   production, point `SANDBOX_EGRESS_NETWORK` at a network that only reaches an allow-listing
   proxy (package registries and the git host) and firewall private ranges and metadata addresses.
   The local development default (`bridge`) does not do this. Repository contents can therefore be
   exfiltrated by a malicious dependency during installation, as on any CI system.
3. **No disk quota on the workspace volume.** A hostile repository can fill the Docker host's
   disk within the command timeout. Use a volume driver or filesystem with quotas in production.
4. **The command policy is a guard, not a boundary.** `npm test` runs arbitrary repository code by
   design. The sandbox is what contains it.
5. **Access rows can be stale between sign-ins** for read access (viewing jobs and diffs of a
   repository the user has since lost). Write access is re-checked live. Shorten
   `SESSION_TTL_HOURS` to tighten this.
6. **Artifacts and command output are customer data at rest** in PostgreSQL, redacted for known
   secret patterns only. Patches are stored unredacted because they must apply exactly.
   Encrypt the database and define retention.
7. **No rate limiting** on authentication endpoints or job creation beyond the per-user active
   job limit. Put the web app behind a rate-limiting proxy.
8. **Patches travel as UTF-8 text.** Changes to files in other encodings are refused rather than
   risk publishing something different from what was verified.
9. **Single toolchain image.** The sandbox image ships Node.js and Python. Other ecosystems stop
   with `UNSUPPORTED_REPOSITORY` until an image containing them is configured.
