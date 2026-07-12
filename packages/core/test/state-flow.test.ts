import { expect, it } from 'vitest';
import { analyzeRepository } from '../src/analyzer.js';

it('detects a paid-to-pending state regression with exact evidence', async () => {
  const files = [{ path: 'order.ts', content: "order.status = 'paid';\ncharge(order);\norder.status = 'pending';" }];
  const result = await analyzeRepository({ repositoryKey: 'acme/orders', files, goal: 'stabilize orders' });
  const finding = result.findings.find((item) => item.category === 'state_flow');
  expect(finding?.status).toBe('confirmed');
  expect(result.flows[0]?.stateTransitions).toHaveLength(2);
  expect(finding?.evidence[0]?.startLine).toBe(3);
});
