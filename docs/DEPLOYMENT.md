# Deployment

## 1. Convex control plane

Stage the intended release, generate its self-excluding source manifest, and stage the generated identities before deployment:

```bash
git add -A
npm run release:identity
git add packages/core/src/release-identity.ts apps/web/src/release-identity.ts
export WHITEBOX_RELEASE_TREE_SHA="$(git write-tree)"
```

The generated source digest is compiled independently into Convex, the worker, the receipt proxy, and the frontend. Production verification recomputes it from the immutable Git tree and rejects an environment-only tree label or any stale component.

Set only server-side control-plane values in Convex:

```bash
npx convex env set PUBLIC_APP_URL 'https://<cloudflare-project>.pages.dev'
npx convex env set WHITEBOX_COMMAND_TOKEN '<rotated command token>'
npx convex env set WHITEBOX_WORKER_TOKEN '<rotated worker token>'
npx convex env set WHITEBOX_DELIVERY_TOKEN '<rotated delivery claim token>'
npx convex env set WHITEBOX_DELIVERY_SIGNER_TOKEN '<rotated delivery receipt signer token>'
npx convex env set WHITEBOX_RELEASE_TOKEN '<rotated release evidence token>'
npx convex env set WHITEBOX_HERMES_RECEIPT_KEY '<rotated receipt key>'
npx convex env set WHITEBOX_HERMES_PROXY_TOKEN '<rotated proxy token>'
npx convex env set WHITEBOX_RELEASE_TREE_SHA "$WHITEBOX_RELEASE_TREE_SHA"
npx convex deploy
```

The command, worker, proxy, delivery claim, delivery signer, release, and receipt credentials must all be distinct. Do not put them in Vite or browser state.

## 2. Cloudflare Pages

Set only `VITE_CONVEX_URL` as a Pages build variable, then:

```bash
npm run build
npx wrangler pages deploy dist --project-name whitebox
```

## 3. Dedicated Hermes runtime and signer

Run the dedicated raw Hermes API on loopback port `8742` with the Whitebox profile. The profile must resolve to an empty effective tool registry. Start the separately scoped receipt proxy on port `8743`:

```bash
export HERMES_SERVER_KEY='<rotated Hermes API key>'
export WHITEBOX_HERMES_PROXY_TOKEN='<rotated proxy client token>'
export WHITEBOX_HERMES_RECEIPT_KEY='<same receipt key configured in Convex>'
export WHITEBOX_HERMES_RUNTIME_KEY='<runtime-only attestation key>'
export WHITEBOX_DELIVERY_TOKEN='<same delivery claim token configured in Convex>'
export WHITEBOX_DELIVERY_SIGNER_TOKEN='<same delivery signer-only token configured in Convex>'
export WHITEBOX_CONTROL_PLANE_URL='https://<deployment>.convex.site'
export WHITEBOX_HERMES_COMMIT='<commit pinned by hermes/runtime/runtime-lock.json>'
export HERMES_AGENT_ROOT='<Hermes installation root>'
export HERMES_HOME='<dedicated Whitebox profile home>'
npm run receipt-proxy
```

Install the pinned API-server gate with `HERMES_HOME="$HERMES_HOME" HERMES_PYTHON="$HERMES_AGENT_ROOT/venv/bin/python" python3 scripts/install-hermes-runtime-gate.py "$HERMES_AGENT_ROOT"` before startup. The release lock pins every measured Hermes module, the gateway Python binary, and a credential-redacted digest of the dedicated profile configuration. The gateway fails before model execution unless the exact initialized producer agent has zero tools. Its nonce-bound attestation identifies the run, process, boot, profile, locked code/configuration, and effective tool registry. The proxy independently verifies that attestation before signing terminal receipts. Raw Hermes on `8742` is not an acceptable worker endpoint.

## 4. Worker

Run the worker with the signed proxy endpoint and separately scoped worker/GitHub credentials:

```bash
export WHITEBOX_CONTROL_PLANE_URL='https://<deployment>.convex.site'
export WHITEBOX_WORKER_TOKEN='<rotated worker token>'
export HERMES_SERVER_URL='http://127.0.0.1:8743'
export WHITEBOX_HERMES_PROXY_TOKEN='<proxy client token>'
export GITHUB_TOKEN='<read-only public-repository token>'
npm run worker
```

Before each producer starts, the worker obtains a short-lived, attempt- and role-scoped creation capability from Convex. The proxy verifies and atomically consumes it before forwarding the request to Hermes; capabilities cannot be replayed after an ambiguous creation. The worker is audit-only. It cannot execute submitted repositories, generate repairs, call GitHub write APIs, or publish pull requests.

## 5. Release verification

Run the local release matrix, deploy the exact candidate, complete and deliver a fresh live audit, then execute `npm run verify:production` with `WHITEBOX_VERIFY_RUN_ID`, `WHITEBOX_RELEASE_TREE_SHA`, and a release-scoped token. Obtain an independent static review of the same immutable Git tree only after those checks pass. A stale run, stale tree review, partial result, or inferred delivery is not release evidence.
