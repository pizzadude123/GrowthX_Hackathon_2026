import { describe, expect, it, vi } from 'vitest';
import { HermesRunsClient } from '../src/hermes-client.js';

describe('real Hermes runs adapter', () => {
  it('fails closed in production without a key', () => {
    expect(() => new HermesRunsClient({ baseUrl: 'http://localhost:8642', environment: 'production' })).toThrow(/HERMES_SERVER_KEY/);
  });

  it('submits a run to the documented endpoint without exposing the key', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ run_id: 'run_real', status: 'started' }), { status: 202 }));
    const client = new HermesRunsClient({ baseUrl: 'http://localhost:8642', key: 'server-secret-value', fetcher });
    const result = await client.createRun({ input: 'analyze', sessionId: 'WB-1', instructions: 'system' });
    expect(result.runId).toBe('run_real');
    expect(fetcher).toHaveBeenCalledWith('http://localhost:8642/v1/runs', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
    expect(JSON.stringify(result)).not.toContain('server-secret-value');
  });

  it('treats stop 404 as an idempotent terminal cleanup', async () => {
    const fetcher = vi.fn(async () => new Response('missing', { status: 404 }));
    const client = new HermesRunsClient({ baseUrl: 'http://localhost:8642', key: 'server-secret-value', fetcher });
    await expect(client.stopRun('already-finished')).resolves.toEqual({ alreadyStopped: true });
  });
});
