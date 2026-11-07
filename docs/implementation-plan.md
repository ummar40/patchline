# Implementation plan

Status legend:

- [x] implemented and exercised (by the automated suite, a production build, or a manual check
      recorded below)
- [~] implemented, compiles and is lint-clean, but has not been exercised against the real
  external service it talks to
- [ ] not started

Do not mark anything [x] that was not actually exercised.

## Phase 1 - Foundation

- [x] Project scaffold: TypeScript 6 strict, ESLint 10, Prettier, Vitest 5, source checks (ASCII,
      banned phrases, leftover markers)
- [x] Environment validation for web and worker (unit tests)
- [x] Prisma 7 schema and initial migration (applied to PostgreSQL 17)
- [x] Docker Compose for PostgreSQL and Redis
- [x] Architecture document

## Phase 2 - Accounts, shell, job creation

- [x] Session storage (digest only), cookie handling, return-path sanitising
- [~] GitHub App OAuth sign-in round trip (needs a registered GitHub App)
- [x] Application shell and navigation (production server checked over HTTP with a seeded
      session: every screen, redirects for missing and forged sessions, 404 for unknown jobs;
      screenshots reviewed in light, dark and mobile layouts)
- [x] Overview, repositories, repository detail, new job, job list, settings
- [x] Job creation with durable record, per-user active job limit and queue dispatch
      (service layer tested; the Server Action's live GitHub permission check is [~])

## Phase 3 - GitHub App integration

- [x] Persisting installations, repositories and per-user access from a user's GitHub view
      (integration tests against PostgreSQL)
- [~] Fetching that view from the GitHub API with a user token
- [x] Setup URL handling that never reads installation_id
- [x] Webhook signature verification and idempotent delivery handling (unit and integration
      tests, plus signed, replayed, wrongly signed and unsigned deliveries posted to the running
      route; it has not yet received a delivery from GitHub itself)
- [~] Live write-access check at job creation
- [~] App registration helper (manifest flow)

## Phase 4 - Queue, worker, sandbox

- [x] BullMQ queue contract and reconciler (integration tests against Redis and PostgreSQL)
- [x] Docker sandbox: isolation, limits, timeouts, abort, environment allow-list, cleanup,
      namespace-scoped orphan sweep (integration tests against Docker)
- [x] State transitions with compare-and-set, event logging, cancellation
- [x] Worker start-up from the production bundle: refuses to start without configuration and
      names the variables; with a complete configuration it passes its Docker, PostgreSQL and
      Redis checks and starts consuming
- [~] Signal-driven graceful shutdown (implemented; not exercised, because the development host
  is Windows, where a console signal cannot be sent to a background process)

## Phase 5 - Model provider and tools

- [~] OpenAI Responses API provider (typed against SDK 7; never called with a real key)
- [x] Typed, validated repository tools; strict function schemas; command and path policies

## Phase 6 - Maintenance pipeline

- [x] Deterministic repository detection and dependency installation (Node.js; the Python path
      is implemented but only the Node.js path is covered by the end-to-end suite)
- [x] Analysis, reproduction, planning, implementation phases (driven by a scripted model)
- [x] Baseline and candidate verification with an evidence gate
- [x] Independent diff review and change-set policy
- [x] Isolated publish: fresh clone, patch, commit, push with per-operation credentials
- [~] Pull request creation through the GitHub API

## Phase 7 - Job detail experience and operations

- [x] Timeline, changes, verification, commands, analysis and plan, usage views
- [x] Failure categories and factual explanations surfaced in the UI

## Phase 8 - End-to-end proof

- [x] Controlled fixture repository with a deliberate defect (`test/fixtures/buggy-cart`)
- [x] Automated pipeline suite: nine scenarios with the real Docker sandbox, real PostgreSQL and
      a credential-enforcing local git remote (`test/pipeline.e2e.test.ts`)
- [ ] Live run against GitHub and OpenAI (needs credentials; steps in docs/e2e-runbook.md)

## Phase 9 - Security and reliability review

- [x] Review pass recorded in docs/security.md. Findings fixed during the pass: webhook
      deliveries were marked handled before processing succeeded; git output parsed on NUL
      separators was being sanitised as terminal text; the orphan sweep could remove another
      deployment's workspaces (now namespace-scoped); a cancellation racing with publishing
      could abort a publish; oversized webhook bodies were buffered before being rejected.
      Found by running the built processes: the health probe reported a false outage until the
      Redis connection was ready; the commit author check rejected GitHub bot addresses; a
      default database password equal to an ordinary word caused that word to be redacted from
      every log line.
- [ ] Independent penetration test of the sandbox and the OAuth flow

## Phase 10 - Landing page and onboarding

- [x] Restrained landing page with no unsupported claims
- [x] Empty states that lead to the next action; GitHub connection page explains the access model

## Next highest-value task

Run the live end-to-end runbook with real credentials, then put dependency installation behind an
allow-listing egress proxy (docs/security.md, limitation 2).
