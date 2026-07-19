import { describe, expect, it } from 'vitest';
import { assertIndependentHermesRuns, parseHermesAgentTelemetry } from '../src/agent-telemetry.js';
import { formatTelegramAgentUpdate } from '../src/telegram-progress.js';

const log = [
  "2026-07-12 16:03:10,859 INFO [20260712_160310_fbd419] agent.turn_context: conversation turn: session=20260712_160310_fbd419 model=x platform=subagent history=0 msg='Act as Logic and Integration Auditor. Identify evidence-backed operational risks'",
  "2026-07-12 16:03:10,862 INFO [20260712_160310_f457ff] agent.turn_context: conversation turn: session=20260712_160310_f457ff model=x platform=subagent history=0 msg='Act as Dependency Curator. Determine dependency surface'",
  "2026-07-12 16:03:40,430 INFO [20260712_160310_f457ff] agent.conversation_loop: Turn ended: reason=text_response response_len=1255 session=20260712_160310_f457ff",
  "2026-07-12 16:04:06,068 INFO [20260712_160406_adfa93] agent.turn_context: conversation turn: session=20260712_160406_adfa93 model=x platform=subagent history=0 msg='Act as dynamically created Content-Only Repository Specialist. Evaluate missing implementation'",
].join('\n');

describe('Hermes agent telemetry', () => {
  it('extracts genuine roles, objectives, dynamic creation, and completion', () => {
    const agents = parseHermesAgentTelemetry(log);
    expect(agents).toHaveLength(3);
    expect(agents[0]).toMatchObject({ sessionId: '20260712_160310_fbd419', role: 'Logic and Integration Auditor', status: 'running' });
    expect(agents[1]).toMatchObject({ role: 'Dependency Curator', status: 'completed' });
    expect(agents[2]).toMatchObject({ role: 'Content-Only Repository Specialist', dynamicallySpawned: true });
  });

  it('formats useful per-agent Telegram updates', () => {
    const message = formatTelegramAgentUpdate({
      publicId: 'WB-TEST', repository: 'owner/repo', dashboardUrl: 'https://example.test/runs/WB-TEST',
      elapsedMs: 30_000, commitSha: 'abcdef1234567890', languages: ['TypeScript', 'CSS'], mappedFiles: 42,
      flowCount: 3, confirmedFindings: 2, rejectedFindings: 1, dependencies: 8,
      agents: parseHermesAgentTelemetry(log),
    });
    expect(message).toContain('Logic and Integration Auditor');
    expect(message).toContain('Dependency Curator');
    expect(message).toContain('42 files · 3 flows · 2 confirmed · 1 rejected');
    expect(message).toContain('Commit: abcdef123456');
    expect(message.length).toBeLessThanOrEqual(1200);
  });

  it('requires distinct successful auditor and verifier runs', () => {
    expect(assertIndependentHermesRuns({ runId: 'audit-1', status: 'completed' }, { runId: 'verify-1', status: 'succeeded' })).toMatchObject({ auditorRunId: 'audit-1', verifierRunId: 'verify-1' });
    expect(() => assertIndependentHermesRuns({ runId: 'same', status: 'completed' }, { runId: 'same', status: 'completed' })).toThrow('distinct');
    expect(() => assertIndependentHermesRuns({ runId: 'audit-1', status: 'failed' }, { runId: 'verify-1', status: 'completed' })).toThrow('successful');
  });
});
