# Deployment

## 1. Convex

```bash
npx convex dev
npx convex env set HERMES_SERVER_URL https://<reachable-hermes-host>
npx convex env set HERMES_SERVER_KEY '<rotated-key>'
npx convex env set GITHUB_TOKEN '<token>'
npx convex env set GITHUB_REPAIR_ALLOWLIST 'pizzadude123/GrowthX_Hackathon_2026'
npx convex env set PUBLIC_APP_URL 'https://<cloudflare-project>.pages.dev'
npx convex env set LINKUP_API_KEY '<key>'
npx convex deploy
```

Hermes must be network-reachable from Convex. A localhost gateway cannot be called by hosted Convex.

## 2. Cloudflare Pages

Set `VITE_CONVEX_URL` as a Pages build variable, then:

```bash
npm run build
npx wrangler pages deploy dist --project-name whitebox-logistics
```

Do not add Hermes, GitHub, or LinkUp keys to the Pages browser environment. Cloudflare Pages stores only the public Convex URL; server secrets stay in Convex.

## 3. Hermes

Configure the native gateway API server with `API_SERVER_ENABLED=true`, a rotated `API_SERVER_KEY`, explicit CORS only if needed, and a network-safe bind/proxy. Whitebox reads the mapped secret as `HERMES_SERVER_KEY`.
