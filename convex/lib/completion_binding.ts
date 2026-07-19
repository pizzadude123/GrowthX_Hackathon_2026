type BoundRun = {
  _id: unknown;
  repository: string;
  sourceCommitSha?: string;
  hermesRunId?: string;
  hermesVerifierRunId?: string;
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
  hermesVerifierRunId: string;

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
  if (!run.hermesVerifierRunId || run.hermesVerifierRunId !== completion.hermesVerifierRunId) throw new Error('Completion verifier does not match the bound Hermes run');
  if (completion.hermesRunId === completion.hermesVerifierRunId) throw new Error('Completion requires distinct auditor and verifier runs');

}

export function assertProducerStart(boundProducerId: string | undefined, requestedProducerId: string) {
  if (!boundProducerId) return 'new' as const;
  if (boundProducerId === requestedProducerId) return 'replay' as const;
  throw new Error('Run is already bound to a different producer');
}

export function assertSnapshotOwnership(existing: { repositoryKey: string; sourceCommitSha?: string }, repositoryKey: string, sourceCommitSha: string) {
  if (existing.repositoryKey.toLowerCase() !== repositoryKey.toLowerCase()) throw new Error('Snapshot ID belongs to another repository');
  if (existing.sourceCommitSha?.toLowerCase() !== sourceCommitSha.toLowerCase()) throw new Error('Snapshot ID belongs to another commit');
}

export function producerEvidenceBound(
  run:{hermesRunId?:string;hermesVerifierRunId?:string},
  attempt:{auditorReceiptDigest?:string;verifierReceiptDigest?:string;auditorResultDigest?:string;verifierResultDigest?:string;auditorRunId?:string;verifierRunId?:string;auditorSessionId?:string;verifierSessionId?:string}|null|undefined,
){
  return Boolean(attempt?.auditorReceiptDigest&&attempt.verifierReceiptDigest&&attempt.auditorResultDigest&&attempt.verifierResultDigest
    &&attempt.auditorRunId&&attempt.verifierRunId&&attempt.auditorRunId!==attempt.verifierRunId
    &&attempt.auditorSessionId&&attempt.verifierSessionId&&attempt.auditorSessionId!==attempt.verifierSessionId
    &&run.hermesRunId===attempt.auditorRunId&&run.hermesVerifierRunId===attempt.verifierRunId);
}
