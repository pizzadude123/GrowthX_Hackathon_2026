export type TelegramProgressStage = 'mapping' | 'auditing' | 'validating' | 'retrying' | 'completed' | 'blocked' | 'cancelled';

export type TelegramProgressInput = {
  publicId: string;
  repository: string;
  dashboardUrl?: string | undefined;
  stage: TelegramProgressStage;
  mappedFiles?: number;
  flowCount?: number;
  findings?: number;
  elapsedMs?: number;
  detail?: string | undefined;

};

const stageCopy: Record<TelegramProgressStage, { icon: string; title: string; next: string }> = {
  mapping: { icon: '🗺️', title: 'Repository loaded', next: 'Building the logistics schema and capability profile.' },
  auditing: { icon: '🔎', title: 'System mapped', next: 'Hermes specialists are auditing flows, dependencies, and evidence.' },
  validating: { icon: '🧪', title: 'Independent validation', next: 'Checking proposed findings against exact repository evidence.' },
  retrying: { icon: '🔄', title: 'Temporary failure; retry queued', next: 'Whitebox will resume automatically with the same run ID.' },
  completed: { icon: '✅', title: 'Run completed', next: 'The complete evidence result is delivered in Telegram.' },
  blocked: { icon: '⚠️', title: 'Run could not complete', next: 'No audit result was accepted.' },
  cancelled: { icon: '⏹️', title: 'Run cancelled', next: 'The read-only audit stopped without an accepted result.' },
};

export function formatTelegramProgress(input: TelegramProgressInput): string {
  const copy = stageCopy[input.stage];
  const metrics = [
    input.mappedFiles === undefined ? undefined : `${input.mappedFiles} files`,
    input.flowCount === undefined ? undefined : `${input.flowCount} flows`,
    input.findings === undefined ? undefined : `${input.findings} findings`,

  ].filter(Boolean).join(' · ');
  const seconds = input.elapsedMs === undefined ? undefined : `${Math.round(input.elapsedMs / 1000)}s elapsed`;
  const message = `${copy.icon} ${input.publicId} · ${copy.title}\n\nRepo: ${input.repository}${metrics ? `\n${metrics}` : ''}${seconds ? `\n${seconds}` : ''}${input.detail ? `\n\nCause: ${input.detail}` : ''}\n\n${copy.next}${input.dashboardUrl ? `\nDashboard: ${input.dashboardUrl}` : ''}`;
  if (message.length > 700) throw new Error('Telegram progress message exceeds 700 characters');
  return message;
}

export type TelegramAgentUpdateInput = {
  publicId: string; repository: string; dashboardUrl?: string | undefined; elapsedMs: number;
  commitSha: string; languages: string[]; mappedFiles: number; flowCount: number;
  confirmedFindings: number; rejectedFindings: number; dependencies: number;
  agents: Array<{ role: string; objective: string; status: 'running' | 'completed'; dynamicallySpawned: boolean }>;
};

export function formatTelegramAgentUpdate(input: TelegramAgentUpdateInput): string {
  const agents = input.agents.length ? input.agents.map((agent) => {
    const state = agent.status === 'completed' ? '✅' : '⏳';
    const spawned = agent.dynamicallySpawned ? ' · dynamically spawned' : '';
    const objective = agent.objective.length > 90 ? `${agent.objective.slice(0, 87)}…` : agent.objective;
    return `${state} ${agent.role}${spawned}\n   ${objective}`;
  }).join('\n') : '⏳ Whitebox Manager\n   Building the specialist plan and evidence boundaries.';
  const footer = input.dashboardUrl ? `\n\nDashboard: ${input.dashboardUrl}` : '';
  const message = `🤝 ${input.publicId} · Agent activity\n\n${agents}\n\nEvidence\n${input.mappedFiles} files · ${input.flowCount} flows · ${input.confirmedFindings} confirmed · ${input.rejectedFindings} rejected\n${input.dependencies} dependencies · ${Math.round(input.elapsedMs / 1000)}s elapsed\nCommit: ${input.commitSha.slice(0, 12)}\nLanguages: ${input.languages.join(', ') || 'content-only'}${footer}`;
  if (message.length > 1200) return `${message.slice(0, 1197)}…`;
  return message;
}

export type TelegramFinalResultInput = {
  publicId: string; repository: string; mode: 'audit_only'; commitSha: string; elapsedMs: number;
  mappedFiles: number; languages: string[]; flows: string[]; rejectedFindings: number;
  findings: Array<{ severity: string; title: string; evidence: string }>;
  dependencies: Array<{ packageName: string; classification: string }>;
  agents: Array<{ role: string; status: string }>; dashboardUrl?: string | undefined; resultState?: 'verified' | 'partial';
};

export function formatTelegramFinalResult(input: TelegramFinalResultInput): string {
  const verifiedResult = input.resultState !== 'partial';
  const findings = input.findings.length
    ? input.findings.slice(0, 6).map((row) => `• ${row.severity.toUpperCase()} · ${row.title}\n  Evidence: ${row.evidence}`).join('\n')
    : '• No confirmed evidence-backed findings.';
  const agents = input.agents.length
    ? input.agents.map((row) => `${row.status === 'completed' ? '✅' : '⚠️'} ${row.role}`).join('\n')
    : '• No delegated specialist sessions were recorded.';
  const dependencies = input.dependencies.length
    ? input.dependencies.slice(0, 8).map((row) => `• ${row.packageName} · ${row.classification}`).join('\n')
    : '• No dependency risks persisted.';
  const flows = input.flows.length ? input.flows.slice(0, 6).map((name) => `• ${name}`).join('\n') : '• No operational flow persisted.';
  const outcome = verifiedResult
    ? 'Read-only audit completed; no repository code was executed or changed.'
    : 'The repository was mapped, but independent structured verification was incomplete. Candidates remain human-review items and no active finding was accepted.';
  const message = `${verifiedResult ? '✅' : '⚠️'} ${input.publicId} · ${verifiedResult ? 'Verified result' : 'Partial result'}\n\nRepo: ${input.repository}\nCommit: ${input.commitSha}\nMode: ${input.mode.replace('_', ' ')}\nElapsed: ${Math.round(input.elapsedMs / 1000)}s\n\nSUMMARY\n${input.mappedFiles} files · ${input.languages.join(', ') || 'content-only'}\n${input.flows.length} flows · ${input.findings.length} confirmed · ${input.rejectedFindings} rejected\n\nAGENTS\n${agents}\n\nFLOWS\n${flows}\n\nFINDINGS\n${findings}\n\nDEPENDENCIES\n${dependencies}\n\nRESULT\n${outcome}${input.dashboardUrl ? `\nDashboard: ${input.dashboardUrl}` : ''}`;
  return message.length <= 3900 ? message : `${message.slice(0, 3897)}…`;
}
