import { describe, expect, it } from 'vitest';
import { calculateSchemaDelta } from '../src/incremental.js';
import type { LivingSchemaSnapshot } from '../src/contracts.js';

const base: LivingSchemaSnapshot = {
  id: 'schema-1', repositoryKey: 'acme/demo', version: 1, createdAt: 1,
  nodeIds: ['a'], edgeIds: [], flowIds: ['checkout'], principleIds: ['p1'], preferenceIds: [], dependencyRecordIds: [], confidenceSummary: 'high', fileFingerprints: { 'a.ts': 'one', 'b.ts': 'same' }
};

describe('incremental schema', () => {
  it('limits a repeat analysis to changed files and impacted flows', () => {
    const next = { ...base, id: 'schema-2', version: 2, parentSnapshotId: 'schema-1', fileFingerprints: { 'a.ts': 'two', 'b.ts': 'same' } };
    const delta = calculateSchemaDelta('WB-2', base, next, { 'a.ts': ['checkout'], 'b.ts': ['auth'] });
    expect(delta.changedFiles).toEqual(['a.ts']);
    expect(delta.impactedFlowIds).toEqual(['checkout']);
  });
});
