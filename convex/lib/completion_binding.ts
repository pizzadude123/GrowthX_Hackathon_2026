type BoundRun = {
  _id: unknown;
  repository: string;
  sourceCommitSha?: string;
  hermesRunId?: string;
};

type BoundJob = {
  status: string;
  leaseId?: string;
  runId: unknown;
};

type Completion = {
  runId: unknown;
  leaseId: string;
  repositoryKey: string;
  sourceCommitSha: string;
  hermesRunId: string;
  protocolVersion: string;
  analysis: { snapshot?: { repositoryKey?: string; sourceCommitSha?: string } };
};

export function assertCompletionBinding(run: BoundRun, job: BoundJob, completion: Completion) {
  if (job.status !== 'leased' || job.leaseId !== completion.leaseId || job.runId !== completion.runId || run._id !== completion.runId) {
    throw new Error('Worker lease is invalid');
  }
  if (completion.protocolVersion !== 'whitebox-verified-result-v1') throw new Error('Completion protocol is unsupported');
  if (run.repository.toLowerCase() !== completion.repositoryKey.toLowerCase()) throw new Error('Completion repository does not match the run');
  if (!run.sourceCommitSha || run.sourceCommitSha.toLowerCase() !== completion.sourceCommitSha.toLowerCase()) throw new Error('Completion commit does not match the bound run commit');
  if (completion.analysis.snapshot?.repositoryKey?.toLowerCase() !== run.repository.toLowerCase()) throw new Error('Completion analysis repository does not match the bound run');
  if (completion.analysis.snapshot?.sourceCommitSha?.toLowerCase() !== run.sourceCommitSha.toLowerCase()) throw new Error('Completion analysis commit does not match the bound run commit');
  if (!run.hermesRunId || run.hermesRunId !== completion.hermesRunId) throw new Error('Completion producer does not match the bound Hermes run');
}
