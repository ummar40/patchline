# End-to-end runbook

Two levels of end-to-end proof exist.

## 1. Automated, no external credentials

`npm test` runs `test/pipeline.e2e.test.ts`, which drives the real pipeline (`runJob`) against:

- the real Docker sandbox and the real PostgreSQL schema;
- a controlled repository with a deliberate defect (`test/fixtures/buggy-cart`: cart subtotals
  ignore item quantity, and the existing tests do not notice);
- a local smart-HTTP git remote in a container that rejects fetches without the read token and
  pushes without the write token;
- a scripted stand-in for the model and a stand-in for the three GitHub API calls.

It asserts the persisted state sequence, baseline and post-change verification results, that the
pushed branch contains exactly the fix and the regression test on top of the base commit, the pull
request content, token usage accounting, that no token appears in any stored evidence, and that
no sandbox resources remain. Further scenarios cover a repair iteration, verification that never
passes, review-requested changes, a lockfile policy violation, agent escalation, user
cancellation of a running job, and a job whose worker died.

What this does not prove: the real model's behaviour, the real GitHub API calls (installation
tokens, pull request creation), and the OAuth sign-in flow. That is what the live run is for.

## 2. Live run against GitHub and OpenAI

Prerequisites: `.env` completed (see README), GitHub App registered
(`npm run github:create-app`), `OPENAI_API_KEY` set, sandbox image built, infrastructure up,
migrations applied.

1. Create the controlled repository on GitHub from the fixture:

   ```bash
   cp -r test/fixtures/buggy-cart /tmp/buggy-cart && cd /tmp/buggy-cart
   git init -b main && git add -A && git commit -m "Initial commit"
   gh repo create <you>/buggy-cart --private --source . --push
   ```

2. Install the GitHub App on that one repository (Settings > GitHub connection > Install).
3. Start `npm run dev` and `npm run dev:worker`. Sign in. The repository should be listed with
   "Write" access.
4. Create a job:
   - Title: `Cart subtotal ignores item quantity`
   - Problem: `subtotal() in src/cart.js adds each item's price once. A cart with two units of a
4.00 item totals 4.00 instead of 8.00. total() is affected the same way.`
   - Expected behavior: `Each line contributes price * quantity.`
5. Watch the job page. Expected: every state from Preparing to Completed appears in the timeline;
   the Verification tab shows a passing baseline and a passing post-change run of `npm test`; the
   Changes tab shows a one-line fix in `src/cart.js` plus a regression test; "Open pull request"
   links to a real pull request on a `maintenance/...` branch authored by the app's bot.
6. Negative checks worth doing once:
   - Cancel a job during Analyzing: status becomes Cancelled within seconds, and
     `docker volume ls --filter label=patchline.sandbox=true` is empty afterwards.
   - Stop the worker (Ctrl+C) mid-job: the job becomes Failed / "Worker was interrupted".
   - Create a job describing a problem that does not exist: expect Needs attention with the
     agent's explanation, and no pull request.
   - Sign in as a GitHub user without write access to the repository: "New job" is absent, and
     posting the form anyway is rejected by the live permission check.

Record the outcome of the live run in docs/implementation-plan.md (Phase 8).

## Useful queries while debugging

```sql
-- Timeline of one job
SELECT "createdAt", type, level, message, data FROM "JobEvent" WHERE "jobId" = '<id>' ORDER BY id;
-- What ran, and how it ended
SELECT source, phase, command, "exitCode", "timedOut", "durationMs", "networkEnabled"
FROM "CommandExecution" WHERE "jobId" = '<id>' ORDER BY "startedAt";
-- Model usage by phase
SELECT phase, count(*), sum("inputTokens"), sum("cachedInputTokens"), sum("outputTokens"), sum("estimatedCostUsd")
FROM "ModelInvocation" WHERE "jobId" = '<id>' GROUP BY phase;
```
