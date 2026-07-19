export type HermesAgentTelemetry = {
  sessionId: string;
  role: string;
  objective: string;
  status: 'running' | 'completed';
  dynamicallySpawned: boolean;
  startedAt: number;
  finishedAt?: number;
  latencyMs?: number;
};

function timestamp(value: string): number {
  return Date.parse(value.replace(' ', 'T').replace(',', '.') + '+05:30');
}

export function parseHermesAgentTelemetry(log: string): HermesAgentTelemetry[] {
  const agents = new Map<string, HermesAgentTelemetry>();
  for (const line of log.split('\n')) {
    const started = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}).*\[([^\]]+)\].*platform=subagent.*msg='Act as (.+?)'/);
    if (started) {
      const startedAtRaw = started[1]; const sessionId = started[2]; const message = started[3];
      if (!startedAtRaw || !sessionId || !message) continue;
      const raw = message.split("'")[0] ?? message;
      const firstSentence = (raw.split('. ')[0] ?? raw).replace(/\.$/, '');
      const dynamic = /dynamically created|repository-specific/i.test(firstSentence);
      const role = firstSentence
        .replace(/^(?:a )?dynamically created\s+/i, '')
        .replace(/^a repository-specific\s+/i, '')
        .replace(/\s+for Whitebox run.*$/i, '')
        .replace(/\s+for WB-[A-Z0-9-]+.*$/i, '')
        .replace(/\.+$/, '')
        .trim();
      agents.set(sessionId, {
        sessionId, role, objective: raw.split('. ').slice(1).join('. ').trim() || firstSentence,
        status: 'running', dynamicallySpawned: dynamic, startedAt: timestamp(startedAtRaw),
      });
    }
    const ended = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}).*Turn ended:.*session=([^\s]+)/);
    const endedAtRaw = ended?.[1]; const endedSessionId = ended?.[2];
    if (endedAtRaw && endedSessionId && agents.has(endedSessionId)) {
      const agent = agents.get(endedSessionId)!;
      agent.status = 'completed'; agent.finishedAt = timestamp(endedAtRaw); agent.latencyMs = agent.finishedAt - agent.startedAt;
    }
  }
  return Array.from(agents.values()).sort((a, b) => a.startedAt - b.startedAt);
}

export function toAgentSteps(agents: HermesAgentTelemetry[]) {
  return agents.map((agent) => ({
    stepId: agent.sessionId, role: agent.role, dynamicallySpawned: agent.dynamicallySpawned,
    objective: agent.objective, status: agent.status, startedAt: agent.startedAt,
    ...(agent.finishedAt === undefined ? {} : { finishedAt: agent.finishedAt }),
    ...(agent.latencyMs === undefined ? {} : { latencyMs: agent.latencyMs }),
    inputSummary: agent.objective, ...(agent.status === 'completed' ? { outputSummary: 'Hermes specialist returned its structured handoff.' } : {}),
    tools: ['Hermes delegated session'], revisions: [],
  }));
}
