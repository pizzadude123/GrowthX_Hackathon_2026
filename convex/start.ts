import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { parseGitHubRepository } from '../packages/core/src/security.js';

export const start = internalMutation({
  args: { repoUrl: v.string(), goal: v.string(), telegramUserId: v.string(), telegramChatId: v.string(), telegramThreadId: v.optional(v.string()),requestedSourceCommitSha:v.string(),defaultBranch:v.string() },
  handler: async (ctx, args) => {
    const repo = parseGitHubRepository(args.repoUrl);
    if(!/^[a-f0-9]{40}$/i.test(args.requestedSourceCommitSha)||!args.defaultBranch)throw new Error('Resolved GitHub source is invalid');
    const goal = args.goal.trim() || 'stabilize critical flows';
    if (goal.length > 240) throw new Error('Goal must be 240 characters or fewer');
    const now = Date.now();
    const recent = await ctx.db.query('runs').withIndex('by_repository', (query) => query.eq('repository', repo.key)).order('desc').first();
    if (recent && now - recent.createdAt < 30_000 && recent.goal === goal && recent.telegramUserId === args.telegramUserId
      && recent.telegramChatId===args.telegramChatId&&(recent.telegramThreadId??'')===(args.telegramThreadId??'')
      && recent.requestedSourceCommitSha?.toLowerCase()===args.requestedSourceCommitSha.toLowerCase()
      && !['blocked','cancelled','failed'].includes(recent.status)) {
      return { publicId: recent.publicId, runId: recent._id, repository: recent.repository, mode: recent.mode, dashboardUrl: `${process.env.PUBLIC_APP_URL ?? ''}/runs/${recent.publicId}` };
    }
    const publicId = `WB-${Date.now().toString(36).toUpperCase()}`;
    const mode = 'audit_only' as const;
    const runId = await ctx.db.insert('runs', {
      publicId,
      telegramUserId: args.telegramUserId,
      telegramChatId: args.telegramChatId,
      ...(args.telegramThreadId?{telegramThreadId:args.telegramThreadId}:{}),
      repository: repo.key,
      owner: repo.owner,
      name: repo.name,
      goal,
      requestedSourceCommitSha:args.requestedSourceCommitSha.toLowerCase(),
      defaultBranch:args.defaultBranch,
      mode,
      status: 'accepted',
      currentStage: 'accepted',
      promptVersion: 'whitebox-agency-v3-evidence',
      createdAt: now,
      dashboardSlug: publicId,
      mappedFiles: 0,
      flowCount: 0,
      confirmedFindingCount: 0,
      rejectedFindingCount: 0,

      dependencyRiskCount: 0,
      analysisMode: 'initial_full',
      changedFileCount: 0,
      impactedFlowCount: 0,
      paused: false,

    });
    await ctx.db.insert('workerJobs', {
      runId,
      repoUrl: repo.canonicalUrl,
      requestedSourceCommitSha:args.requestedSourceCommitSha.toLowerCase(),
      status: 'queued',
      attempts: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      publicId,
      runId,
      repository: repo.key,
      mode,
      dashboardUrl: `${process.env.PUBLIC_APP_URL ?? ''}/runs/${publicId}`,
    };
  },
});
