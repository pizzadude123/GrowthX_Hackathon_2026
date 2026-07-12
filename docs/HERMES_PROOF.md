# Hermes Proof

Whitebox uses Hermes Agent v0.18.2's documented API Server, not an invented package or mock.

## Interface

- `POST /v1/runs` creates a real asynchronous Hermes run.
- `GET /v1/runs/{run_id}` returns terminal status, output, session ID, and usage when supplied.
- `GET /v1/runs/{run_id}/events` is the SSE progress surface.
- `POST /v1/runs/{run_id}/stop` cancels at a safe interruption point.
- Bearer authentication is read from server-only `HERMES_SERVER_KEY` by Whitebox. The Hermes gateway itself is configured with its native `API_SERVER_KEY`; operators rotate/map the same secret without exposing it to the browser.

## Judge verification

1. Send `/whitebox https://github.com/OWNER/REPO --goal "stabilize checkout"` to the configured Hermes Telegram chat.
2. Open the returned `/runs/WB-*` route.
3. Confirm the header contains a non-placeholder Hermes run/session ID returned by `/v1/runs`.
4. Open **Agent Trace** and compare task IDs/statuses with Hermes `/v1/runs/{id}/events` or the Hermes session store.
5. Confirm tool summaries correspond to persisted GitHub retrieval, schema construction, repair, validation, and publication records.
6. Inspect the final Telegram delivery and verify every URL resolves.

Production orchestration throws when `HERMES_SERVER_KEY` is absent. There is no production mock adapter. Cost is displayed only if Hermes returns it.
