import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = ['WHITEBOX_CONTROL_PLANE_URL', 'WHITEBOX_COMMAND_TOKEN', 'WHITEBOX_WORKER_TOKEN', 'PUBLIC_APP_URL'];
const missing = required.filter((name) => !process.env[name]);
const prompt = await readFile('hermes/WHITEBOX_POC_SYSTEM_PROMPT.md', 'utf8');
const worker = await readFile('scripts/whitebox-worker.ts', 'utf8');
const resultContract = await readFile('packages/core/src/hermes-result.ts', 'utf8');

async function reachable(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function installedPluginMatches() {
  const home = process.env.HERMES_HOME;
  if (!home) return true;
  const installed = resolve(home, 'plugins/whitebox-agency/__init__.py');
  try {
    await access(installed);
    return await readFile(installed, 'utf8') === await readFile('hermes/plugins/whitebox-agency/__init__.py', 'utf8');
  } catch {
    return false;
  }
}

const repairEnabled = process.env.WHITEBOX_ENABLE_GUARDED_REPAIR === 'true';
const checks = {
  promptVersion: prompt.includes('Whitebox POC Audit Manager') && prompt.includes('whitebox-verified-result-v1'),
  immutableCommitContract: prompt.includes('40-character commit SHA') && resultContract.includes('Hermes result commit'),
  failClosedFallback: worker.includes('demoteUnverifiedAnalysis') && worker.includes("resultStatus: structuredResultAccepted"),
  noMockHermes: !prompt.includes('MockHermes'),
  requiredEnvironment: missing.length === 0,
  scopedCredentials: Boolean(process.env.WHITEBOX_COMMAND_TOKEN && process.env.WHITEBOX_WORKER_TOKEN && process.env.WHITEBOX_COMMAND_TOKEN !== process.env.WHITEBOX_WORKER_TOKEN),
  repairModeSafe: !repairEnabled || Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPAIR_ALLOWLIST),
  hermesGatewayHealthy: await reachable(process.env.HERMES_RUNS_URL ?? 'http://127.0.0.1:8742/health'),
  publicAppHealthy: process.env.PUBLIC_APP_URL ? await reachable(`${process.env.PUBLIC_APP_URL.replace(/\/$/, '')}/dashboard`) : false,
  installedPluginParity: await installedPluginMatches(),
};

console.log(JSON.stringify({ checks, missing }, null, 2));
if (process.argv.includes('--strict') && !Object.values(checks).every(Boolean)) process.exit(1);