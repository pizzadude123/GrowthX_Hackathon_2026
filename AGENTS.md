# Whitebox Engineering Rules

- This repository is a fresh event build.
- Hermes is required in production. Production must fail closed when the real Hermes adapter or credentials are unavailable.
- Never commit, log, expose to the browser, or persist credentials. Treat credentials pasted into chat as compromised.
- No confirmed finding without exact repository evidence: path, valid line range, excerpt, and flow linkage.
- No accepted repair without independent validation. A repair author may not approve their own patch.
- Never fabricate metrics, sessions, tools, users, GitHub objects, agent executions, costs, validations, or results.
- Never execute code from an untrusted repository. Arbitrary public repositories are audit-only.
- Guarded repairs are limited to repositories in the server-side allowlist, five files, and 250 changed lines.
- P0 vertical-slice work precedes stretch features.
- Run typecheck, lint, tests, evals, production build, and secret scan before completion.
- No P0 TODO may remain at completion.
- The versioned Living Code Logistics Schema is the durable source of truth, not a generated essay.
- When a valid prior schema exists, subsequent runs must use changed files and the impact cone by default.
- Editor diagnostics must derive only from verified or explicit human-review findings; rejected findings are never active errors.
- Keep Telegram messages concise and deterministically formatted from the canonical run brief.
- Do not automatically merge GitHub pull requests.
