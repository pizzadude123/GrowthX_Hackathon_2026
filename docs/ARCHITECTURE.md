# Architecture

## Surfaces

1. **Telegram / Hermes gateway** receives `/whitebox …` as a real Hermes conversation. The command parser normalizes the request; Hermes is the manager.
2. **Convex** creates the durable run immediately, schedules orchestration, stores every product record, and pushes live changes to the dashboard.
3. **Hermes Runs API** receives the exact Whitebox runtime prompt plus the run-scoped task. Its returned run/session identifiers are the only identifiers shown as Hermes proof.
4. **Deterministic core** bounds GitHub retrieval, fingerprints files, detects capabilities, maps graph/flows/principles, creates exact findings, and computes deltas before agent interpretation.
5. **Guarded repair** operates only for an exact allowlist match. Recipes are bounded, reversible, and independently reanalyzed. Public repositories never execute.
6. **Dashboard / editor / GitHub** render the same persisted evidence. No local LLM runs in the editor.

## Trust boundaries

Browser → public Convex functions contains no server key. Convex actions own Hermes, GitHub, and LinkUp secrets. Arbitrary repositories are fetched as text and never installed or executed. Production fails closed without Hermes credentials.

## Incremental model

Snapshots retain file fingerprints. Repeat analysis compares fingerprints, maps changed files through the flow index, and re-evaluates only impacted flows unless confidence requires expansion.
