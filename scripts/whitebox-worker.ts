import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { GitHubClient } from '../src/integrations/github/client.js';
import { LinkupClient } from '../src/integrations/linkup/client.js';
import { analyzeRepository } from '../packages/core/src/analyzer.js';
import { proposeRepairs, validateRepairs } from '../packages/core/src/repairs.js';
import { HermesRunsClient } from '../packages/core/src/hermes-client.js';
import { sanitizeRelativePath } from '../packages/core/src/security.js';

import { formatTelegramAgentUpdate, formatTelegramFinalResult, formatTelegramProgress } from '../packages/core/src/telegram-progress.js';
import { createPdfReport } from '../packages/core/src/report-pdf.js';
import { assertJobMayContinue, assertWorkerConfiguration, attemptArtifactPaths, canonicalResultSourceLabel, hermesTelegramTarget, isHermesRunTerminal, isHermesRunSuccessful, isTransientFailure, retryTransient } from '../packages/core/src/worker.js';
import { enforceAnalysisIntegrity } from '../packages/core/src/evidence-integrity.js';
import { demoteUnverifiedAnalysis, mergeHermesVerifiedResult, parseHermesVerifiedResultText } from '../packages/core/src/hermes-result.js';

type Job = { jobId: string; runId: string; publicId: string; repoUrl: string; repository: string; goal: string; mode: 'audit_only' | 'guarded_repair'; leaseId: string; telegramUserId?: string; telegramChatId?: string; telegramThreadId?: string };

const config = assertWorkerConfiguration({
  controlPlaneUrl: process.env.WHITEBOX_CONTROL_PLANE_URL ?? '',
  workerToken: process.env.WHITEBOX_WORKER_TOKEN ?? '',
  hermesKey: process.env.HERMES_SERVER_KEY ?? '',
});
const workerId = process.env.WHITEBOX_WORKER_ID ?? `whitebox-${process.pid}`;
const github = new GitHubClient(process.env.GITHUB_TOKEN);
const linkup = new LinkupClient(process.env.LINKUP_API_KEY);
const hermes = new HermesRunsClient({ baseUrl: process.env.HERMES_SERVER_URL ?? 'http://127.0.0.1:8742', key: config.hermesKey, environment: 'production' });
const systemPrompt = await readFile(resolve('hermes/WHITEBOX_POC_SYSTEM_PROMPT.md'), 'utf8');
const execFileAsync = promisify(execFile);
const hermesCli = process.env.HERMES_CLI ?? '/Users/pranay/.local/bin/hermes';

function dashboardUrl(job: Job) {
  return `${process.env.PUBLIC_APP_URL}/runs/${job.publicId}`;
}

async function telegramSend(job: Job, text: string) {
  if (!job.telegramChatId) return;
  await execFileAsync(hermesCli, ['--profile', 'whitebox', 'send', '--to', hermesTelegramTarget(job.telegramChatId, job.telegramThreadId), '--quiet', text], { timeout: 30_000, maxBuffer: 100_000 });
}

async function telegramUpdate(job: Job, text: string) {
  await telegramSend(job, text).catch((error) => {
    console.error(`${job.publicId}: Telegram update failed — ${error instanceof Error ? error.message : 'unknown error'}`);
  });
}

async function telegramSendDocument(job: Job, path: string) {
  if (!job.telegramChatId) return;
  await execFileAsync(hermesCli, ['--profile', 'whitebox', 'send', '--to', hermesTelegramTarget(job.telegramChatId, job.telegramThreadId), '--quiet', `${job.publicId} · Full Whitebox evidence report\nMEDIA:${path}`], { timeout: 60_000, maxBuffer: 100_000 });
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

async function awaitJobReady(job: Job) {
  while (true) {
    const state = await control<{ status: string; paused: boolean }>('/api/worker/state', { jobId: job.jobId, leaseId: job.leaseId });
    const policy = assertJobMayContinue(state);
    if (!policy.paused) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
}

function schemaDocument(run: Job, analysis: Awaited<ReturnType<typeof analyzeRepository>>) {
  const flows = analysis.flows.slice(0, 3).map((flow) => `- **${flow.name}** — ${flow.orderedNodeIds.join(' → ')}`).join('\n') || '- No complete high-confidence flow found.';
  const findings = analysis.findings.filter((finding) => finding.status === 'confirmed').slice(0, 5).map((finding) => `- **${finding.severity.toUpperCase()} · ${finding.title}** — ${finding.evidence[0]?.path ?? 'evidence unavailable'}:${finding.evidence[0]?.startLine ?? 0}`).join('\n') || '- No confirmed findings.';
  return `# Whitebox Living Code Logistics Schema\n\nRun: ${run.publicId}  \nRepository: ${run.repository}  \nGoal: ${run.goal}  \nMode: ${run.mode}  \nSnapshot: ${analysis.snapshot.id}\n\n## Capability profile\n\n${analysis.manifest.languages.map((language) => `- ${language.language}: ${language.percentage}%`).join('\n')}\n\n## High-value flows\n\n${flows}\n\n## Confirmed findings\n\n${findings}\n\n## Principles\n\n- Confirmed claims require exact repository evidence.\n- Repairs require independent validation and bounded blast radius.\n- Public repositories remain audit-only unless server-allowlisted.\n\nGenerated from repository evidence by Whitebox. The structured snapshot remains in Convex.\n`;
}

async function loadVerifiedResult(artifactDir: string, hermesOutput?: string) {
  const artifactPath = resolve(artifactDir, 'verified-result.json');
  try {
    return { input: JSON.parse(await readFile(artifactPath, 'utf8')) as unknown, source: artifactPath, errors: [] as string[] };
  } catch (error) {
    const parsed = parseHermesVerifiedResultText(hermesOutput ?? '');
    return {
      input: parsed.result,
      source: parsed.result ? 'Hermes final output' : undefined,
      errors: parsed.result ? [] : [`verified-result.json unavailable: ${error instanceof Error ? error.message : String(error)}`, ...parsed.errors],
    };
  }
}

async function waitForHermes(job: Job, runId: string, onProgress: (elapsedMs: number) => Promise<void>) {
  const timeoutMs = Number(process.env.WHITEBOX_HERMES_TIMEOUT_MS ?? 1_200_000);
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

async function execute(job: Job) {
  const startedAt = Date.now();
  let activeHermesRunId: string | undefined;
  const heartbeat = setInterval(() => {
    void control('/api/worker/heartbeat', { jobId: job.jobId, leaseId: job.leaseId }).catch((error) => {
      console.error(`${job.publicId}: lease heartbeat failed — ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  }, 30_000);
  try {
  await awaitJobReady(job);
  const repository = await retryTransient(() => github.inspect(job.repoUrl), { attempts: 3, baseDelayMs: 750 });
  await control('/api/worker/snapshot', {
    jobId: job.jobId, leaseId: job.leaseId, repositoryKey: repository.key,
    sourceCommitSha: repository.sourceSha,
  });
  const { runDir, attemptDir } = attemptArtifactPaths(resolve('.whitebox-runs'), job.publicId, job.leaseId);
  const snapshotDir = resolve(attemptDir, 'repository-snapshot');
  for (const file of repository.files) {
    const target = resolve(snapshotDir, sanitizeRelativePath(file.path));
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, file.content);
  }
  const hermesRun = await retryGateway(() => hermes.createRun({
    input: `Execute read-only Whitebox POC run ${job.publicId}. Repository: ${repository.key}. Immutable source commit: ${repository.sourceSha}. User goal: ${job.goal}. The bounded snapshot is ${snapshotDir}. Write the strict final JSON artifact to ${resolve(attemptDir, 'verified-result.json')}. Follow the system instructions, use exact snapshot evidence, perform the minimal auditor-to-verifier workflow, and return the identical JSON object in a fenced json block.`,
    sessionId: job.publicId,
    instructions: systemPrompt,
  }));
  activeHermesRunId = hermesRun.runId;
  try {
    await control('/api/worker/started', { jobId: job.jobId, leaseId: job.leaseId, hermesRunId: hermesRun.runId, hermesSessionId: job.publicId });
  } catch (error) {
    await hermes.stopRun(hermesRun.runId).catch(() => undefined);
    throw error;
  }
  await telegramUpdate(job, formatTelegramProgress({ publicId: job.publicId, repository: job.repository, stage: 'mapping', detail: 'Repository snapshot loaded. Hermes Manager is building the agency plan.' }));

  const initialAnalysis = await analyzeRepository({ repositoryKey: repository.key, files: repository.files, goal: job.goal, runId: job.publicId, dashboardUrl: dashboardUrl(job) });
  initialAnalysis.snapshot.sourceCommitSha = repository.sourceSha;
  const confirmed = initialAnalysis.findings.filter((finding) => finding.status === 'confirmed').length;
  await control('/api/worker/stage', { jobId: job.jobId, leaseId: job.leaseId, stage: 'auditing' });
  await telegramUpdate(job, formatTelegramProgress({ publicId: job.publicId, repository: job.repository, stage: 'auditing', mappedFiles: initialAnalysis.manifest.files.length, flowCount: initialAnalysis.flows.length, findings: confirmed }));
  const hermesResult = await waitForHermes(job, hermesRun.runId, async (elapsedMs) => {
    await telegramUpdate(job, formatTelegramAgentUpdate({
      publicId: job.publicId, repository: job.repository, elapsedMs,
      commitSha: repository.sourceSha, languages: initialAnalysis.manifest.languages.map((item) => item.language),
      mappedFiles: initialAnalysis.manifest.files.length, flowCount: initialAnalysis.flows.length,
      confirmedFindings: confirmed, rejectedFindings: initialAnalysis.findings.filter((finding) => finding.status === 'rejected').length,
      dependencies: initialAnalysis.dependencies.length, agents: [],
    }));
  });
  activeHermesRunId = undefined;

  if (!isHermesRunSuccessful(hermesResult.status)) throw new Error(`Hermes manager ended with ${hermesResult.status}: ${hermesResult.output?.slice(0, 300) ?? 'no output'}`);

  if (process.env.LINKUP_API_KEY && initialAnalysis.dependencies[0]) {
    try {
      const lookup = await linkup.searchDocs(`${initialAnalysis.dependencies[0].packageName} current migration and deprecation documentation`);
      initialAnalysis.dependencies[0] = { ...initialAnalysis.dependencies[0], evidenceSummary: `${initialAnalysis.dependencies[0].evidenceSummary} LinkUp: ${lookup.sourceSummary.slice(0, 400)}` };
    } catch (error) {
      initialAnalysis.dependencies[0] = { ...initialAnalysis.dependencies[0], evidenceSummary: `${initialAnalysis.dependencies[0].evidenceSummary} LinkUp unavailable: ${error instanceof Error ? error.message : 'unknown error'}` };
    }
  }

  let analysis = enforceAnalysisIntegrity(initialAnalysis, repository.files).analysis;
  const verifiedResult = await loadVerifiedResult(attemptDir, hermesResult.output);
  const ingestionMessages: string[] = [...verifiedResult.errors];
  let structuredResultAccepted = false;
  if (verifiedResult.input) {
    const merged = mergeHermesVerifiedResult(analysis, repository.files, verifiedResult.input);
    ingestionMessages.push(...merged.errors);
    if (merged.errors.length === 0) {
      analysis = merged.analysis;
      structuredResultAccepted = true;
      ingestionMessages.push(`Hermes verified findings: ${merged.acceptedCount} accepted, ${merged.rejectedCount} rejected (${canonicalResultSourceLabel(verifiedResult.source)}).`);
    } else {
      analysis = demoteUnverifiedAnalysis(analysis, merged.errors.join('; '));
    }
  } else {
    analysis = demoteUnverifiedAnalysis(analysis, 'Structured Hermes result was missing or malformed');
    ingestionMessages.push('Run is partial: deterministic candidates remain human-review items because Hermes did not return a valid structured artifact.');
  }
  await mkdir(runDir, { recursive: true });
  await writeFile(resolve(runDir, 'RESULT_INGESTION.json'), JSON.stringify({ state: structuredResultAccepted ? 'verified' : 'partial', messages: ingestionMessages }, null, 2));
  if (job.mode === 'guarded_repair' && structuredResultAccepted) {
    const proof = await validateRepairs(repository.key, repository.files, proposeRepairs(repository.files, analysis.findings));
    analysis = enforceAnalysisIntegrity({ ...analysis, repairs: proof.repairs, validations: proof.validations }, repository.files).analysis;
  }
  await control('/api/worker/stage', { jobId: job.jobId, leaseId: job.leaseId, stage: 'validating' });
  await telegramUpdate(job, formatTelegramProgress({ publicId: job.publicId, repository: job.repository, stage: 'validating', mappedFiles: analysis.manifest.files.length, flowCount: analysis.flows.length, findings: analysis.findings.filter((finding) => finding.status === 'confirmed').length }));
  const document = schemaDocument(job, analysis);
  await writeFile(resolve(runDir, 'WHITEBOX_LOGISTICS.md'), document);
  await writeFile(resolve(runDir, 'living-code-logistics-schema.md'), document);
  const persistedAnalysis = { ...analysis, snapshot: { ...analysis.snapshot, schemaDocument: document } };
  const verified = persistedAnalysis.repairs.filter((repair) => repair.status === 'verified').length;
  const reverted = persistedAnalysis.repairs.filter((repair) => repair.status === 'reverted').length;
  const prUrl = undefined;
  const agentSteps: Array<{ role: string; status: string }> = [];
  const confirmedFindings = persistedAnalysis.findings.filter((finding) => finding.status === 'confirmed');
  const evalChecks = [persistedAnalysis.manifest.files.length > 0, persistedAnalysis.flows.length > 0, isHermesRunSuccessful(hermesResult.status), structuredResultAccepted];
  const finalMessage = formatTelegramFinalResult({
    publicId: job.publicId, repository: job.repository, mode: job.mode, commitSha: repository.sourceSha,
    elapsedMs: Date.now() - startedAt, mappedFiles: persistedAnalysis.manifest.files.length,
    languages: persistedAnalysis.manifest.languages.map((item) => item.language), flows: persistedAnalysis.flows.map((flow) => flow.name),
    rejectedFindings: persistedAnalysis.findings.filter((finding) => finding.status === 'rejected').length,
    findings: confirmedFindings.map((finding) => ({ severity: finding.severity, title: finding.title, evidence: finding.evidence[0] ? `${finding.evidence[0].path}:${finding.evidence[0].startLine}-${finding.evidence[0].endLine}` : 'No exact source range persisted' })),
    dependencies: persistedAnalysis.dependencies.map((dependency) => ({ packageName: dependency.packageName, classification: dependency.classification })),
    agents: agentSteps.map((step) => ({ role: step.role, status: step.status })), evalPassed: evalChecks.filter(Boolean).length, evalTotal: evalChecks.length,
    resultState: structuredResultAccepted ? 'verified' : 'partial',
    dashboardUrl: dashboardUrl(job),
    ...(prUrl ? { prUrl } : {}),
  });
  const pdfPath = resolve(runDir, `${job.publicId}-WHITEBOX-REPORT.pdf`);
  const pdf = createPdfReport([...finalMessage.split('\n'), '', 'EDITOR DIAGNOSTICS', ...persistedAnalysis.editorDiagnostics.map((diagnostic) => `${diagnostic.severity.toUpperCase()} ${diagnostic.title} - ${diagnostic.path}:${diagnostic.startLine}-${diagnostic.endLine} - ${diagnostic.impact}`), '', 'LIVING CODE LOGISTICS SCHEMA', ...document.split('\n'), '', 'INGESTION RECEIPT', ...ingestionMessages]);
  await writeFile(pdfPath, pdf);
  const resultDigest = createHash('sha256').update(JSON.stringify(persistedAnalysis)).digest('hex');
  await awaitJobReady(job);
  await control('/api/worker/complete', {
    jobId: job.jobId,
    runId: job.runId,
    leaseId: job.leaseId,
    repositoryKey: repository.key,
    sourceCommitSha: repository.sourceSha,
    hermesRunId: hermesRun.runId,
    protocolVersion: 'whitebox-verified-result-v1',
    resultDigest,
    analysis: persistedAnalysis,
    hermesStatus: hermesResult.status,
    hermesOutputSummary: ingestionMessages.join('\n').slice(0, 2_000),
    resultStatus: structuredResultAccepted ? (job.mode === 'audit_only' ? 'audit_only' : 'partial') : 'partial',
    elapsedMs: Date.now() - startedAt,
    verifiedRepairCount: verified,
    revertedRepairCount: reverted,
    prUrl,
    agentSteps,
  });
  if (job.telegramChatId) {
    try {
      const telegramMessageId = await retryTransient(() => telegramSend(job, finalMessage), { attempts: 3, baseDelayMs: 1_000 });
      const pdfMessageId = await retryTransient(() => telegramSendDocument(job, pdfPath), { attempts: 3, baseDelayMs: 1_000 });
      await control('/api/worker/delivery', { jobId: job.jobId, leaseId: job.leaseId, status: 'delivered', telegramMessageId, pdfMessageId });
    } catch (error) {
      const deliveryError = error instanceof Error ? error.message : 'Telegram delivery failed';
      await control('/api/worker/delivery', { jobId: job.jobId, leaseId: job.leaseId, status: 'failed', error: deliveryError.slice(0, 500) }).catch(() => undefined);
      console.error(`${job.publicId}: terminal delivery failed — ${deliveryError}`);
    }
  }
  console.log(`${job.publicId}: ${isHermesRunSuccessful(hermesResult.status) ? 'completed' : hermesResult.status} (${Date.now() - startedAt}ms)`);
  } finally {
    if (activeHermesRunId) await hermes.stopRun(activeHermesRunId).catch(() => undefined);
    clearInterval(heartbeat);
  }
}

async function main() {
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
      await execute(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown worker failure';
      const cancelled = /\b(?:cancelled|canceled)\b/i.test(message);
      let terminal = true;
      if (cancelled) {
        await control('/api/worker/abort', { jobId: job.jobId, leaseId: job.leaseId, reason: message.slice(0, 1_000) }).catch(() => undefined);
      } else {
        const failure = await control<{ terminal: boolean }>('/api/worker/fail', { jobId: job.jobId, leaseId: job.leaseId, error: message.slice(0, 1_000), retryable: isTransientFailure(error) }).catch((controlError) => {
          console.error(`${job.publicId}: unable to persist failure — ${controlError instanceof Error ? controlError.message : String(controlError)}`);
          return { terminal: true };
        });
        terminal = failure.terminal;
      }
      const detail = message.toLowerCase().includes('fetch') ? 'A required service was unavailable after bounded retries.' : message;
      await telegramUpdate(job, formatTelegramProgress({ publicId: job.publicId, repository: job.repository, stage: cancelled ? 'cancelled' : terminal ? 'blocked' : 'retrying', detail: detail.slice(0, 220), dashboardUrl: dashboardUrl(job) }));
      console.error(`${job.publicId}: ${cancelled ? 'cancelled' : terminal ? 'blocked' : 'retry queued'} — ${message}`);
    }
    if (process.argv.includes('--once')) return;
  }
}

await main();
