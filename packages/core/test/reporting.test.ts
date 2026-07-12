import { describe, expect, it } from 'vitest';
import { formatAcceptedTelegram, formatCompletedTelegram, validateExecutiveBrief } from '../src/reporting.js';

const run = { publicId: 'WB-1042', repository: 'owner/repo', mode: 'guarded_repair' as const, dashboardUrl: 'https://whitebox.pages.dev/runs/WB-1042' };

describe('canonical reports', () => {
  it('keeps accepted and completed Telegram messages within limits', () => {
    expect(formatAcceptedTelegram(run).length).toBeLessThanOrEqual(500);
    expect(formatCompletedTelegram({ ...run, found: 5, fixed: 2, reverted: 1, escalated: 1, dependencies: 4, elapsedMs: 161000, prUrl: 'https://github.com/o/r/pull/1' }).length).toBeLessThanOrEqual(700);
  });

  it('enforces canonical brief field limits', () => {
    expect(() => validateExecutiveBrief({ headline: 'x'.repeat(91), systemFlow: 'ok', highestRisk: 'ok', actionTaken: 'ok', validation: 'ok' })).toThrow();
  });
});
