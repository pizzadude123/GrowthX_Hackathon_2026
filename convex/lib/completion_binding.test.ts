import { describe, expect, it } from 'vitest';
import { assertCompletionBinding, assertProducerStart, assertSnapshotOwnership, producerEvidenceBound } from './completion_binding.js';

const run = {
  _id: 'run-1',
  repository: 'acme/demo',
  sourceCommitSha: '0123456789abcdef0123456789abcdef01234567',
  hermesRunId: 'hermes-1',
  hermesVerifierRunId: 'hermes-2',
};
const job = { status: 'leased', leaseId: 'lease-1', runId: 'run-1' };
const completion = {
  runId: 'run-1', leaseId: 'lease-1', repositoryKey: 'acme/demo',
  sourceCommitSha: run.sourceCommitSha, hermesRunId: 'hermes-1',
  hermesVerifierRunId: 'hermes-2',
  protocolVersion: 'whitebox-verified-result-v1',
  analysis: { snapshot: { repositoryKey: 'acme/demo', sourceCommitSha: run.sourceCommitSha } },
};

describe('worker completion binding', () => {
  it('accepts a completion bound to the leased run, repository, commit, producer, and protocol', () => {
    expect(() => assertCompletionBinding(run, job, completion)).not.toThrow();
  });

  it.each([
    ['sourceCommitSha', 'fedcba9876543210fedcba9876543210fedcba98'],
    ['hermesRunId', 'hermes-other'],
    ['hermesVerifierRunId', 'hermes-other'],
    ['protocolVersion', 'unknown-result'],
    ['repositoryKey', 'other/repo'],
  ] as const)('rejects a mismatched %s', (field, value) => {
    expect(() => assertCompletionBinding(run, job, { ...completion, [field]: value })).toThrow();
  });

  it('rejects when the canonical analysis snapshot differs from the bound commit', () => {
    expect(() => assertCompletionBinding(run, job, {
      ...completion,
      analysis: { snapshot: { repositoryKey: 'acme/demo', sourceCommitSha: 'fedcba9876543210fedcba9876543210fedcba98' } },
    })).toThrow('analysis commit');
  });

  it('makes producer start replay-safe without allowing producer replacement', () => {
    expect(assertProducerStart(undefined, 'hermes-1')).toBe('new');
    expect(assertProducerStart('hermes-1', 'hermes-1')).toBe('replay');
    expect(() => assertProducerStart('hermes-1', 'hermes-2')).toThrow('different producer');
  });

  it('blocks global snapshot ID collisions across repositories or commits', () => {
    expect(() => assertSnapshotOwnership({ repositoryKey: 'acme/demo', sourceCommitSha: run.sourceCommitSha }, 'acme/demo', run.sourceCommitSha)).not.toThrow();
    expect(() => assertSnapshotOwnership({ repositoryKey: 'other/repo', sourceCommitSha: run.sourceCommitSha }, 'acme/demo', run.sourceCommitSha)).toThrow('repository');
    expect(() => assertSnapshotOwnership({ repositoryKey: 'acme/demo', sourceCommitSha: 'fedcba9876543210fedcba9876543210fedcba98' }, 'acme/demo', run.sourceCommitSha)).toThrow('commit');
  });

  it('requires the run and exact release attempt to bind both independent producers',()=>{
    const attempt={auditorReceiptDigest:'a',verifierReceiptDigest:'b',auditorResultDigest:'c',verifierResultDigest:'d',auditorRunId:'hermes-1',verifierRunId:'hermes-2',auditorSessionId:'auditor-session',verifierSessionId:'verifier-session'};
    expect(producerEvidenceBound(run,attempt)).toBe(true);
    expect(producerEvidenceBound({},attempt)).toBe(false);
    expect(producerEvidenceBound(run,{...attempt,verifierRunId:'hermes-1'})).toBe(false);
  });
});
