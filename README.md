# Whitebox

Whitebox is a Hermes-native Living Code Logistics Agency. It ingests a bounded public GitHub repository, creates an evidence-backed operational schema, maps flows and invariants, rejects unsupported claims, proposes bounded repairs only for allowlisted repositories, validates those repairs against a regenerated schema, and exposes the run through a real-time dashboard.

## What is implemented

- Real Hermes API Server integration through `POST /v1/runs`, `GET /v1/runs/{id}`, and stop.
- Strict GitHub intake, public-repository limits, language/toolchain detection, fingerprints, graph nodes/edges, flows, state transitions, configuration contracts, exact evidence, dependency blast radius, snapshots, and incremental deltas.
- Convex tables and live queries for runs, traces, schemas, principles, findings, repairs, validations, memory, diagnostics, roles, evals, and management actions.
- Guarded deterministic repair recipes for configuration disagreement and missing fetch timeouts, each independently reversible and schema-validated.
- React dashboard routes `/`, `/runs/:publicRunId`, and `/reports/:publicRunId`.
- Telegram-compatible command parser and canonical short reports.
- Whitebox Blocks VS Code extension reading `whitebox/editor-diagnostics.json`.
- Four named eval fixtures and CI quality gate.

## Local development

```bash
npm install --ignore-scripts
npx convex dev                 # creates CONVEX_DEPLOYMENT and VITE_CONVEX_URL
npm run dev
```

Set server-only secrets in Convex, not in Vite:

```bash
npx convex env set HERMES_SERVER_URL http://127.0.0.1:8642
npx convex env set HERMES_SERVER_KEY '<rotated value>'
npx convex env set GITHUB_TOKEN '<token>'
npx convex env set GITHUB_REPAIR_ALLOWLIST 'pizzadude123/GrowthX_Hackathon_2026'
npx convex env set PUBLIC_APP_URL 'https://<project>.pages.dev'
npx convex env set LINKUP_API_KEY '<key>'
```

Only `VITE_CONVEX_URL` belongs in the browser build environment.

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
