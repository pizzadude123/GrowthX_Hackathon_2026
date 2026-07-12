# Whitebox Vertical Slice Implementation Plan

**Goal:** Build and verify a deployable Hermes-native code-logistics agency with a React dashboard, Convex state, polyglot repository analysis, guarded repair contracts, GitHub publication support, concise Telegram-compatible reporting, and editor diagnostics.

**Architecture:** A TypeScript workspace separates the React/Vite dashboard, shared Zod contracts and deterministic analysis engine, Convex persistence/actions, server-only integrations, and a thin VS Code extension. Production orchestration calls Hermes' documented `/v1/runs` API and fails closed without credentials; public repositories remain audit-only unless allowlisted.

**Tech stack:** TypeScript, React, Vite, Vitest, Zod, Convex, Cloudflare Pages/Workers, GitHub REST, Hermes API Server.

## Execution order

1. Bootstrap strict TypeScript workspace and tests.
2. Add Zod domain contracts, URL/security policy, manifest/fingerprint analysis, schema snapshots/deltas, findings, reports, and diagnostics using RED→GREEN tests.
3. Add real Hermes Runs API, GitHub, LinkUp, and Telegram-format integrations with credential redaction and production fail-fast.
4. Add Convex schema, run/state mutations and queries, orchestration action, management actions, and HTTP routes.
5. Build responsive dashboard routes `/`, `/runs/:id`, `/reports/:id` with run tabs and management controls backed by persistent queries.
6. Add role prompts, exact Whitebox runtime system prompt, role registry, docs, eval fixtures, CI, artifacts, and VS Code diagnostics extension.
7. Run typecheck, lint, unit/integration tests, evals, build, secret scan, and local browser smoke test.
8. Attempt Convex/Cloudflare deployment and GitHub publication only with valid credentials; report exact blockers truthfully.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run eval`
- `npm run build`
- `npm run verify:production`
- Browser smoke test against local preview
- Git status/diff and secret scan
