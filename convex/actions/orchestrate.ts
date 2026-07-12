"use node";
import { internalAction } from '../_generated/server';
import { api } from '../_generated/api';
import { v } from 'convex/values';
import { GitHubClient } from '../../src/integrations/github/client.js';
import { HermesRunsClient } from '../../packages/core/src/hermes-client.js';
import { analyzeRepository } from '../../packages/core/src/analyzer.js';
import { proposeRepairs, validateRepairs } from '../../packages/core/src/repairs.js';
import { WHITEBOX_AGENCY_SYSTEM_PROMPT } from '../../src/integrations/hermes/prompt.js';

export const run = internalAction({
  args: { runId: v.id('runs'), repoUrl: v.string() },
  handler: async (ctx, args) => {
    const started = Date.now();
    try {
      const github = new GitHubClient(process.env.GITHUB_TOKEN);
      const repository = await github.inspect(args.repoUrl);
      const runDoc = await ctx.runQuery(api.runs.getByInternalId, { runId: args.runId });
      if (!runDoc) throw new Error('Run record disappeared');
      const hermes = new HermesRunsClient({ baseUrl: process.env.HERMES_SERVER_URL ?? 'http://127.0.0.1:8642', key: process.env.HERMES_SERVER_KEY, environment: 'production' });
      const hermesRun = await hermes.createRun({
        input: `Run Whitebox for ${repository.key}. Goal: ${runDoc.goal}. Public run: ${runDoc.publicId}. Use real delegation and return concise structured outcomes only.`,
        sessionId: runDoc.publicId,
        instructions: WHITEBOX_AGENCY_SYSTEM_PROMPT
      });
      await ctx.runMutation(api.runs.patch, { runId: args.runId, patch: { status: 'mapping', currentStage: 'mapping', startedAt: started, hermesRunId: hermesRun.runId, hermesSessionId: runDoc.publicId } });
      const analysis = await analyzeRepository({ repositoryKey: repository.key, files: repository.files, goal: runDoc.goal, runId: runDoc.publicId, dashboardUrl: `${process.env.PUBLIC_APP_URL}/runs/${runDoc.publicId}` });
      analysis.snapshot.sourceCommitSha = repository.sourceSha;
      if (runDoc.mode === 'guarded_repair') {
        const candidates = proposeRepairs(repository.files, analysis.findings);
        const proof = await validateRepairs(repository.key, repository.files, candidates);
        analysis.repairs = proof.repairs;
        analysis.validations = proof.validations;
      }
      await ctx.runMutation(api.runs.persistAnalysis, { runId: args.runId, repositoryKey: repository.key, analysis });
      const verified = analysis.repairs.filter((repair) => repair.status === 'verified').length;
      const reverted = analysis.repairs.filter((repair) => repair.status === 'reverted').length;
      await ctx.runMutation(api.runs.patch, { runId: args.runId, patch: { status: runDoc.mode === 'audit_only' ? 'audit_only' : 'partial', currentStage: runDoc.mode === 'audit_only' ? 'audit_only' : 'validating', verifiedRepairCount: verified, revertedRepairCount: reverted, completedAt: Date.now(), elapsedMs: Date.now() - started } });
    } catch (error) {
      await ctx.runMutation(api.runs.patch, { runId: args.runId, patch: { status: 'blocked', currentStage: 'blocked', error: error instanceof Error ? error.message : 'Unknown orchestration failure', completedAt: Date.now(), elapsedMs: Date.now() - started } });
    }
  }
});
