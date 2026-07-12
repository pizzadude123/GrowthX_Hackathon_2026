import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/analyzer.js';
import { proposeRepairs, validateRepairs } from '../src/repairs.js';

const files = [
  { path: 'src/config.ts', content: "export const paymentUrl = process.env.PAYMENT_URL;" },
  { path: 'src/refund.ts', content: "export const refundUrl = process.env.PAYMENTS_URL;" },
  { path: 'src/checkout.ts', content: "export async function checkout(url: string) { return fetch(url); }" },
  { path: 'package.json', content: JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } }) }
];

describe('guarded repair engine', () => {
  it('creates bounded independently reversible repairs and proves violations disappear', async () => {
    const before = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'checkout' });
    const repairs = proposeRepairs(files, before.findings);
    expect(repairs).toHaveLength(2);
    expect(repairs.every((repair) => repair.changedFiles.length <= 5 && repair.changedLineCount <= 250)).toBe(true);
    const result = await validateRepairs('acme/demo', files, repairs);
    expect(result.repairs.every((repair) => repair.status === 'verified')).toBe(true);
    expect(result.validations.every((validation) => validation.status === 'passed')).toBe(true);
    expect(result.after.findings.filter((finding) => finding.status === 'confirmed')).toHaveLength(0);
  });
});
