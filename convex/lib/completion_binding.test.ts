import { describe, expect, it } from 'vitest';
import { assertCompletionBinding } from './completion_binding.js';

const run = {
  _id: 'run-1',
  repository: 'acme/demo',
  sourceCommitSha: '0123456789abcdef0123456789abcdef01234567',
  hermesRunId: 'hermes-1',
};
const job = { status: 'leased', leaseId: 'lease-1', runId: 'run-1' };
const completion = {
  runId: 'run-1', leaseId: 'lease-1', repositoryKey: 'acme/demo',
  sourceCommitSha: run.sourceCommitSha, hermesRunId: 'hermes-1',
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
});
