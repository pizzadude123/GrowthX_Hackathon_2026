# Architecture

## Surfaces

1. **Telegram / Hermes gateway** receives `/whitebox …` as a real Hermes conversation. The command parser normalizes the request; Hermes is the manager.
2. **Convex** creates the durable run immediately, schedules orchestration, stores every product record, and pushes live changes to the dashboard.
3. **Hermes Runs API** receives the exact Whitebox runtime prompt plus the run-scoped task. Its returned run/session identifiers are the only identifiers shown as Hermes proof.
4. **Deterministic core** bounds GitHub retrieval, fingerprints files, detects capabilities, maps graph/flows/principles, creates exact findings, and computes deltas before agent interpretation.
5. **Signed trust boundary** binds both isolated Hermes envelopes, zero-tool runtime proof, exact source bytes, and the accepted canonical analysis to one attempt.
6. **Dashboard / editor / Telegram** render allowlisted projections of the same persisted audit evidence. No repair or repository-write path exists.

## Trust boundaries

Browser → public Convex functions contains no server key. Convex actions own Hermes and GitHub secrets. Arbitrary repositories are fetched as text and never installed or executed. Production fails closed without scoped credentials, exact source binding, signed Hermes receipts, or complete candidate reconciliation.

## Incremental model

Snapshots retain file fingerprints. Repeat analysis compares fingerprints, maps changed files through the flow index, and re-evaluates only impacted flows unless confidence requires expansion.
