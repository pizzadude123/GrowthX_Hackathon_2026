# Whitebox Engineering Rules

- This repository is a fresh event build.
- Hermes is required in production. Production must fail closed when the real Hermes adapter or credentials are unavailable.
- Never commit, log, expose to the browser, or persist credentials. Treat credentials pasted into chat as compromised.
- No confirmed finding without exact repository evidence: path, valid line range, excerpt, and flow linkage.
- Repair and pull-request generation are disabled; findings are advisory and read-only.
- Never fabricate metrics, sessions, tools, users, GitHub objects, agent executions, costs, validations, or results.
- Never execute code from an untrusted repository. Arbitrary public repositories are audit-only.
- No submitted repository may be modified or executed.
- P0 vertical-slice work precedes stretch features.
- Run typecheck, lint, tests, evals, production build, and secret scan before completion.
- No P0 TODO may remain at completion.
- The versioned Living Code Logistics Schema is the durable source of truth, not a generated essay.
- When a valid prior schema exists, subsequent runs must use changed files and the impact cone by default.
- Editor diagnostics must derive only from verified or explicit human-review findings; rejected findings are never active errors.
- Keep Telegram messages concise and deterministically formatted from the canonical run brief.
- Whitebox has no authority to create, publish, review, or merge repository changes or pull requests.
