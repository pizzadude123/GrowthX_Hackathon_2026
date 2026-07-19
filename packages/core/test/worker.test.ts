import { describe, expect, it } from 'vitest';
import { assertJobMayContinue, assertWorkerConfiguration, attemptArtifactPaths, canonicalResultSourceLabel, hermesTelegramTarget, isHermesRunSuccessful, isHermesRunTerminal, isTransientFailure, retryTransient } from '../src/worker.js';

describe('Hermes worker policy', () => {
  it('isolates producer artifacts by lease attempt while retaining one canonical run directory', () => {
    const first = attemptArtifactPaths('/artifacts', 'WB-ABC', 'lease-one');
    const second = attemptArtifactPaths('/artifacts', 'WB-ABC', 'lease-two');
    expect(first.runDir).toBe('/artifacts/WB-ABC');
    expect(first.attemptDir).toBe('/artifacts/WB-ABC/attempts/lease-one');
    expect(second.attemptDir).not.toBe(first.attemptDir);
  });

  it('builds a scoped Hermes Telegram target without treating the general topic as a thread', () => {
    expect(hermesTelegramTarget('-100123', '17')).toBe('telegram:-100123:17');
    expect(hermesTelegramTarget('-100123', '1')).toBe('telegram:-100123');
  });

  it('does not expose local artifact paths in canonical receipts', () => {
    expect(canonicalResultSourceLabel('/private/work/.whitebox-runs/WB-1/attempts/lease/verified-result.json')).toBe('verified-result.json');
    expect(canonicalResultSourceLabel('Hermes response fallback')).toBe('Hermes response fallback');
  });

  it('fails closed without strong worker credentials', () => {
    expect(() => assertWorkerConfiguration({ controlPlaneUrl: '', workerToken: '',hermesUrl:'',proxyToken:'' })).toThrow();
    expect(() => assertWorkerConfiguration({ controlPlaneUrl: 'https://example.convex.site', workerToken: 'short',hermesUrl:'http://127.0.0.1:8742',proxyToken:'key' })).toThrow();
  });

  it('accepts a complete production worker configuration', () => {
    expect(assertWorkerConfiguration({ controlPlaneUrl: 'https://example.convex.site/', workerToken: 'x'.repeat(32),hermesUrl:'http://127.0.0.1:8743',proxyToken:'p'.repeat(32) })).toEqual({
      controlPlaneUrl: 'https://example.convex.site',
      workerToken: 'x'.repeat(32),
      hermesUrl:'http://127.0.0.1:8743',proxyToken:'p'.repeat(32),
    });
  });

  it('distinguishes successful and failed terminal Hermes states', () => {
    expect(isHermesRunTerminal('completed')).toBe(true);
    expect(isHermesRunTerminal('failed')).toBe(true);
    expect(isHermesRunTerminal('running')).toBe(false);
    expect(isHermesRunSuccessful('completed')).toBe(true);
    expect(isHermesRunSuccessful('failed')).toBe(false);
  });

  it('retries transient network failures with a bounded attempt count', async () => {
    expect(isTransientFailure(new Error('Hermes send failed: NetworkError'))).toBe(true);
    let attempts = 0;
    const result = await retryTransient(async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return 'ok';
    }, { attempts: 3, baseDelayMs: 0, sleep: async () => undefined });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry permanent validation failures', async () => {
    let attempts = 0;
    await expect(retryTransient(async () => {
      attempts += 1;
      throw new Error('GitHub URL must include a valid owner and repository');
    }, { attempts: 3, baseDelayMs: 0, sleep: async () => undefined })).rejects.toThrow('valid owner');
    expect(attempts).toBe(1);
  });

  it('stops work when the control plane marks a run cancelled', () => {
    expect(() => assertJobMayContinue({ status: 'cancelled', paused: false })).toThrow('cancelled');
    expect(assertJobMayContinue({ status: 'auditing', paused: false })).toEqual({ paused: false });
    expect(assertJobMayContinue({ status: 'auditing', paused: true })).toEqual({ paused: true });
  });
});
