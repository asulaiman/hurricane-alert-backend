# hurricane-alert-backend

Backend service for [hurricane-alert-frontend](https://github.com/asulaiman/hurricane-alert-frontend).
It serves official weather alerts, subscription and verification endpoints,
push and email delivery, and the manually triggered subscription checker.

## Ownership

This repository alone owns Open-Meteo forecast parsing and advisory thresholds.
The same calculation powers `GET /api/forecast` and the subscription checker;
the frontend consumes `{ current, timezone, advisory }` over HTTP and does not
import backend source or recalculate advisories. Geocoding and browser APIs
belong to the frontend; the unused copied geocoding implementation was removed.
Vite remains backend-only local server tooling for serverless routes, not a
frontend build. The CI Slack notifier is independently maintained deployment
tooling in each repo so neither checkout depends on the other.

## Run locally

```sh
npm install
cp .env.example .env.local
# Set DATABASE_URL and generate VAPID keys if testing push.
npm run migrate
npm run dev
```

The API listens on `http://localhost:3001`. Set the frontend's
`VITE_API_BASE_URL=http://localhost:3001` and its `VITE_VAPID_PUBLIC_KEY` to
the same value as this service's `VAPID_PUBLIC_KEY`. For local browser requests,
keep `APP_BASE_URL=http://localhost:5173`.

## Deploy

Deploy this repository as a Node serverless project (for example, on Vercel);
the `api/` directory contains the serverless handlers. Configure the variables
from `.env.example` in the deployment. Set `APP_BASE_URL` to the frontend's
origin and `API_BASE_URL` to this service's public origin. Run
`npm run migrate` once against the production database.

The manual-only workflow in `.github/workflows/check-subscriptions.yml` calls
`/api/cron/check-subscriptions` when you select **Actions > Check subscriptions >
Run workflow** in GitHub. It has no scheduled or other automatic triggers.
Add repository Actions
secrets `API_BASE_URL` and `CRON_SECRET`; the latter must match the deployment
environment variable.

## HTTP API tests

```sh
npm ci
npm test
npm run test:watch
```

Vitest starts an ephemeral loopback HTTP server using the real local route
adapter and handlers. Database and notification delivery modules are mocked;
weather provider responses are synthetic and unexpected upstream calls fail.
No database credentials, real emails, push deliveries, or separately running
API are needed. Tests use an automatically assigned port, so the local preview
on port 3001 is unaffected.

The suite checks availability and CORS for all seven exposed routes; forecast
data shapes and advisory threshold boundaries; normalized
NWS/GDACS alert data; subscription and push JSON success/error shapes;
verification/unsubscribe HTML confirmations; and authenticated cron counters,
location grouping, and notification URL contracts. There is no `/api/health`
endpoint; readiness is checked against existing routes, not a new endpoint.

These are isolated HTTP contract tests, not deployment monitoring or real
database/provider integration tests. They preserve current behavior: official
provider failures return an empty alerts array, and cron `notified` counts
eligible notifications, not confirmed deliveries. Verification/unsubscribe
are HTML-body contracts; the local adapter currently does not set an explicit
HTML content type.

## GitHub Actions failure alerts

`.github/workflows/api-tests.yml` runs type-checking and API/notification tests.
Only failed tests publish an alert identifying the backend, repository,
branch/ref, and failed-run URL. Successes and cancellations do not send
notifications, and original test failures retain their failing exit status.
Notifier errors are reported explicitly.

An authorized Slack administrator must provision an incoming webhook bound to
**#hurricane-app-alerting** (channel `C0CDX2E5546`), then store its URL directly
in this repository's **Settings > Secrets and variables > Actions** as
`SLACK_WEBHOOK_URL`. Add the same secret in `asulaiman/hurricane-alert-frontend` for
frontend failures. Do not paste webhook URLs into chat, commit them, or print
them in logs. The destination channel is configured in Slack.
Live delivery remains unavailable until the webhook and secrets are configured;
a failed trusted test run reports missing configuration.

Fork pull requests run tests without secrets and skip notifications. Workflows
use read-only contents permissions and do not use `pull_request_target`.
Run `npm run test:notifications` to validate failure/success/cancellation,
safe metadata encoding, and webhook errors with no real Slack messages.

## Automatic fix proposals

The proposed `propose-test-fix.yml` uses the Copilot cloud agent
[agent tasks API](https://docs.github.com/en/rest/agent-tasks/agent-tasks),
a public preview whose task-start endpoint currently requires Copilot
Business or Enterprise. It is not enabled until published on the default
branch and configured.

Create an expiring **fine-grained personal access token** owned by `asulaiman`,
restricted to `hurricane-alert-backend` and `hurricane-alert-frontend`, with
only repository **Agent tasks: read and write** plus implicit metadata read.
Store it directly in each repo's Actions secrets as `COPILOT_AGENT_TOKEN`;
never share its value in chat, logs, source, or issues. Do not reuse desktop
credentials. Installation tokens and `GITHUB_TOKEN` cannot start tasks.
The token's user needs repository write access, cloud agent enabled, and an
eligible subscription; rotate the token before expiry. The workflow uses
its separate ephemeral `GITHUB_TOKEN` for contents/actions/PR read and issues
write bookkeeping. Keep the existing `SLACK_WEBHOOK_URL` configured.

The event-driven handler accepts only actual test-step failures on the
current default-branch head from trusted user pushes. It excludes forks/PRs,
bots, simulation/fix branches, stale commits, successes, and cancellations.
It checks out only trusted default-branch code, not failed-run artifacts,
and uses a fixed prompt treating logs/repo text as untrusted evidence.

A durable tracking issue reserves one attempt per failed SHA before starting
one paid Copilot task. It is not a placeholder fix PR. Copilot is instructed
to reproduce, make an evidence-based minimal fix without weakening tests,
validate, link the failed run, and open a separate PR; never auto-merge.
Only a completed task with a verified non-empty open Copilot PR targeting
this repo's default branch produces a Slack PR-link alert. Existing immediate
test-failure alerts remain separate. Human review still determines correctness.

Polling stops after 45 minutes, without automatic task or webhook retries.
Errors, no/empty PR, agent input requests, timeout, and uncertain Slack delivery
are explicit failures recorded in the issue. The task may continue after
observation times out; inspect task/issue/channel before manual intervention.
Attempts are bounded, but AI billing must be controlled through plan budgets.
`npm run test:notifications` covers the flow and guards with mocked APIs;
live task execution remains unverified until token/plan setup is complete.

## Environment

`DATABASE_URL` is required. `RESEND_API_KEY` and the VAPID variables enable
email and push delivery; without them, delivery attempts are logged in
development. `MAILING_ADDRESS` is required in advisory email footers.
`APP_BASE_URL`, `API_BASE_URL`, and `NWS_CONTACT` should be set explicitly
before public deployment.

Advisory thresholds remain forecast-based heuristics, not official warnings.
Email consent, unsubscribe, and mailing-address handling are implemented, but
the service has not had legal review; obtain appropriate CAN-SPAM/TCPA guidance
before launching to the public.
