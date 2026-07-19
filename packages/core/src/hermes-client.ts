import { z } from 'zod';

type Fetcher = typeof fetch;
export type ProducerCreationEnvelope={authority:Record<string,unknown>;signature:string};
export class HermesRunCreationError extends Error {readonly retryable=false;constructor(message:string){super(message);this.name='HermesRunCreationError';}}
const runStartSchema = z.object({ run_id: z.string().min(1), status: z.string() });
const receiptSchema = z.object({
  version:z.literal('whitebox-hermes-receipt-v1'), runId:z.string(), sessionId:z.string(), status:z.string(),
  attemptId:z.string().min(8),role:z.enum(['auditor','verifier']),repositoryKey:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),sourceCommitSha:z.string().regex(/^[a-f0-9]{40}$/i),snapshotDigest:z.string().regex(/^[a-f0-9]{64}$/i),coverageDigest:z.string().regex(/^[a-f0-9]{64}$/i),releaseSourceDigest:z.string().regex(/^[a-f0-9]{64}$/i),promptDigest:z.string().regex(/^[a-f0-9]{64}$/i),inputDigest:z.string().regex(/^[a-f0-9]{64}$/i),outputDigest:z.string().regex(/^[a-f0-9]{64}$/i), structuredResultDigest:z.string().regex(/^[a-f0-9]{64}$/i),
  toolCallCount:z.number().int().nonnegative(), effectiveToolCount:z.number().int().nonnegative(), runtimeProofDigest:z.string().regex(/^[a-f0-9]{64}$/i),runtimeIdentityDigest:z.string().regex(/^[a-f0-9]{64}$/i),runtimeProcessPid:z.number().int().positive(),runtimeBootNonce:z.string().regex(/^[a-f0-9]{64}$/i),upstreamOrigin:z.literal('http://127.0.0.1:8742'),issuedAt:z.number(),
}).strict();
const runStatusSchema = z.object({
  run_id: z.string(), status: z.string(), session_id: z.string().optional(), output: z.string().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
  whitebox_receipt:receiptSchema.optional(), whitebox_signature:z.string().regex(/^[a-f0-9]{64}$/i).optional(),
});


export class HermesRunsClient {
  private readonly baseUrl: string;
  private readonly key: string | undefined;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(config: { baseUrl: string; key?: string; environment?: string; fetcher?: Fetcher; timeoutMs?: number }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.key = config.key;
    this.fetcher = config.fetcher ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    if ((config.environment ?? process.env.NODE_ENV) === 'production' && !this.key) throw new Error('HERMES_SERVER_KEY is required in production');
  }

  private headers() {
    if (!this.key) throw new Error('HERMES_SERVER_KEY is required to call Hermes');
    return { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' };
  }

  private request(path: string, init: RequestInit = {}) {
    return this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(this.timeoutMs),
    });
  }

  async createRun(input: { input: string; sessionId: string; instructions: string; creationAuthority:ProducerCreationEnvelope }) {
    try{const response = await this.request('/v1/runs', { method: 'POST', body: JSON.stringify({ input: input.input, session_id: input.sessionId, instructions: input.instructions,whitebox_creation_authority:input.creationAuthority }) });
    if (!response.ok) throw new HermesRunCreationError(`Hermes run submission failed (${response.status})`);
    const data = runStartSchema.parse(await response.json());
    return { runId: data.run_id, status: data.status };}catch(error){if(error instanceof HermesRunCreationError)throw error;throw new HermesRunCreationError('Hermes run submission outcome is ambiguous; producer retry is suppressed');}
  }

  async getRun(runId: string) {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}`);
    if (!response.ok) throw new Error(`Hermes run lookup failed (${response.status})`);
    const data = runStatusSchema.parse(await response.json());
    return { runId: data.run_id, status: data.status, sessionId: data.session_id, output: data.output, usage: data.usage, receipt:data.whitebox_receipt, receiptSignature:data.whitebox_signature };
  }


  async resolveApproval(runId: string, choice: 'once' | 'session' | 'always' | 'deny' = 'deny') {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, { method: 'POST', body: JSON.stringify({ choice, all: true }) });
    if (!response.ok) throw new Error(`Hermes approval resolution failed (${response.status})`);
    return response.json();
  }

  async stopRun(runId: string) {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
    if (response.status === 404) return { alreadyStopped: true };
    if (!response.ok) throw new Error(`Hermes stop failed (${response.status})`);
    return response.json();
  }
}
