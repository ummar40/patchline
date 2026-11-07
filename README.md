# Patchline

From software issue to verified pull request.

Connect a GitHub repository, describe a problem, and get a pull request whose tests, lint, type
checks and build were actually run in an isolated sandbox. When the evidence is not there, the job
stops and says why instead of opening a pull request.

- Architecture and design decisions: [docs/architecture.md](docs/architecture.md)
- Security model and known limitations: [docs/security.md](docs/security.md)
- GitHub App setup: [docs/github-app-setup.md](docs/github-app-setup.md)
- Live end-to-end runbook: [docs/e2e-runbook.md](docs/e2e-runbook.md)
- Status of each build phase: [docs/implementation-plan.md](docs/implementation-plan.md)

## Requirements

- Node.js 22.12 or newer (24 LTS recommended; `.nvmrc` pins 24)
- Docker (Docker Desktop on Windows and macOS, Docker Engine on Linux)
- A GitHub account that can register a GitHub App
- An OpenAI API key for the worker

Develop on a filesystem that supports symlinks and fast small-file I/O (NTFS, ext4, APFS). The
project installs on FAT32/exFAT volumes, but dependency installation and builds are very slow
there, and git needs a `safe.directory` exception because those filesystems record no ownership.

## Local setup

```bash
cp .env.example .env            # then fill in the blanks as you go
npm install                     # also generates the database client
npm run infra:up                # PostgreSQL and Redis in Docker
npm run db:deploy               # apply migrations
npm run sandbox:build           # build the job execution image (several minutes, once)
npm run github:create-app       # register a GitHub App and write its credentials to .env
```

Add your `OPENAI_API_KEY` to `.env`. `OPENAI_MODEL`, reasoning effort, token prices and every
runtime limit are configuration; see the comments in `.env.example`.

Run the two processes in separate terminals:

```bash
npm run dev                     # web app on http://localhost:3000
npm run dev:worker              # background worker
```

Both validate their environment at startup and exit with the names of any missing or invalid
variables. Stop either with Ctrl+C; the worker finishes or interrupts running jobs, marks them
accordingly and removes their sandboxes before exiting.

Then: sign in with GitHub, install the app on a test repository from Settings > GitHub
connection, pick the repository, and create a job.

## Scripts

| Script                                                | Purpose                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev` / `npm run dev:worker`                  | Development servers with reload                                                                   |
| `npm run build` / `npm run build:worker`              | Production builds (`.next/`, `dist/worker/main.js`)                                               |
| `npm run start` / `npm run start:worker`              | Run the production builds                                                                         |
| `npm run lint`, `typecheck`, `format`, `format:check` | Static checks                                                                                     |
| `npm run check:source`                                | ASCII-only, banned phrases and leftover-marker check                                              |
| `npm test`                                            | Unit and integration tests (needs PostgreSQL; Docker suites skip if the sandbox image is missing) |
| `npm run verify`                                      | Everything above, as one quality gate                                                             |
| `npm run db:migrate` / `db:deploy` / `db:studio`      | Prisma migrations and data browser                                                                |
| `npm run infra:up` / `infra:down`                     | Local PostgreSQL and Redis                                                                        |
| `npm run sandbox:build`                               | Build the sandbox image named by `SANDBOX_IMAGE`                                                  |
| `npm run github:create-app`                           | Register a GitHub App through the manifest flow                                                   |

## Tests

`npm test` creates a separate `<database>_test` database next to the development one and applies
migrations to it. The suite covers the job state machine, authorization and installation ownership
against real PostgreSQL, webhook signatures and handling, configuration validation, log redaction,
the command and path policies, tool input validation, the verification gate, the Docker sandbox's
isolation properties, and the whole pipeline against a controlled repository with a deliberate
defect (`test/fixtures/buggy-cart`), a local git remote that enforces per-operation credentials,
and a scripted stand-in for the model. Test doubles live under `test/` only.

## Repository layout

```
src/app, src/components, src/web   web control plane (Next.js); never starts processes
src/worker                         background worker
  sandbox/                         the only code allowed to start a process (the container CLI)
  agent/                           model provider, tools, command and path policies, prompts
  git/, analysis/, verification/   clone and publish, tooling detection, evidence gate
  pipeline/                        job orchestration, recording, pull request content
src/core                           shared: config, logging and redaction, job state, queue, GitHub, access
src/db, prisma/                    database client, schema and migrations
docker/sandbox                     execution image
test/                              integration tests, fixtures and test doubles
```

Import boundaries between these areas are enforced by ESLint.

## Production notes

- Run the web app and the worker as separate services with separate environments. The web app
  does not need `OPENAI_API_KEY`; the worker does not need the OAuth client secret.
- The worker needs access to a container runtime. Give it a dedicated Docker host rather than
  sharing one with other workloads, and read the network guidance in docs/security.md before
  exposing it to untrusted repositories.
- Put PostgreSQL and Redis on a network the sandbox egress network cannot reach.
- Serve the web app over HTTPS. Cookies switch to the `__Host-` prefix automatically.
