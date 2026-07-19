import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import { authorizedFor, type TokenScope } from './lib/token_scope';

const http = httpRouter();
const jsonHeaders = { 'content-type': 'application/json' };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

function secure(scope: TokenScope, handler: (ctx: ActionCtx, request: Request) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    if (!authorizedFor(scope, request.headers.get('authorization'), {
      commandToken: process.env.WHITEBOX_COMMAND_TOKEN,
      workerToken: process.env.WHITEBOX_WORKER_TOKEN,
    })) return json({ error: 'Unauthorized' }, 401);
    try {
      return await handler(ctx, request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400);
    }
  });
}

http.route({
  path: '/api/runs/start',
  method: 'POST',
  handler: secure('command', async (ctx, request) => {
    const body = await request.json() as { repoUrl?: string; goal?: string; telegramUserId?: string; telegramChatId?: string; telegramThreadId?: string };
    if (!body.repoUrl) return json({ error: 'repoUrl is required' }, 400);
    const result = await ctx.runMutation(internal.start.start, { repoUrl: body.repoUrl, goal: body.goal ?? 'stabilize critical flows', telegramUserId: body.telegramUserId, telegramChatId: body.telegramChatId, telegramThreadId: body.telegramThreadId });
    return json(result, 202);
  }),
});

http.route({
  path: '/api/runs/status',
  method: 'POST',
  handler: secure('command', async (ctx, request) => {
    const body = await request.json() as { publicId?: string; telegramUserId?: string };
    if (!body.publicId) return json({ error: 'publicId is required' }, 400);
    const run = await ctx.runQuery(internal.runs.getRunByPublicIdInternal, { publicId: body.publicId });
    if (!run) return json({ error: 'Run not found' }, 404);
    if (run.telegramUserId && run.telegramUserId !== body.telegramUserId) return json({ error: 'Run belongs to another Telegram user' }, 403);
    return json(await ctx.runQuery(api.runs.getByPublicId, { publicId: body.publicId }));
  }),
});

http.route({
  path: '/api/repositories/memory',
  method: 'POST',
  handler: secure('command', async (ctx, request) => {
    const body = await request.json() as { repository?: string; telegramUserId?: string };
    if (!body.repository) return json({ error: 'repository is required' }, 400);
    const run = await ctx.runQuery(internal.runs.getLatestByRepositoryInternal, { repository: body.repository });
    if (!run) return json({ error: 'No repository memory exists yet' }, 404);
    if (run.telegramUserId && run.telegramUserId !== body.telegramUserId) return json({ error: 'Repository memory belongs to another Telegram user' }, 403);
    return json({ publicId: run.publicId, repository: run.repository, analysisMode: run.analysisMode, outputSchemaSnapshotId: run.outputSchemaSnapshotId, status: run.status });
  }),
});

http.route({
  path: '/api/runs/action',
  method: 'POST',
  handler: secure('command', async (ctx, request) => {
    const body = await request.json() as { publicId?: string; telegramUserId?: string; action?: 'pause'|'resume'|'cancel'|'audit_only'|'conservative_repair' };
    if (!body.publicId || !body.action || !body.telegramUserId) return json({ error: 'publicId, action, and telegramUserId are required' }, 400);
    const run = await ctx.runQuery(internal.runs.getRunByPublicIdInternal, { publicId: body.publicId });
    if (!run) return json({ error: 'Run not found' }, 404);
    if (run.telegramUserId && run.telegramUserId !== body.telegramUserId) return json({ error: 'Run belongs to another Telegram user' }, 403);
    return json(await ctx.runMutation(internal.management.act, { publicId: body.publicId, action: body.action, actor: `telegram:${body.telegramUserId}` }));
  }),
});

http.route({
  path: '/api/worker/lease',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => {
    const body = await request.json() as { workerId: string; leaseId: string };
    return json(await ctx.runMutation(internal.worker.lease, body));
  }),
});

http.route({
  path: '/api/worker/started',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.started, await request.json()))),
});

http.route({
  path: '/api/worker/snapshot',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.snapshotBound, await request.json()))),
});

http.route({
  path: '/api/worker/heartbeat',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.heartbeat, await request.json()))),
});

http.route({
  path: '/api/worker/state',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.state, await request.json()))),
});

http.route({
  path: '/api/worker/stage',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.stage, await request.json()))),
});

http.route({
  path: '/api/worker/complete',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => {
    const body = await request.json();
    return json(await ctx.runMutation(internal.worker.complete, body as never));
  }),
});

http.route({
  path: '/api/worker/delivery',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.delivery, await request.json()))),
});

http.route({
  path: '/api/worker/abort',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.abort, await request.json()))),
});

http.route({
  path: '/api/worker/fail',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.fail, await request.json()))),
});

export default http;
