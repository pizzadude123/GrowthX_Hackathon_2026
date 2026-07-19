# Security

- Only HTTPS GitHub URLs on `github.com` are accepted and normalized to owner/repository.
- Every submitted repository is audit-only. Repair, branch, pull-request, and merge authority are disabled.
- Intake is capped at 40 selected text files, 240 KB selected text, 120 KB per file, and 500 total Git blobs.
- Every Git blob is either selected or recorded in the private coverage manifest with an explicit generated/vendored or unsupported-type disposition.
- Untrusted repositories are never installed or executed.
- No repository write or merge capability exists.
- Hermes and GitHub credentials are server-only. Only `VITE_CONVEX_URL` may be browser-visible.
- Tool output and errors are reduced to concise records. Secret patterns are redacted/scanned.
- A credential pasted into chat is compromised and must be rotated before production use.
- Confirmed findings require a path, positive line range, non-empty excerpt, explanation, flow, and principle link.
