# Whitebox

Whitebox is a Hermes-native, read-only Living Code Logistics auditor. It ingests a bounded public GitHub repository, binds the audit to an immutable commit and complete coverage manifest, maps flows and invariants, independently verifies exact-evidence findings, and exposes one canonical result through Convex, the dashboard, and Telegram. It cannot edit repositories, generate patches, open pull requests, or merge code.

## What is implemented

- Real Hermes API Server integration through `POST /v1/runs`, `GET /v1/runs/{id}`, and stop.
- Strict GitHub intake, public-repository limits, language/toolchain detection, fingerprints, graph nodes/edges, flows, state transitions, configuration contracts, exact evidence, dependency blast radius, snapshots, and incremental deltas.
- Convex tables and live queries for runs, attempts, signed receipts, schemas, principles, findings, diagnostics, delivery outbox records, evals, and management actions.
- Audit-only authority: repair and pull-request publication are disabled for every submitted repository.
- Convex-backed public waitlist at `/`; emails are normalized, deduplicated, and visible only through the authenticated Convex dashboard.
- React dashboard routes `/dashboard`, `/runs/:publicRunId`, and `/reports/:publicRunId`.
- Telegram-compatible command parser and canonical short reports.
- Whitebox Blocks VS Code extension reading `whitebox/editor-diagnostics.json`.
- Four named eval fixtures and CI quality gate.

## Telegram user flow

1. Send `/whitebox-guide` for an in-chat walkthrough.
2. Start an immutable, read-only audit with `/whitebox OWNER/REPO --goal "review critical flows"`.
3. Use `/whitebox-status RUN-ID`, `/findings RUN-ID`, `/dependencies RUN-ID`, or `/whitebox-open RUN-ID` while the run is active.
4. Use `/whitebox-next RUN-ID` for finding-specific recommendations and a ready-to-copy re-audit command.

Whitebox does not edit submitted repositories or publish pull requests. Apply its evidence-backed recommendations with a developer or coding agent in a trusted workspace, test and push that change, then rerun Whitebox against the new commit.

## Local development

```bash
npm install --ignore-scripts
npx convex dev                 # creates CONVEX_DEPLOYMENT and VITE_CONVEX_URL
npm run dev
```

Set server-only control-plane secrets in Convex, not in Vite:

```bash
npx convex env set PUBLIC_APP_URL 'https://<project>.pages.dev'
npx convex env set WHITEBOX_COMMAND_TOKEN '<rotated command token>'
npx convex env set WHITEBOX_WORKER_TOKEN '<rotated worker token>'
npx convex env set WHITEBOX_HERMES_RECEIPT_KEY '<rotated receipt key>'

```

Only `VITE_CONVEX_URL` belongs in the browser build environment.

Run raw Hermes on loopback port `8742`, then start the separately scoped signed receipt proxy on `8743` with `npm run receipt-proxy`. The worker must use `HERMES_SERVER_URL=http://127.0.0.1:8743`; pointing it at raw Hermes bypasses trusted receipts and completion fails closed. Start the worker with `npm run worker`. Keep Hermes, GitHub, worker, and receipt-signing credentials out of Convex public DTOs and browser variables.

## Quality gate

```bash
npm run typecheck
npm run lint
npm test
npm run eval
npm run build
npm run secret-scan
npm run verify:production -- --strict
```

Whitebox intentionally shows a configuration-required screen instead of fake live runs when Convex is not connected.
