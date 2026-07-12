# Security

- Only HTTPS GitHub URLs on `github.com` are accepted and normalized to owner/repository.
- Public repositories are audit-only unless their exact lowercase key appears in `GITHUB_REPAIR_ALLOWLIST`.
- Intake is capped at 60 text files, 750 KB selected text, 200 KB per file, and 100 MB repository metadata size.
- Binary, generated, vendored, minified, build, and dependency directories are excluded.
- Untrusted repositories are never installed or executed.
- Repairs are capped at five files and 250 changed lines; each repair is independently reversible.
- No automatic merge exists.
- Hermes, GitHub, and LinkUp credentials are server-only. Only `VITE_CONVEX_URL` may be browser-visible.
- Tool output and errors are reduced to concise records. Secret patterns are redacted/scanned.
- A credential pasted into chat is compromised and must be rotated before production use.
- Confirmed findings require a path, positive line range, non-empty excerpt, explanation, flow, and principle link.
