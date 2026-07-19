# Whitebox audit-only release acceptance matrix

## Decision rule

A release is **GO** only when every P0 gate passes on one immutable candidate tree. A missing, blocked, stale, mocked, or inferred result is **NO-GO**. Repair and pull-request generation are outside product authority.

## P0 gates

| ID | Required proof | Pass oracle |
|---|---|---|
| P0-01 Source authority | Submit valid and adversarial public GitHub inputs. | The trusted boundary resolves an exact commit object and complete tree/blob manifest; truncated, private, inaccessible, oversized, non-commit, and incomplete inputs fail closed; every excluded/unsupported blob has a disposition. Submitted repository code is never executed or modified. |
| P0-02 Producer authority | Run auditor and verifier and tamper with role, attempt, run, session, prompt, input, output, runtime, and tool fields. | Distinct signed producer receipts bind the exact attempt, role, run/session, approved prompt, canonical input, structured output, zero effective tools, no tool calls, runtime proof, and runtime identity. Any mismatch fails closed. Ambiguous creation is not retried. |
| P0-03 Canonical integrity | Inject omitted/invented candidates, bad source ranges/excerpts, producer prose canaries, synthetic topology, and changed source bytes. | The verifier dispositions every auditor candidate exactly once. Only trusted semantic detectors can authorize active findings. Evidence maps to exact source and scoped nodes/flows/invariants. Producer prose cannot become public authority. |
| P0-04 Lifecycle | Exercise first completion, exact replay, conflicting replay, cancellation, lease expiry, and retries. | First completion is reachable; exact replay is idempotent; conflicts, stale leases, terminal reopening, and cancelled mutations are rejected. Source and producer authority remain attempt-scoped and immutable. |
| P0-05 Delivery | Tamper with bytes, outbox, lease, leg, destination, platform ID, and retry state. | Canonical artifacts derive from accepted analysis. Signed receipts bind outbox, lease, leg, digest, intended Telegram destination, and positive platform ID. Ambiguous sends are not automatically retried. Both legs reach durable `delivered`. |
| P0-06 Privacy and claims | Inject private goal, Telegram/session identities, internal IDs, errors, receipts, manifests, absolute paths, and nested canaries. | Recursive public projections omit private/internal fields and producer-controlled prose. Dependency health is `unverified` without registry/advisory evidence. No repair, patch, commit, PR, or merge claim appears. |
| P0-07 Release gates | Freeze one tree and run codegen, typecheck, lint, tests, semantic contracts, evals, build, secret scan, dependency audit, production verification, one fresh live audit/delivery, and independent exact-tree review. | Every command exits 0; live run ends `audit_only` with delivery `delivered`; review returns `passed: true` for the same tree; no tracked change occurs afterward. |

## Release evidence

Record the immutable tree, local gate results, production deployment IDs, live run public ID, canonical completion/delivery state, independent review verdict, and final release commit SHA. Repository publication is an operator release action outside Whitebox product authority. Never include credentials, internal identities, raw receipts, or private artifacts.
