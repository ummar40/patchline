# Architecture

Patchline turns a described software issue into a verified GitHub pull request. This document
records the decisions that shape the system. Keep it in sync with meaningful design changes.

## System overview

```
browser
   |
web process (Next.js)             control plane: auth, GitHub App flows, job API and UI
   |            \
PostgreSQL      Redis (BullMQ)    durable job records / dispatch
   |            /
worker process                    job pipeline, model orchestration, GitHub publishing
   |
sandbox manager (Docker CLI)
   |
disposable containers + per-job volumes      the only place repository code runs
```

Two processes share one codebase:

- `src/app`, `src/components`, `src/web`: the web control plane. It never spawns processes.
- `src/worker`: the background worker. Only `src/worker/sandbox` may start processes, and the
  only process it starts is the container runtime CLI.
- `src/core`, `src/db`: shared domain logic (configuration, logging, job state, queue contract,
  GitHub App client, access control) and the database client.

ESLint `no-restricted-imports` rules enforce these boundaries, including a ban on
`child_process` everywhere outside `src/worker/sandbox`.

## Decisions

### D1. Single package instead of a workspace monorepo

The web app and worker are separate processes with separate configuration, but live in one npm
package. Workspace monorepos rely on symlinks or junctions, which are unavailable on some
development filesystems (the initial development machine uses a FAT32 volume). One package
also keeps a single toolchain configuration. Import boundaries are enforced by lint rules
rather than package boundaries. Splitting into workspaces later is mechanical because the
directory layout already mirrors the process boundary.

### D2. Sign-in and authorization both come from the GitHub App

Users sign in with the GitHub App's OAuth flow. There is no separate OAuth App and no password
store. Every sign-in (and every "Sync with GitHub") performs the same steps with the short-lived
user token: read the profile, list the installations the user can access, list the repositories
the user can access inside each installation, persist that as `InstallationAccess` and
`RepositoryAccess`, and discard the token. User tokens are never stored.

The `installation_id` GitHub passes to the post-install Setup URL is attacker-controllable, so it
is never trusted. The Setup URL handler only starts a sync; access is granted solely from what
GitHub returns for the signed-in user.

Creating a job additionally checks, with an installation token, that the user currently holds
write access to the repository. Stale access rows therefore cannot be used to push changes.

Sessions are random 256-bit tokens in an HttpOnly SameSite=Lax cookie; only the SHA-256 digest is
stored. State-changing requests go through Server Actions, which enforce same-origin.

### D3. PostgreSQL is the source of truth; Redis only dispatches

A job is a row in `MaintenanceJob`. The BullMQ payload is just the job id. If enqueueing fails
after the row is written, the worker's reconciler finds `QUEUED` rows with no queue entry and
dispatches them; BullMQ job ids equal database ids, so dispatch is idempotent.

Queue-level retries are disabled. A maintenance run is expensive and publishes to GitHub, so a
run that is interrupted (worker crash, shutdown) is marked `FAILED` with category
`WORKER_INTERRUPTED` and the user can start a follow-up job.

### D4. Explicit job state machine with compare-and-set persistence

`src/core/jobs/state-machine.ts` defines every legal transition. `transitionJob` applies a
transition with a conditional update on the current status inside a transaction that also
appends the `JobEvent`, so concurrent writers (worker, cancellation from the web) cannot
produce an illegal state. Cancellation of a running job is a request flag that the worker
observes; `CREATING_PR` is not cancellable because the branch may already be public.

### D5. Sandbox: one container per command, state in per-job volumes

Every operation that touches repository content runs as its own `docker run --rm` container
with the job's named volumes mounted. Nothing from the host filesystem is mounted, which also
makes behaviour identical on Windows (Docker Desktop) and Linux. Each container gets: no
network by default, a non-root user, all capabilities dropped, `no-new-privileges`, read-only
root filesystem, size-limited tmpfs, CPU, memory and PID limits, an explicit minimal
environment, and a hard wall-clock timeout enforced by killing the container. When a command
ends, its PID namespace is destroyed, so nothing a test suite spawned can linger and tamper
with later steps.

Network is a per-command decision made by platform code, never by the model: clone, dependency
installation with detected package-manager commands, fetch and push. Commands the model
requests always run without network.

Volumes and containers carry the job id and a deployment namespace as labels. A job removes its
own resources when it ends; the worker also sweeps its namespace on start and on every reconcile
tick for resources whose job can no longer be running. The namespace keeps deployments that share
a container host, or a test run next to a development worker, from removing each other's
workspaces.

The `Sandbox` interface (`src/worker/sandbox/types.ts`) is runtime-agnostic. `SANDBOX_RUNTIME`
selects an OCI runtime such as gVisor without code changes; a microVM implementation can
replace the Docker driver behind the same interface.

### D6. Credentials never share a container with repository code

- Clone uses an installation token restricted to the one repository with `contents: read`. It
  is passed as a git config environment variable to a container that only runs `git clone`,
  and is never written to disk.
- Publishing does not run git with credentials in the working copy, because repository code
  could have rewritten `.git/config` or hooks there. Instead the worker captures the change as
  a binary patch (data), creates a fresh clone in a new volume, applies and commits the patch
  in a container with no network and no token, and pushes from a container that has the token
  but has only ever seen platform-authored git state. Hooks are disabled for the push.
- The OpenAI key, database URL and Redis URL exist only in the worker process environment and
  are never passed to `docker run`.

### D7. Model orchestration: platform-driven phases, one transcript

The worker, not the model, drives the phase sequence (analyze, reproduce, plan, implement,
review). Each phase appends a phase instruction to a single transcript and runs a bounded tool
loop until the model calls that phase's `submit_*` tool with a schema-validated result. The
tool list is constant for prompt-cache stability; `tool_choice.allowed_tools` and server-side
checks restrict what each phase may call. Verification is never delegated to the model: the
worker runs the detected test, lint, typecheck and build commands itself and records exit
codes, before the change (baseline) and after it.

Requests use the OpenAI Responses API with `store: false` and encrypted reasoning items, so
no customer code is retained by the provider between calls. Model id, reasoning effort, token
limits, retry policy and prices are configuration, applied in one provider module.

### D8. Prompt-injection posture: capability restriction first

Repository content reaches the model only as tool output, labelled as untrusted data. The
system prompt states that such content cannot change rules. The real defence is that a
manipulated model still cannot do harm: no network, no credentials, path-validated file
access confined to the workspace, a command policy, size and path limits on the change set, a
pull request as the only output, and no merge capability.

### D9. Evidence-gated publishing

A pull request is opened only if the change set is non-empty and within policy, the test
category passes after the change, no category that passed at baseline fails afterwards, and
the review phase approves. Anything else ends as `NEEDS_HUMAN` or `FAILED` with a category and
a factual summary. The diff and all command output remain available on the job page either way.

## Data model

See `prisma/schema.prisma`. `User`, `AuthIdentity`, `Session`; `GitHubInstallation`,
`Repository` with `InstallationAccess` and `RepositoryAccess` join tables; `MaintenanceJob` with
`JobEvent`, `JobArtifact`, `CommandExecution`, `VerificationRun`, `ModelInvocation` and
`PullRequestResult`; `WebhookDelivery` for idempotent webhook handling. GitHub numeric ids are
`BigInt`. No GitHub token of any kind is stored.

## Configuration

`src/core/config` validates the environment with zod at process start (`instrumentation.ts`
for the web app, `main.ts` for the worker) and fails fast with the names of invalid variables.
The web app never needs the OpenAI key; the worker never needs the OAuth client secret.

## Observability

Structured JSON logs (pino) with pattern-based and exact-value secret redaction. Every job has
a stable id carried in logs, events, container names and volume labels. `JobEvent` is the
user-visible timeline; `CommandExecution`, `VerificationRun` and `ModelInvocation` hold the
detailed evidence, including durations, exit codes, retry counts and token usage.
