# Whitebox release acceptance matrix (150-minute ceiling)

## Decision rule

- **Local candidate:** P0-01 through P0-06 pass. Remote services may be `BLOCKED` only with the exact failed command/status, missing prerequisite, and no live/deployed claim.
- **Demo release:** every P0 passes, including real remote proof in P0-06. `BLOCKED`, `SKIPPED`, a screenshot, seed data, or a mocked receipt is not a pass.
- Any P0 failure is **NO-GO**. P1 is attempted only after P0. Preserve command output and identifiers as the release evidence pack.

## P0 — smallest defensible core (target: 100 minutes)

| ID | Risk caught | Test / adversarial input | Pass oracle (all required) | Required receipt | Budget |
|---|---|---|---|---|---:|
| **P0-01** | Fake data and missing evidence | Analyze a tiny fixture with one real cross-file defect; then inject a `confirmed` finding with a nonexistent path, out-of-range lines, or excerpt mismatch. | Real defect is found; every confirmed finding resolves against the exact source snapshot (`path`, positive in-range lines, verbatim excerpt), and links to a real flow/node/invariant. Tampered finding is rejected or downgraded and never appears as verified/fixed. No placeholder/sample IDs, counts, costs, latency, or dependency claims enter a non-development run. | Repository commit/fingerprint, finding JSON, source-line check output, rejected record. | 20m |
| **P0-02** | Unsafe repair / untrusted execution | Run the same repair request against (a) a non-allowlisted public repo and (b) an allowlisted fixture. Propose an unsafe payment retry or major upgrade, plus one bounded safe fix. | (a) is `audit_only`: no install, script, write, branch, or PR call. (b) changes only an isolated workspace and stays within **5 files / 250 lines**. Unsafe proposal is escalated/rejected; no patch is applied. Safe repair carries finding ID, invariant, blast radius, validation plan, rollback condition. | Mode decision, tool/command trace, workspace diff/stat, repair records. | 20m |
| **P0-03** | Self-approved or failed repair counted as fixed | Force one focused/invariant validation to fail after patch application while a second repair passes. | Author and verifier have distinct real task/execution IDs. The failed repair is individually reverted, has failed-check + reason, contributes to `reverted`/`escalated` only, and is absent from final diff/commit. Only the independently validated repair is `verified`/`fixed`. Run cannot be `completed` if required proof is absent. | Agent/task IDs, validation records, before/after diff, final counters. | 20m |
| **P0-04** | Mock Hermes in production | Start production with missing key, explicit mock adapter, and unreachable gateway; then submit one run to the local real Hermes gateway. | First three cases fail closed with nonzero/error or terminal `blocked`; no fallback, synthetic session, or `completed`. Real case yields a gateway-returned session/run ID, prompt version, actual task/tool receipts, and no secret in output/client bundle. Production verification rejects mock/dev/seed adapters and mock-only env flags. | Startup logs/exit codes, sanitized HTTP receipt, Hermes run/session/task IDs, production verifier output. | 15m |
| **P0-05** | Overlong or misleading reports | Feed maximal Unicode fields and a run with `reverted=1`, `verified=0`, no PR, and failed publication into canonical formatters. | Normal Telegram **≤500 characters**; final **≤700 characters**; dashboard brief **≤120 words**; schema brief **≤180 words**; PR prose **≤250 words**. Field caps are enforced (90/180/180/180/180/160). No raw JSON/source dump. Reverted is never fixed; blocked is never completed; PR link is omitted when no verified remote PR exists. | Unit-test output plus rendered strings and measured character/word counts. | 10m |
| **P0-06** | Failed deploy presented as success | Run typecheck, lint, unit/eval suite, production build, secret scan, and production verifier. Probe the claimed dashboard URL and claimed PR/API objects from a clean client. Deliberately use an invalid Cloudflare/Convex credential once. | Local commands all exit 0. A live claim requires a successful deploy command, provider deployment ID, independently reachable expected content, and a real backend state round-trip; a PR claim requires API-returned URL/number/SHA and changed code. Invalid credentials produce `blocked` with exact provider error and **no** deployed/live/PR claim. Dashboard may not label seed/local data as live. | Command transcript, deployment ID + HTTP response, Convex write/read IDs, GitHub API response. | 15m |

## P1 — highest-value confidence after P0 (target: 35 minutes)

| ID | Test | Pass oracle | Budget |
|---|---|---|---:|
| **P1-01** | Cross-surface reconciliation | For one persisted run, Telegram, dashboard, artifacts, and PR resolve to the same run/session IDs, source commit, finding/repair statuses, counts, and URLs. No surface is model-rewritten independently. | 10m |
| **P1-02** | False-positive + dependency provenance eval | Timeout-present fixture is rejected with no repair/editor error. Dependency versions/deprecation/vulnerability claims carry registry/advisory receipts; “old” alone is never “vulnerable”; unsafe major update is rejected. | 10m |
| **P1-03** | Repeatability and failure honesty | Two prepared real runs plus one forced gateway/provider failure: successful outputs use fresh real IDs and source-derived evidence; failure ends `blocked`/`partial` with exact cause, no stale prior-run data, no silent fallback. | 15m |

## Execution order and gate

1. **0–10m:** freeze candidate SHA, fixtures, env classification; create evidence directory.
2. **10–85m:** P0-01 through P0-05 in parallel where possible.
3. **85–110m:** P0-06 local gates; remote proof only if credentials already exist.
4. **110–140m:** P1-01 through P1-03.
5. **140–150m:** reconcile receipts and issue one verdict: `LOCAL PASS / REMOTE BLOCKED`, `DEMO PASS`, or `NO-GO`.

## Current truthful baseline (2026-07-12)

- Cloudflare and Convex are unauthenticated, so **no deployment or live-state acceptance can currently pass**. Report them as explicit blockers; do not substitute local Vite, seed state, screenshots, or expected URLs.
- A local Hermes gateway is available in the environment, but release proof still requires a real request/response receipt and gateway-issued IDs; a mocked fetch is only unit coverage.
- Existing test intent covers report lengths, production key fail-closed behavior, evidence presence, and false-positive rejection, but this is not release proof by itself.
- Baseline `npm test` currently fails before collection because `packages/core/src/{analyzer,hermes-client,incremental,reporting,security}.js` cannot be resolved. Until rerun passes, verdict is **NO-GO**.
