import { describe, expect, it } from 'vitest';
import { formatTelegramFinalResult, formatTelegramProgress } from '../src/telegram-progress.js';

const base = {
  publicId: 'WB-TEST',
  repository: 'owner/repo',
  dashboardUrl: 'https://whitebox.example/runs/WB-TEST',
};

describe('Telegram progress', () => {
  it.each(['mapping', 'auditing', 'validating', 'retrying', 'completed', 'blocked', 'cancelled'] as const)('formats a clear %s update', (stage) => {
    const message = formatTelegramProgress({ ...base, stage, mappedFiles: 12, flowCount: 3, findings: 2, fixed: 1, elapsedMs: 45_000, detail: stage === 'blocked' ? 'Hermes unavailable' : undefined });
    expect(message).toContain('WB-TEST');
    expect(message).toContain(base.dashboardUrl);
    expect(message.length).toBeLessThanOrEqual(700);
  });

  it('supports Telegram-only progress without a dashboard link', () => {
    const message = formatTelegramProgress({ publicId: 'WB-ONLY', repository: 'owner/repo', stage: 'auditing' });
    expect(message).not.toContain('Dashboard');
  });

  it('labels an incomplete structured handoff as partial rather than complete', () => {
    const message = formatTelegramFinalResult({
      publicId: 'WB-PARTIAL', repository: 'owner/repo', mode: 'audit_only', commitSha: 'abcdef1234567890', elapsedMs: 10_000,
      mappedFiles: 4, languages: ['TypeScript'], flows: ['Repository scope'], rejectedFindings: 0, findings: [], dependencies: [], agents: [],
      evalPassed: 3, evalTotal: 5, resultState: 'partial', dashboardUrl: 'https://whitebox.example/runs/WB-PARTIAL',
    });
    expect(message).toContain('Partial result');
    expect(message).toContain('independent structured verification was incomplete');
    expect(message).toContain('Commit: abcdef1234567890');
    expect(message).not.toContain('Complete result');
  });

  it('includes evidence, agents, and evals in the final Telegram result', () => {
    const message = formatTelegramFinalResult({
      publicId: 'WB-ONLY', repository: 'owner/repo', mode: 'audit_only', commitSha: 'abcdef1234567890', elapsedMs: 61_000,
      mappedFiles: 12, languages: ['TypeScript'], flows: ['HTTP request flow'], rejectedFindings: 1,
      findings: [{ severity: 'high', title: 'Missing transition guard', evidence: 'src/state.ts:10-18' }],
      dependencies: [{ packageName: 'zod', classification: 'runtime' }],
      agents: [{ role: 'Logic Auditor', status: 'completed' }], evalPassed: 4, evalTotal: 4,
      dashboardUrl: base.dashboardUrl,
    });
    expect(message).toContain('Missing transition guard');
    expect(message).toContain('src/state.ts:10-18');
    expect(message).toContain('Run gates: 4/4 passed');
    expect(message).toContain(base.dashboardUrl);
    expect(message.length).toBeLessThanOrEqual(3900);
  });
});
