import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { GitHubClient } from '../src/integrations/github/client.js';

import { analyzeRepository } from '../packages/core/src/analyzer.js';
import { HermesRunCreationError, HermesRunsClient,type ProducerCreationEnvelope } from '../packages/core/src/hermes-client.js';
import { assertIndependentHermesRuns } from '../packages/core/src/agent-telemetry.js';


import { assertJobMayContinue, assertWorkerConfiguration, attemptArtifactPaths, isHermesRunTerminal, isHermesRunSuccessful, isTransientFailure, retryTransient } from '../packages/core/src/worker.js';
import { enforceAnalysisIntegrity } from '../packages/core/src/evidence-integrity.js';
import { mergeHermesVerifiedResult, parseHermesAuditorProposalText, parseHermesVerifiedResultText, reconcileHermesReview } from '../packages/core/src/hermes-result.js';
import { hermesAuditorRunInput,hermesVerifierRunInput } from '../packages/core/src/hermes-authority.js';
import { classifyDeliveryError } from '../packages/core/src/telegram-delivery.js';
import {WHITEBOX_RELEASE_SOURCE_DIGEST} from '../packages/core/src/release-identity.js';

type JobBase = { runId:string; publicId:string; repository:string; mode:'audit_only'; leaseId:string };
type AnalysisJob = JobBase & { kind:'analysis'; jobId:string; attemptId:string; repoUrl:string; requestedSourceCommitSha:string; goal:string; telegramUserId?:string; telegramChatId?:string; telegramThreadId?:string };
type DeliveryJob = JobBase & { kind:'delivery'; outboxId:string; messageStatus:'pending'|'sending'|'delivered'|'unknown'; attachmentStatus:'pending'|'sending'|'delivered'|'unknown' };
type Job = AnalysisJob | DeliveryJob;

const config = assertWorkerConfiguration({
  controlPlaneUrl: process.env.WHITEBOX_CONTROL_PLANE_URL ?? '',
  workerToken: process.env.WHITEBOX_WORKER_TOKEN ?? '',
  hermesUrl:process.env.HERMES_SERVER_URL??'',
  proxyToken: process.env.WHITEBOX_HERMES_PROXY_TOKEN ?? '',
});
const workerId = process.env.WHITEBOX_WORKER_ID ?? `whitebox-${process.pid}`;
const github = new GitHubClient(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN);

const hermes = new HermesRunsClient({ baseUrl: config.hermesUrl, key: config.proxyToken, environment: 'production' });
const auditorPrompt = await readFile(resolve('hermes/WHITEBOX_AUDITOR_SYSTEM_PROMPT.md'), 'utf8');
const verifierPrompt = await readFile(resolve('hermes/WHITEBOX_POC_SYSTEM_PROMPT.md'), 'utf8');



function analysisFailureClass(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('github rate limit') || message.includes('repository permission')) return 'source_access_denied';
  if (message.includes('snapshot') || message.includes('source bytes') || message.includes('bound github blobs')) return 'source_binding_rejected';
  if (message.includes('hermes') && message.includes('timeout')) return 'producer_timeout';
  if (message.includes('strict proposal') || message.includes('strict signed result')) return 'producer_schema_rejected';
  if (message.includes('receipt binding')) return 'receipt_binding_rejected';
  if (message.includes('producer or runtime binding')) return 'runtime_binding_rejected';
  if (message.includes('signed hermes envelopes')) return 'envelope_reconciliation_rejected';
  if (message.includes('signed hermes result')) return 'envelope_merge_rejected';
  if (message.includes('canonical evidence') || message.includes('canonical analysis') || message.includes('source metadata')) return 'canonical_integrity_rejected';
  if (message.includes('failed to insert') || message.includes('does not match validator')) return 'persistence_schema_rejected';
  if (message.includes('analysis snapshot') || message.includes('run record disappeared')) return 'canonical_persistence_rejected';
  if (message.includes('/api/worker/complete')) {
    const reason = message.match(/uncaught error: ([a-z0-9 _.-]{1,120})/)?.[1]?.trim().replace(/\s+/g, '_');
    return reason ? `canonical_completion_rejected_${reason}` : 'canonical_completion_rejected';
  }
  if (message.includes('/api/worker/snapshot')) return 'snapshot_boundary_rejected';
  return 'unclassified_failure';
}

async function assertHermesNoToolRuntime() {
  const response=await fetch(`${config.hermesUrl}/whitebox/runtime`,{headers:{Authorization:`Bearer ${config.proxyToken}`},signal:AbortSignal.timeout(10_000)});
  const payload=await response.json() as {receipt?:{runScopedGate?:unknown;signerAvailable?:unknown}};
  if(!response.ok||payload.receipt?.runScopedGate!==true||payload.receipt.signerAvailable!==true)throw new Error('Dedicated Hermes run-scoped runtime gate is unavailable');
}

function dashboardUrl(job: Job) {
  return `${process.env.PUBLIC_APP_URL}/runs/${job.publicId}`;
}



async function signedDelivery(job:DeliveryJob,leg:'message'|'attachment'){
  const response=await fetch(`${config.hermesUrl}/whitebox/deliver`,{method:'POST',headers:{Authorization:`Bearer ${config.proxyToken}`,'Content-Type':'application/json'},body:JSON.stringify({outboxId:job.outboxId,leaseId:job.leaseId,leg}),signal:AbortSignal.timeout(75_000)});
  if(!response.ok)throw new Error(`Signed delivery failed (${response.status})`);
}

async function deliverArtifacts(job: DeliveryJob) {
  const heartbeat=setInterval(()=>{void control('/api/worker/heartbeat',{outboxId:job.outboxId,leaseId:job.leaseId}).catch(()=>undefined);},30_000);
  try {
    if(job.messageStatus==='pending'){
      await signedDelivery(job,'message');
    }
    if(job.attachmentStatus==='pending'){
      await signedDelivery(job,'attachment');
    }
  } catch {
    console.error(`${job.publicId}: delivery attempt failed closed`);
  } finally {
    clearInterval(heartbeat);
  }
}

async function control<T>(path: string, body: unknown, retry = true): Promise<T> {
  const operation = async () => {
    const response = await fetch(`${config.controlPlaneUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${config.workerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const raw = await response.text();
    let data: T & { error?: string };
    try { data = JSON.parse(raw) as T & { error?: string }; }
    catch { throw new Error(`Control plane returned ${response.status} with invalid JSON`); }
    if (!response.ok) throw new Error(`Control plane ${path} failed (${response.status}): ${data.error ?? 'request failed'}`);
    return data;
  };
  return retry ? retryTransient(operation, { attempts: 3, baseDelayMs: 500 }) : operation();
}

async function awaitJobReady(job: AnalysisJob) {
  while (true) {
    const state = await control<{ status: string; paused: boolean }>('/api/worker/state', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId });
    const policy = assertJobMayContinue(state);
    if (!policy.paused) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
}


async function loadVerifiedResult(hermesOutput?: string) {
  const parsed = parseHermesVerifiedResultText(hermesOutput ?? '');
  return { input: parsed.result, source: parsed.result ? 'Hermes final output' : undefined, errors: parsed.errors };
}

async function waitForHermes(job: AnalysisJob, runId: string, onProgress: (elapsedMs: number) => Promise<void>) {
  const timeoutMs = Math.max(120_000, Math.floor(Number(process.env.WHITEBOX_HERMES_TIMEOUT_MS ?? 1_200_000) / 2));
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let polls = 0;
  while (Date.now() < deadline) {
    polls += 1;
    try {
      await awaitJobReady(job);
    } catch (error) {
      await hermes.stopRun(runId).catch(() => undefined);
      throw error;
    }
    let status;
    try {
      status = await retryGateway(() => hermes.getRun(runId));
    } catch (error) {
      await hermes.stopRun(runId).catch(() => undefined);
      throw error;
    }
    if (isHermesRunTerminal(status.status)) return status;
    if (status.status === 'waiting_for_approval') await hermes.resolveApproval(runId, 'deny');
    if (polls % 15 === 0 || status.status === 'waiting_for_approval') await onProgress(Date.now() - startedAt);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  await hermes.stopRun(runId);
  throw new Error(`Hermes run exceeded the ${Math.round(timeoutMs / 60_000)}-minute worker budget`);
}

async function retryGateway<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (!String(error).toLowerCase().includes('fetch') || attempt === attempts) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2_000));
    }
  }
  throw new Error(`Hermes gateway unreachable after ${attempts} automatic attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function execute(job: AnalysisJob) {
  const startedAt = Date.now();
  let activeHermesRunId: string | undefined;
  const heartbeat = setInterval(() => {
    void control('/api/worker/heartbeat', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId }).catch((error) => {
      console.error(`${job.publicId}: lease heartbeat failed — ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  }, 30_000);
  try {
  await awaitJobReady(job);
  if(!job.requestedSourceCommitSha)throw new Error('Server-resolved source commit is missing');
  const repository = await retryTransient(() => github.inspect(job.repoUrl,job.requestedSourceCommitSha), { attempts: 3, baseDelayMs: 750 });
  const sourceBinding=await control<{snapshotDigest:string;coverageDigest:string}>('/api/worker/snapshot', {
    jobId: job.jobId, attemptId:job.attemptId, leaseId: job.leaseId, repositoryKey: repository.key,
    sourceCommitSha: repository.sourceSha, snapshotFiles: repository.snapshotFiles,
  });
  const { attemptDir } = attemptArtifactPaths(resolve('.whitebox-runs'), job.publicId, job.leaseId);
  const initialAnalysis = await analyzeRepository({ repositoryKey: repository.key, files: repository.files, goal:'audit_only', runId: job.publicId, dashboardUrl: dashboardUrl(job),sourceCommitSha:repository.sourceSha,coverageDigest:sourceBinding.coverageDigest });
  const auditorInput = await hermesAuditorRunInput(job.publicId,repository.key,repository.sourceSha,sourceBinding.snapshotDigest,sourceBinding.coverageDigest,repository.files,initialAnalysis.findings);
  if (Buffer.byteLength(auditorInput) > 320_000) throw new Error('Repository packet exceeds the isolated Hermes context boundary');

  const auditorSessionId=`${job.publicId}-auditor-${job.attemptId}`;
  const auditorAuthority=await control<ProducerCreationEnvelope>('/api/worker/producer-authority',{jobId:job.jobId,attemptId:job.attemptId,leaseId:job.leaseId,role:'auditor'});
  const auditorRun = await hermes.createRun({
    input: auditorInput,
    sessionId: auditorSessionId,
    instructions: auditorPrompt,
    creationAuthority:auditorAuthority,
  });
  activeHermesRunId = auditorRun.runId;
  try {
    await control('/api/worker/started', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId, hermesRunId: auditorRun.runId, hermesSessionId: auditorSessionId });
  } catch (error) {
    await hermes.stopRun(auditorRun.runId).catch(() => undefined);
    throw error;
  }
  await control('/api/worker/stage', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId, stage: 'auditing' });
  const auditorResult = await waitForHermes(job, auditorRun.runId, async () => undefined);
  const auditorOutput = auditorResult.output;
  if (!isHermesRunSuccessful(auditorResult.status) || !auditorOutput?.trim()) throw new Error(`Hermes Repository Auditor ended with ${auditorResult.status}`);
  if (!auditorResult.receipt || !auditorResult.receiptSignature) throw new Error('Hermes Repository Auditor receipt is missing');
  const parsedAuditor = parseHermesAuditorProposalText(auditorOutput);
  if (!parsedAuditor.result || parsedAuditor.errors.length) throw new Error('Hermes Repository Auditor did not return a strict proposal envelope');
  if (parsedAuditor.result.repository.toLowerCase() !== repository.key.toLowerCase() || parsedAuditor.result.sourceCommitSha.toLowerCase() !== repository.sourceSha.toLowerCase()) {
    throw new Error('Hermes Repository Auditor proposal is not bound to the inspected repository snapshot');
  }


  const verifierSessionId = `${job.publicId}-verifier-${job.attemptId}`;
  const verifierAuthority=await control<ProducerCreationEnvelope>('/api/worker/producer-authority',{jobId:job.jobId,attemptId:job.attemptId,leaseId:job.leaseId,role:'verifier'});
  const verifierRun = await hermes.createRun({
    input: await hermesVerifierRunInput(job.publicId,repository.key,repository.sourceSha,sourceBinding.snapshotDigest,sourceBinding.coverageDigest,repository.files,parsedAuditor.result,initialAnalysis.findings),
    sessionId: verifierSessionId,
    instructions: verifierPrompt,
    creationAuthority:verifierAuthority,
  });
  activeHermesRunId = verifierRun.runId;
  await control('/api/worker/verifier-started', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId, hermesRunId: verifierRun.runId, hermesSessionId: verifierSessionId });
  await control('/api/worker/stage', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId, stage: 'validating' });

  const verifierResult = await waitForHermes(job, verifierRun.runId, async () => undefined);
  if (!verifierResult.receipt || !verifierResult.receiptSignature) throw new Error('Hermes Verification Lead receipt is missing');
  activeHermesRunId = undefined;
  assertIndependentHermesRuns(auditorResult, verifierResult);
  const hermesResult = verifierResult;

  let analysis = enforceAnalysisIntegrity(initialAnalysis, repository.files).analysis;
  const verifiedResult = await loadVerifiedResult(hermesResult.output);
  const ingestionMessages: string[] = [...verifiedResult.errors];
  if(!verifiedResult.input)throw new Error('Hermes verifier did not return a strict signed result');
  const reconciled = reconcileHermesReview(parsedAuditor.result, verifiedResult.input);ingestionMessages.push(...reconciled.errors);if(!reconciled.result)throw new Error('Hermes signed envelopes do not reconcile');const merged=await mergeHermesVerifiedResult(analysis,repository.files,reconciled.result);if(merged.errors.length)throw new Error('Hermes signed result cannot be merged');analysis=merged.analysis;ingestionMessages.push(`Hermes verified findings: ${merged.acceptedCount} accepted, ${merged.rejectedCount} rejected.`);
  analysis.snapshot.confidenceSummary = `${analysis.manifest.capability.deepSemantic ? 'Deep-semantic signals available' : 'Baseline analysis'}; ${analysis.findings.filter((finding) => finding.status === 'confirmed').length} confirmed findings.`;
  await control('/api/worker/stage', { jobId: job.jobId, attemptId: job.attemptId, leaseId: job.leaseId, stage: 'validating' });

  await awaitJobReady(job);
  const completion=await control<{completionDigest:string}>('/api/worker/complete', {
    jobId: job.jobId,
    attemptId:job.attemptId,
    runId: job.runId,
    leaseId: job.leaseId,
    repositoryKey: repository.key,
    sourceCommitSha: repository.sourceSha,
    hermesRunId: auditorRun.runId,
    hermesVerifierRunId: verifierRun.runId,
    auditorProposal:parsedAuditor.result,
    verifierResult:verifiedResult.input,
    auditorReceipt:auditorResult.receipt,
    auditorSignature:auditorResult.receiptSignature,
    verifierReceipt:verifierResult.receipt,
    verifierSignature:verifierResult.receiptSignature,
    sourceFiles: repository.files,
    releaseSourceDigest:WHITEBOX_RELEASE_SOURCE_DIGEST,
  });
  await mkdir(attemptDir,{recursive:true});
  await writeFile(resolve(attemptDir,'RESULT_INGESTION.json'),JSON.stringify({state:'completed',attemptId:job.attemptId,completionDigest:completion.completionDigest,messages:ingestionMessages},null,2));
  console.log(`${job.publicId}: ${isHermesRunSuccessful(hermesResult.status) ? 'completed' : hermesResult.status} (${Date.now() - startedAt}ms)`);
  } finally {
    if (activeHermesRunId) await hermes.stopRun(activeHermesRunId).catch(() => undefined);
    clearInterval(heartbeat);
  }
}

async function main() {
  await assertHermesNoToolRuntime();
  console.log(`Whitebox worker ${workerId} connected to ${config.controlPlaneUrl}`);
  while (true) {
    const leaseId = randomUUID();
    let job: Job | null;
    try {
      job = await control<Job | null>('/api/worker/lease', { workerId, leaseId });
    } catch (error) {
      console.error(`Worker lease poll failed; staying alive — ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
      continue;
    }
    if (!job) {
      if (process.argv.includes('--once')) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
      continue;
    }
    try {
      if (job.kind === 'delivery') {
        await deliverArtifacts(job);
      } else {
        await execute(job);
      }
    } catch (error) {
      if (job.kind === 'delivery') {
        await control('/api/worker/delivery-fail', { outboxId:job.outboxId, leaseId:job.leaseId, code:classifyDeliveryError(error) }).catch(() => undefined);
        console.error(`${job.publicId}: delivery recovery failed closed`);
        continue;
      }
      const current=await control<{status:string}>('/api/worker/state',{jobId:job.jobId,attemptId:job.attemptId,leaseId:job.leaseId},false).catch(()=>({status:'unknown'}));
      const cancelled=current.status==='cancelled';
      let terminal = true;
      if (cancelled) {
        await control('/api/worker/abort', { jobId:job.jobId,attemptId:job.attemptId,leaseId:job.leaseId,code:'cancelled' }).catch(() => undefined);
      } else {
        const failure = await control<{ terminal: boolean }>('/api/worker/fail', { jobId:job.jobId,attemptId:job.attemptId,leaseId:job.leaseId,code:classifyDeliveryError(error),retryable:!(error instanceof HermesRunCreationError)&&isTransientFailure(error) }).catch(() => {
          console.error(`${job.publicId}: unable to persist bounded failure`);
          return { terminal: true };
        });
        terminal = failure.terminal;
      }
      console.error(`${job.publicId}: ${cancelled?'cancelled':terminal?'blocked':'retry queued'} with redacted ${analysisFailureClass(error)}`);
    }
    if (process.argv.includes('--once')) return;
  }
}

await main();
