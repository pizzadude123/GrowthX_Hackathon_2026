export type WorkerConfiguration = {
  controlPlaneUrl: string;
  workerToken: string;
  hermesUrl:string;
  proxyToken: string;
};

const terminalStatuses = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'stopped']);
const successfulStatuses = new Set(['completed', 'succeeded']);

export function attemptArtifactPaths(root: string, publicId: string, leaseId: string) {
  if (!/^[A-Z0-9-]+$/.test(publicId) || !/^[A-Za-z0-9-]+$/.test(leaseId)) throw new Error('Artifact identity contains unsafe characters');
  const normalizedRoot = root.replace(/\/+$/, '');
  const runDir = `${normalizedRoot}/${publicId}`;
  return { runDir, attemptDir: `${runDir}/attempts/${leaseId}` };
}

export function hermesTelegramTarget(chatId: string, threadId?: string) {
  if (!/^-?\d+$/.test(chatId)) throw new Error('Telegram delivery requires a numeric chat ID');
  const topic = Number(threadId);
  return Number.isInteger(topic) && topic > 1 ? `telegram:${chatId}:${topic}` : `telegram:${chatId}`;
}

export function canonicalResultSourceLabel(source?: string) {
  if (!source) return 'unknown source';
  return source.endsWith('/verified-result.json') || source === 'verified-result.json'
    ? 'verified-result.json'
    : source;
}

export function isHermesRunTerminal(status: string): boolean {
  return terminalStatuses.has(status.toLowerCase());
}

export function isHermesRunSuccessful(status: string): boolean {
  return successfulStatuses.has(status.toLowerCase());
}

export function assertWorkerConfiguration(config: WorkerConfiguration): WorkerConfiguration {
  const controlPlaneUrl = config.controlPlaneUrl.replace(/\/$/, '');
  if (!/^https:\/\//.test(controlPlaneUrl)) throw new Error('WHITEBOX_CONTROL_PLANE_URL must use HTTPS');
  if (config.workerToken.length < 32) throw new Error('WHITEBOX_WORKER_TOKEN must contain at least 32 characters');
  if (config.hermesUrl.replace(/\/$/,'')!=='http://127.0.0.1:8743')throw new Error('HERMES_SERVER_URL must use the dedicated loopback receipt proxy');
  if(config.proxyToken.length<32||config.proxyToken===config.workerToken)throw new Error('WHITEBOX_HERMES_PROXY_TOKEN must be strong and distinct from the worker token');
  return { ...config, controlPlaneUrl,hermesUrl:'http://127.0.0.1:8743' };
}

export function isTransientFailure(error: unknown): boolean {
  const name = error instanceof Error ? error.name.toLowerCase() : '';
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  return name === 'timeouterror'
    || error instanceof TypeError && message.includes('fetch')
    || /\b(?:408|425|429|500|502|503|504)\b/.test(message)
    || message.includes('econnreset')
    || message.includes('enotfound')
    || message.includes('connect timeout')
    || /network\s*error|all connection attempts failed|timed out/.test(message);
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; sleep?: (delayMs: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientFailure(error) || attempt === attempts) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export function assertJobMayContinue(state: { status: string; paused: boolean }): { paused: boolean } {
  if (['cancelled', 'canceled', 'failed', 'blocked'].includes(state.status.toLowerCase())) {
    throw new Error(`Whitebox run was ${state.status.toLowerCase()}`);
  }
  return { paused: state.paused };
}
