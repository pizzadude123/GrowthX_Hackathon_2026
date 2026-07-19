import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { replaceCanonicalAnalysis } from './lib/persist_analysis';
import { assertCompletionBinding } from './lib/completion_binding';

const leaseDurationMs = 90_000;
const maxAttempts = 3;

async function findAvailableJob(ctx: MutationCtx, now: number) {
  const queued = await ctx.db.query('workerJobs').withIndex('by_status_available', (query) => query.eq('status', 'queued').lte('availableAt', now)).first();
  if (queued) return queued;
  return ctx.db.query('workerJobs').withIndex('by_status_available', (query) => query.eq('status', 'leased').lte('availableAt', now)).first();
}

export const lease = internalMutation({
  args: { workerId: v.string(), leaseId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query('workerJobs').withIndex('by_lease_id', (query) => query.eq('leaseId', args.leaseId)).unique();
    if (existing?.status === 'leased' && existing.workerId === args.workerId) {
      const run = await ctx.db.get(existing.runId);
      if (!run) throw new Error('Run record disappeared');
      return { jobId: existing._id, runId: run._id, publicId: run.publicId, repoUrl: existing.repoUrl, repository: run.repository, goal: run.goal, mode: run.mode, leaseId: args.leaseId, telegramUserId: run.telegramUserId, telegramChatId: run.telegramChatId, telegramThreadId: run.telegramThreadId };
    }
    const job = await findAvailableJob(ctx, now);
    if (!job) return null;
    const run = await ctx.db.get(job.runId);
    if (!run || run.status === 'cancelled') {
      await ctx.db.patch(job._id, { status: 'failed', error: 'Run was cancelled or removed', updatedAt: now });
      return null;
    }
    if (job.attempts >= maxAttempts) {
      await ctx.db.patch(job._id, { status: 'failed', error: 'Worker retry budget exhausted', updatedAt: now });
      await ctx.db.patch(job.runId, { status: 'blocked', currentStage: 'blocked', error: 'Hermes worker retry budget exhausted', completedAt: now });
      return null;
    }
    const expiresAt = now + leaseDurationMs;
    await ctx.db.patch(job._id, { status: 'leased', workerId: args.workerId, leaseId: args.leaseId, attempts: job.attempts + 1, leasedAt: now, leaseExpiresAt: expiresAt, availableAt: expiresAt, updatedAt: now, error: undefined });
    await ctx.db.patch(job.runId, { status: 'queued', currentStage: 'queued', error: undefined });
    return { jobId: job._id, runId: run._id, publicId: run.publicId, repoUrl: job.repoUrl, repository: run.repository, goal: run.goal, mode: run.mode, leaseId: args.leaseId, telegramUserId: run.telegramUserId, telegramChatId: run.telegramChatId, telegramThreadId: run.telegramThreadId };
  },
});

export const snapshotBound = internalMutation({
  args: {
    jobId: v.id('workerJobs'), leaseId: v.string(), repositoryKey: v.string(),
    sourceCommitSha: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'leased' || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const run = await ctx.db.get(job.runId);
    if (!run || run.status === 'cancelled') throw new Error('Run was cancelled');
    if (run.repository.toLowerCase() !== args.repositoryKey.toLowerCase()) throw new Error('Snapshot repository does not match the run');
    if (!/^[a-f0-9]{40}$/i.test(args.sourceCommitSha)) throw new Error('Snapshot requires an immutable commit SHA');
    if (run.sourceCommitSha && run.sourceCommitSha.toLowerCase() !== args.sourceCommitSha.toLowerCase()) throw new Error('Run is already bound to a different source commit');
    await ctx.db.patch(job.runId, { sourceCommitSha: args.sourceCommitSha.toLowerCase(), sourceBoundAt: Date.now() });
    return { ok: true };
  },
});

export const started = internalMutation({
  args: { jobId: v.id('workerJobs'), leaseId: v.string(), hermesRunId: v.string(), hermesSessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'leased' || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const run = await ctx.db.get(job.runId);
    if (!run || run.status === 'cancelled') throw new Error('Run was cancelled');
    if (!run.sourceCommitSha) throw new Error('Source snapshot must be bound before Hermes starts');
    const now = Date.now();
    await ctx.db.patch(job.runId, { status: 'mapping', currentStage: 'mapping', startedAt: now, hermesRunId: args.hermesRunId, hermesSessionId: args.hermesSessionId });
    await ctx.db.insert('agentSteps', { runId: job.runId, stepId: args.hermesRunId, role: 'Whitebox Manager Agent', dynamicallySpawned: false, objective: 'Coordinate the Living Code Logistics agency', status: 'running', startedAt: now, inputSummary: 'Telegram intake dispatched through the authenticated outbound Hermes worker', tools: ['Hermes Runs API', 'delegation'], revisions: [] });
    return { ok: true };
  },
});

export const heartbeat = internalMutation({
  args: { jobId: v.id('workerJobs'), leaseId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'leased' || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const now = Date.now();
    const expiresAt = now + leaseDurationMs;
    await ctx.db.patch(job._id, { leaseExpiresAt: expiresAt, availableAt: expiresAt, updatedAt: now });
    return { ok: true, leaseExpiresAt: expiresAt };
  },
});

export const state = internalMutation({
  args: { jobId: v.id('workerJobs'), leaseId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'leased' || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const run = await ctx.db.get(job.runId);
    if (!run) throw new Error('Run record disappeared');
    return { status: run.status, paused: run.paused };
  },
});

export const stage = internalMutation({
  args: { jobId: v.id('workerJobs'), leaseId: v.string(), stage: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'leased' || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const run = await ctx.db.get(job.runId);
    if (!run || run.status === 'cancelled') throw new Error('Run was cancelled');
    await ctx.db.patch(job.runId, { status: args.stage, currentStage: args.stage });
    return { ok: true };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id('workerJobs'), runId: v.id('runs'), leaseId: v.string(), repositoryKey: v.string(), analysis: v.any(),
    sourceCommitSha: v.string(), hermesRunId: v.string(), protocolVersion: v.string(), resultDigest: v.string(),
    hermesStatus: v.string(), hermesOutputSummary: v.optional(v.string()), resultStatus: v.union(v.literal('audit_only'), v.literal('partial'), v.literal('completed')),
    elapsedMs: v.number(), verifiedRepairCount: v.number(), revertedRepairCount: v.number(), prUrl: v.optional(v.string()), agentSteps: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job?.status === 'completed' && job.leaseId === args.leaseId) return { ok: true, idempotent: true };
    if (!job) throw new Error('Worker lease is invalid');
    const run = await ctx.db.get(job.runId);
    if (!run) throw new Error('Run record disappeared');
    assertCompletionBinding(run, job, args);
    if (!/^[a-f0-9]{64}$/i.test(args.resultDigest)) throw new Error('Completion requires a canonical SHA-256 digest');
    if (run.status === 'cancelled') throw new Error('Run was cancelled');
    if (!['completed','succeeded'].includes(args.hermesStatus.toLowerCase())) throw new Error(`Hermes result is not successful: ${args.hermesStatus}`);
    if (run.mode === 'audit_only' && args.resultStatus === 'completed') throw new Error('Audit-only runs cannot claim a repair completion');
    if (args.resultStatus === 'completed' && !args.prUrl) throw new Error('Completed repair runs require a real PR URL');

    const summary = await replaceCanonicalAnalysis(ctx, args);
    const now = Date.now();
    await ctx.db.patch(job._id, { status: 'completed', updatedAt: now, availableAt: now });
    await ctx.db.patch(job.runId, {
      status: args.resultStatus, currentStage: args.resultStatus,
      mappedFiles: summary.mappedFiles, flowCount: summary.flowCount,
      confirmedFindingCount: summary.confirmedFindingCount, rejectedFindingCount: summary.rejectedFindingCount,
      dependencyRiskCount: summary.dependencyRiskCount, outputSchemaSnapshotId: summary.outputSchemaSnapshotId,
      capabilityProfile: summary.capabilityProfile, verifiedRepairCount: args.verifiedRepairCount,
      revertedRepairCount: args.revertedRepairCount, completedAt: now, elapsedMs: args.elapsedMs,
      prUrl: args.prUrl, error: undefined, resultProtocolVersion: args.protocolVersion,
      resultDigest: args.resultDigest.toLowerCase(),
      deliveryStatus: run.telegramChatId ? 'pending' : 'not_requested', deliveryError: undefined,
    });
    for (const step of args.agentSteps) await ctx.db.insert('agentSteps', { runId: job.runId, parentStepId: run.hermesRunId, ...step });
    const steps = await ctx.db.query('agentSteps').withIndex('by_run', (query) => query.eq('runId', job.runId)).collect();
    const manager = steps.find((step) => step.stepId === run.hermesRunId);
    if (manager) await ctx.db.patch(manager._id, { status: 'completed', finishedAt: now, latencyMs: now - manager.startedAt, outputSummary: args.hermesOutputSummary });
    return { ok: true, status: args.resultStatus, confirmedFindingCount: summary.confirmedFindingCount };
  },
});

export const delivery = internalMutation({
  args: {
    jobId: v.id('workerJobs'), leaseId: v.string(),
    status: v.union(v.literal('delivered'), v.literal('failed')),
    telegramMessageId: v.optional(v.number()), pdfMessageId: v.optional(v.number()), error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseId !== args.leaseId || job.status !== 'completed') throw new Error('Completed worker lease is invalid');
    if (args.status === 'delivered' && args.error) throw new Error('Delivered receipts cannot include an error');
    if (args.status === 'failed' && !args.error) throw new Error('Failed delivery requires an error receipt');
    await ctx.db.patch(job.runId, {
      deliveryStatus: args.status,
      deliveryError: args.status === 'failed' ? args.error?.slice(0, 500) : undefined,
      telegramMessageId: args.telegramMessageId,
      pdfMessageId: args.pdfMessageId,
    });
    return { ok: true };
  },
});

export const abort = internalMutation({
  args: { jobId: v.id('workerJobs'), leaseId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const now = Date.now();
    await ctx.db.patch(job._id, { status: 'failed', error: args.reason, updatedAt: now, availableAt: now });
    const run = await ctx.db.get(job.runId);
    if (run && run.status !== 'cancelled') await ctx.db.patch(job.runId, { status: 'blocked', currentStage: 'blocked', error: args.reason, completedAt: now });
    return { ok: true };
  },
});

export const fail = internalMutation({
  args: { jobId: v.id('workerJobs'), leaseId: v.string(), error: v.string(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== 'leased' || job.leaseId !== args.leaseId) throw new Error('Worker lease is invalid');
    const now = Date.now();
    if (args.retryable && job.attempts < maxAttempts) {
      const retryAt = now + Math.min(60_000, 2_000 * 2 ** Math.max(0, job.attempts - 1));
      await ctx.db.patch(job._id, { status: 'queued', error: args.error, availableAt: retryAt, updatedAt: now, leaseId: undefined, workerId: undefined, leaseExpiresAt: undefined });
      await ctx.db.patch(job.runId, { status: 'queued', currentStage: 'queued', error: `Temporary failure; retry ${job.attempts + 1}/${maxAttempts} queued` });
      return { ok: true, terminal: false, retryAt };
    }
    await ctx.db.patch(job._id, { status: 'failed', error: args.error, updatedAt: now, availableAt: now });
    await ctx.db.patch(job.runId, { status: 'blocked', currentStage: 'blocked', error: args.error, completedAt: now });
    await ctx.db.insert('evalCases', { caseId: `production-${String(job.runId)}`, name: 'Promoted production worker failure', version: 'runtime-v1', expected: { failure: args.error, promotedAt: now } });
    return { ok: true, terminal: true };
  },
});
