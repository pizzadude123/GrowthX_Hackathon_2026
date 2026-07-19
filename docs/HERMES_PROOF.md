# Hermes proof

A release-valid run requires direct, immutable evidence from both isolated Hermes roles.

1. Confirm raw Hermes is bound only to the dedicated loopback gateway and the signed receipt proxy is the worker endpoint.
2. Verify the startup runtime receipt has a valid signature, a profile/config identity digest, an effective tool count of zero, and the expected upstream origin.
3. Inspect the run's private attempt record: Repository Auditor and Verification Lead must have distinct run/session IDs bound to the same attempt and immutable source.
4. Verify each signed terminal receipt binds the exact attempt, role, run, session, approved prompt digest, exact input digest, structured envelope digest, runtime proof, and runtime identity.
5. Confirm the trusted server independently reconciled every candidate/disposition, regenerated canonical analysis from frozen source bytes, and persisted only evidence-backed findings.
6. Confirm delivery used the durable outbox and both destination-bound signed receipts contain positive Telegram platform IDs.

Shared gateway logs, prompt text, worker assertions, stale runs, or screenshots alone are not proof.
