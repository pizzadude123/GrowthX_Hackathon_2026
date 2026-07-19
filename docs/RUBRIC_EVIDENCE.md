# Rubric evidence map

Whitebox is a read-only audit product. Rubric levels are not release gates and are never synthesized into per-run pass claims.

| Area | Defensible evidence |
|---|---|
| Working product | A live audit must freeze an exact public GitHub commit, complete both isolated Hermes roles, persist canonical analysis, and deliver both trusted outbox legs. |
| Agent organization | Signed receipts must identify distinct Repository Auditor and Verification Lead runs and sessions with zero effective tools. |
| Observability | The public dashboard shows recursively projected run state; private goals, identities, manifests, receipts, internal IDs, and raw errors remain server-only. |
| Evaluation | Repository tests, semantic security contracts, production verification, a fresh live audit, and an independent exact-tree review are separate release evidence. They are not presented as run-scoped eval results. |
| Handoffs and memory | Versioned snapshots and deltas are accepted only after immutable source and canonical integrity checks. |
| Cost and latency | Only values returned or measured by trusted runtime boundaries may be shown. Missing values remain unavailable. |
| Management | Pause, resume, and cancel transitions are lease-safe and cannot reopen terminal runs. |

No level is raised from planned, mocked, stale, or inferred evidence. Whitebox has no repair, commit, pull-request, or merge authority.
