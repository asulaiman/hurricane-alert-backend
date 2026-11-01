# hurricane-alert-backend

Backend service for [hurricane-alert-frontend](https://github.com/asulaiman/hurricane-alert-frontend).
It serves official weather alerts, subscription and verification endpoints,
push and email delivery, and the scheduled subscription checker.

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

The scheduled workflow in `.github/workflows/check-subscriptions.yml` calls
`/api/cron/check-subscriptions` every 20 minutes. Add repository Actions
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
