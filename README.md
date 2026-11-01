# hurricane-alert-api

Backend service for [hurricane-alert](https://github.com/asulaiman/hurricane-alert).
It serves official weather alerts, subscription and verification endpoints,
push and email delivery, and the scheduled subscription checker.

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
