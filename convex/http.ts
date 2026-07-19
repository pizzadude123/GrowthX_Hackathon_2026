import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import { assertRunOwner, authorizedFor, RunOwnershipError, type TokenScope } from './lib/token_scope';
import { resolvePublicGitHubHead, verifyPublicGitHubSnapshot, type SnapshotFile } from './lib/github_snapshot';
import { canonicalStringify } from '../packages/core/src/canonical-integrity';
import {WHITEBOX_RELEASE_SOURCE_DIGEST} from '../packages/core/src/release-identity';

const http = httpRouter();
const jsonHeaders = { 'content-type': 'application/json' };

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: jsonHeaders });
}

function hexBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return new Uint8Array();
  return Uint8Array.from(value.match(/../g)!.map((byte) => Number.parseInt(byte, 16)));
}

async function verifyHermesReceipt(receipt: Record<string,unknown>, signature: string, role: 'auditor'|'verifier') {
  const secret = process.env.WHITEBOX_HERMES_RECEIPT_KEY;
  if (!secret || secret.length < 32 || receipt.version !== 'whitebox-hermes-receipt-v1' || receipt.role !== role
    || typeof receipt.attemptId!=='string'||receipt.attemptId.length<8||typeof receipt.repositoryKey!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(receipt.repositoryKey)||typeof receipt.sourceCommitSha!=='string'||!/^[a-f0-9]{40}$/i.test(receipt.sourceCommitSha)||typeof receipt.snapshotDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.snapshotDigest)||typeof receipt.coverageDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.coverageDigest)||receipt.releaseSourceDigest!==WHITEBOX_RELEASE_SOURCE_DIGEST||typeof receipt.promptDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.promptDigest)||typeof receipt.inputDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.inputDigest)||receipt.toolCallCount !== 0 || receipt.effectiveToolCount !== 0 || receipt.upstreamOrigin!=='http://127.0.0.1:8742'||typeof receipt.runtimeProofDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.runtimeProofDigest)||typeof receipt.runtimeIdentityDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.runtimeIdentityDigest)||typeof receipt.runtimeProcessPid!=='number'||!Number.isInteger(receipt.runtimeProcessPid)||receipt.runtimeProcessPid<=0||typeof receipt.runtimeBootNonce!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.runtimeBootNonce)||typeof receipt.issuedAt !== 'number' || receipt.issuedAt <= 0) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, hexBytes(signature), new TextEncoder().encode(canonicalStringify(receipt)));
}

async function verifyDeliveryReceipt(receipt:Record<string,unknown>,signature:string){const secret=process.env.WHITEBOX_DELIVERY_SIGNER_TOKEN;if(!secret||secret.length<32||receipt.version!=='whitebox-delivery-receipt-v1'||receipt.platform!=='telegram'||!['message','attachment'].includes(String(receipt.leg))||typeof receipt.outboxId!=='string'||typeof receipt.leaseId!=='string'||typeof receipt.artifactDigest!=='string'||!/^[a-f0-9]{64}$/i.test(receipt.artifactDigest)||typeof receipt.target!=='string'||!/^telegram:-?\d+(?::[1-9]\d*)?$/.test(receipt.target)||typeof receipt.platformReceiptId!=='string'||!/^[1-9]\d*$/.test(receipt.platformReceiptId)||typeof receipt.issuedAt!=='number'||receipt.issuedAt<=0)return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,hexBytes(signature),new TextEncoder().encode(canonicalStringify(receipt)));}

async function producerAuthoritySignature(authority:Record<string,unknown>){const secret=process.env.WHITEBOX_HERMES_RECEIPT_KEY;if(!secret||secret.length<32)throw new Error('Producer authority signer unavailable');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonicalStringify(authority)));return Array.from(new Uint8Array(signed),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function verifyProducerAuthority(authority:Record<string,unknown>,signature:string){const secret=process.env.WHITEBOX_HERMES_RECEIPT_KEY;if(!secret||secret.length<32||authority.version!=='whitebox-producer-authority-v1')return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,hexBytes(signature),new TextEncoder().encode(canonicalStringify(authority)));}

function secure(scope: TokenScope, handler: (ctx: ActionCtx, request: Request) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    if (!authorizedFor(scope, request.headers.get('authorization'), {
      ...(process.env.WHITEBOX_COMMAND_TOKEN?{commandToken:process.env.WHITEBOX_COMMAND_TOKEN}:{}),
      ...(process.env.WHITEBOX_WORKER_TOKEN?{workerToken:process.env.WHITEBOX_WORKER_TOKEN}:{}),
      ...(process.env.WHITEBOX_DELIVERY_TOKEN?{deliveryToken:process.env.WHITEBOX_DELIVERY_TOKEN}:{}),
      ...(process.env.WHITEBOX_RELEASE_TOKEN?{releaseToken:process.env.WHITEBOX_RELEASE_TOKEN}:{}),
      ...(process.env.WHITEBOX_HERMES_PROXY_TOKEN?{proxyToken:process.env.WHITEBOX_HERMES_PROXY_TOKEN}:{}),
    })) return json({ error: 'Unauthorized' }, 401);
    try {
      return await handler(ctx, request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Request failed' }, error instanceof RunOwnershipError ? 403 : 400);
    }
  });
}

http.route({
  path:'/api/release/evidence',method:'POST',
  handler:secure('release',async(ctx,request)=>{const body=await request.json() as {publicId?:unknown;expectedTreeSha?:unknown;expectedSourceDigest?:unknown};if(typeof body.publicId!=='string'||!/^WB-[A-Z0-9]+$/.test(body.publicId)||typeof body.expectedTreeSha!=='string'||!/^[a-f0-9]{40}$/i.test(body.expectedTreeSha)||typeof body.expectedSourceDigest!=='string'||!/^[a-f0-9]{64}$/i.test(body.expectedSourceDigest))return json({error:'Invalid release evidence request'},400);const evidence=await ctx.runQuery(internal.runs.releaseEvidence,{publicId:body.publicId,expectedTreeSha:body.expectedTreeSha.toLowerCase(),expectedSourceDigest:body.expectedSourceDigest.toLowerCase()});return evidence?json(evidence):json({error:'Run not found'},404);}),
});

http.route({
  path: '/api/runs/start',
  method: 'POST',
  handler: secure('command', async (ctx, request) => {
    const body = await request.json() as { repoUrl?: string; goal?: string; telegramUserId?: string; telegramChatId?: string; telegramThreadId?: string };
    if (!body.repoUrl || !body.telegramUserId || !body.telegramChatId) return json({ error: 'repoUrl and Telegram identity are required' }, 400);
    const resolved=await resolvePublicGitHubHead(body.repoUrl,fetch,process.env.GITHUB_TOKEN);
    const result = await ctx.runMutation(internal.start.start, { repoUrl: resolved.repository.canonicalUrl, goal: body.goal ?? 'stabilize critical flows', telegramUserId: body.telegramUserId, telegramChatId: body.telegramChatId, ...(body.telegramThreadId?{telegramThreadId:body.telegramThreadId}:{}),requestedSourceCommitSha:resolved.sourceCommitSha,defaultBranch:resolved.defaultBranch });
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
    assertRunOwner(run.telegramUserId, body.telegramUserId);
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
    assertRunOwner(run.telegramUserId, body.telegramUserId);
    return json({ publicId: run.publicId, repository: run.repository, analysisMode: run.analysisMode, outputSchemaSnapshotId: run.outputSchemaSnapshotId, status: run.status });
  }),
});

http.route({
  path: '/api/runs/action',
  method: 'POST',
  handler: secure('command', async (ctx, request) => {
    const body = await request.json() as { publicId?: string; telegramUserId?: string; action?: 'pause'|'resume'|'cancel' };
    if(body.action&&!['pause','resume','cancel'].includes(body.action))return json({error:'Unsupported audit-only action'},400);
    if (!body.publicId || !body.action || !body.telegramUserId) return json({ error: 'publicId, action, and telegramUserId are required' }, 400);
    const run = await ctx.runQuery(internal.runs.getRunByPublicIdInternal, { publicId: body.publicId });
    if (!run) return json({ error: 'Run not found' }, 404);
    assertRunOwner(run.telegramUserId, body.telegramUserId);
    return json(await ctx.runMutation(internal.management.act, { publicId: body.publicId, action: body.action as 'pause'|'resume'|'cancel', actor: `telegram:${body.telegramUserId}` }));
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
  path:'/api/worker/producer-authority',method:'POST',
  handler:secure('worker',async(ctx,request)=>{const authority=await ctx.runMutation(internal.worker.issueProducerAuthority,await request.json());return json({authority,signature:await producerAuthoritySignature(authority as unknown as Record<string,unknown>)});}),
});

http.route({
  path:'/api/runtime/producer-authority/consume',method:'POST',
  handler:secure('proxy',async(ctx,request)=>{const body=await request.json() as {authority?:Record<string,unknown>;signature?:string};if(!body.authority||typeof body.signature!=='string'||!await verifyProducerAuthority(body.authority,body.signature))return json({error:'Producer authority verification failed'},400);return json(await ctx.runMutation(internal.worker.consumeProducerAuthority,{authority:body.authority} as never));}),
});

http.route({
  path: '/api/worker/verifier-started',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => json(await ctx.runMutation(internal.worker.verifierStarted, await request.json()))),
});

http.route({
  path: '/api/worker/snapshot',
  method: 'POST',
  handler: secure('worker', async (ctx, request) => {
    const body = await request.json() as { jobId: string; leaseId: string; repositoryKey: string; sourceCommitSha: string; snapshotFiles: SnapshotFile[] };
    const verified = await verifyPublicGitHubSnapshot(body.repositoryKey, body.sourceCommitSha, body.snapshotFiles, fetch, process.env.GITHUB_TOKEN);
    return json(await ctx.runMutation(internal.worker.snapshotBound, { ...body, ...verified } as any));
  }),
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
    const body = await request.json() as Record<string,unknown>;
    const auditorReceipt = body.auditorReceipt as Record<string,unknown>;
    const verifierReceipt = body.verifierReceipt as Record<string,unknown>;
    const releaseTreeSha = process.env.WHITEBOX_RELEASE_TREE_SHA ?? '';
    if (!/^[a-f0-9]{40}$/i.test(releaseTreeSha)) return json({ error:'Release tree identity unavailable' },503);
    if(body.releaseSourceDigest!==WHITEBOX_RELEASE_SOURCE_DIGEST||auditorReceipt.releaseSourceDigest!==WHITEBOX_RELEASE_SOURCE_DIGEST||verifierReceipt.releaseSourceDigest!==WHITEBOX_RELEASE_SOURCE_DIGEST)return json({error:'Release source identity mismatch'},400);
    if (!await verifyHermesReceipt(auditorReceipt,String(body.auditorSignature ?? ''),'auditor')
      || !await verifyHermesReceipt(verifierReceipt,String(body.verifierSignature ?? ''),'verifier')) return json({ error:'Hermes receipt verification failed' },400);
    const completion={...body};
    delete completion.auditorSignature;
    delete completion.verifierSignature;
    return json(await ctx.runMutation(internal.worker.complete, { ...completion, receiptsVerified:true,releaseTreeSha:releaseTreeSha.toLowerCase() } as never));
  }),
});

http.route({
  path: '/api/delivery/claim',
  method: 'POST',
  handler: secure('delivery', async (ctx, request) => json(await ctx.runMutation(internal.worker.claimDeliveryLeg, await request.json()))),
});

http.route({
  path: '/api/delivery/complete',
  method: 'POST',
  handler: secure('delivery', async (ctx, request) => {const body=await request.json() as Record<string,unknown>,receipt=body.deliveryReceipt as Record<string,unknown>;if(!await verifyDeliveryReceipt(receipt,String(body.deliverySignature??'')))return json({error:'Delivery receipt verification failed'},400);return json(await ctx.runMutation(internal.worker.deliveryLeg,{outboxId:body.outboxId,leaseId:body.leaseId,leg:body.leg,status:'delivered',deliveryReceipt:receipt,receiptVerified:true} as never));}),
});

http.route({
  path: '/api/delivery/fail',
  method: 'POST',
  handler: secure('delivery', async (ctx, request) => json(await ctx.runMutation(internal.worker.deliveryFailed, await request.json()))),
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
