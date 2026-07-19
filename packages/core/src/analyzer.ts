import { createHash } from 'node:crypto';
import { findingSchema, type AnalysisResult, type CodebasePrinciple, type DependencyHealth, type EditorDiagnostic, type LogisticsEdge, type LogisticsNode, type RepositoryFile, type RepositoryManifest, type SourceEvidence, type SystemFlow, type WhiteboxFinding } from './contracts.js';
import { sanitizeRelativePath } from './security.js';

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift', c: 'C', h: 'C/C++', cpp: 'C++', cc: 'C++', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', md: 'Markdown'
};
const MANIFESTS: Record<string, string> = { 'package.json': 'npm', 'pyproject.toml': 'Python', 'requirements.txt': 'Python', 'go.mod': 'Go modules', 'Cargo.toml': 'Cargo', 'pom.xml': 'Maven', 'build.gradle': 'Gradle', 'composer.json': 'Composer', 'Gemfile': 'Bundler', 'Package.swift': 'SwiftPM', 'CMakeLists.txt': 'CMake' };
const EXCLUDED = /(^|\/)(node_modules|vendor|dist|build|coverage|\.git)(\/|$)|\.min\.(js|css)$/;
const MAX_FILES = 60;
const MAX_BYTES = 750_000;

function hash(content: string) { return createHash('sha256').update(content).digest('hex'); }
function language(path: string) { const extension = path.split('.').pop()?.toLowerCase() ?? ''; return LANGUAGE_BY_EXTENSION[extension] ?? 'Text'; }
function numberedEvidence(file: RepositoryFile, lineIndex: number, explanation: string): SourceEvidence {
  const lines = file.content.split(/\r?\n/); const line = Math.max(0, Math.min(lineIndex, lines.length - 1));
  return { path: file.path, startLine: line + 1, endLine: line + 1, excerpt: (lines[line] ?? '').slice(0, 400), explanation };
}
function firstMatchingLine(file: RepositoryFile, pattern: RegExp) { return file.content.split(/\r?\n/).findIndex((line) => pattern.test(line)); }
function stableId(prefix: string, value: string) { return `${prefix}-${hash(value).slice(0, 12)}`; }

export async function buildManifest(inputFiles: RepositoryFile[]): Promise<RepositoryManifest> {
  const selected: RepositoryFile[] = []; let bytes = 0; const unsupportedRegions: string[] = [];
  for (const file of inputFiles) {
    sanitizeRelativePath(file.path);
    const size = Buffer.byteLength(file.content);
    if (EXCLUDED.test(file.path)) { unsupportedRegions.push(`${file.path}: generated or vendored`); continue; }
    if (selected.length >= MAX_FILES || bytes + size > MAX_BYTES) { unsupportedRegions.push(`${file.path}: analysis limit`); continue; }
    if (file.content.includes('\0')) { unsupportedRegions.push(`${file.path}: binary`); continue; }
    selected.push(file); bytes += size;
  }
  const manifestFiles = selected.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content), language: language(file.path), fingerprint: hash(file.content) }));
  const counts = new Map<string, number>(); for (const file of manifestFiles) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  const languages = [...counts].map(([name, count]) => ({ language: name, files: count, percentage: Math.round(count / Math.max(1, manifestFiles.length) * 1000) / 10 })).sort((a, b) => b.files - a.files);
  const manifests = manifestFiles.map((file) => file.path).filter((path) => Object.keys(MANIFESTS).some((name) => path === name || path.endsWith(`/${name}`)));
  const ecosystems = [...new Set(manifests.map((path) => Object.entries(MANIFESTS).find(([name]) => path === name || path.endsWith(`/${name}`))?.[1]).filter((value): value is string => Boolean(value)))];
  const validationCommands: string[] = [];
  const packageFile = selected.find((file) => file.path === 'package.json' || file.path.endsWith('/package.json'));
  if (packageFile) { try { const parsed = JSON.parse(packageFile.content) as { scripts?: Record<string, string> }; if (parsed.scripts?.typecheck) validationCommands.push('npm run typecheck'); if (parsed.scripts?.lint) validationCommands.push('npm run lint'); if (parsed.scripts?.test) validationCommands.push('npm test'); } catch { unsupportedRegions.push(`${packageFile.path}: invalid JSON`); } }
  if (manifests.some((path) => path.endsWith('pyproject.toml') || path.endsWith('requirements.txt'))) validationCommands.push('python -m pytest');
  if (manifests.some((path) => path.endsWith('go.mod'))) validationCommands.push('go test ./...');
  if (manifests.some((path) => path.endsWith('Cargo.toml'))) validationCommands.push('cargo test');
  return { files: manifestFiles, languages, ecosystems, manifests, validationCommands, unsupportedRegions, capability: { baseline: true, deepSemantic: languages.some((item) => ['TypeScript','JavaScript','Python'].includes(item.language)), verifiedRepair: validationCommands.length > 0 } };
}

function envOccurrences(files: RepositoryFile[]) {
  const patterns = [/process\.env\.([A-Z][A-Z0-9_]*)/g, /os\.environ\[['"]([A-Z][A-Z0-9_]*)['"]\]/g, /ENV\[['"]([A-Z][A-Z0-9_]*)['"]\]/g, /getenv\(['"]([A-Z][A-Z0-9_]*)['"]\)/g];
  const result: { name: string; file: RepositoryFile; line: number }[] = [];
  for (const file of files) for (const pattern of patterns) { pattern.lastIndex = 0; for (const match of file.content.matchAll(pattern)) { const before = file.content.slice(0, match.index); result.push({ name: match[1]!, file, line: before.split(/\r?\n/).length - 1 }); } }
  return result;
}
function envStem(name: string) { return name.replace(/PAYMENTS?/g, 'PAYMENT').replace(/SERVICES?/g, 'SERVICE'); }

export async function analyzeRepository(input: { repositoryKey: string; files: RepositoryFile[]; goal: string; runId?: string; dashboardUrl?: string; previousVersion?: number }): Promise<AnalysisResult> {
  const manifest = await buildManifest(input.files); const allowed = new Set(manifest.files.map((file) => file.path)); const files = input.files.filter((file) => allowed.has(file.path));
  const nodes: LogisticsNode[] = files.map((file) => ({ id: stableId('module', file.path), kind: file.path.match(/route|controller|handler/i) ? 'entry_point' : 'module', name: file.path, path: file.path, summary: `${language(file.path)} source module`, confidence: 1 }));
  const edges: LogisticsEdge[] = []; const envs = envOccurrences(files);
  for (const occurrence of envs) {
    const envId = stableId('env', occurrence.name); if (!nodes.some((node) => node.id === envId)) nodes.push({ id: envId, kind: 'environment_variable', name: occurrence.name, summary: 'Runtime configuration input', confidence: 1 });
    const moduleId = stableId('module', occurrence.file.path); edges.push({ id: stableId('edge', `${moduleId}:${envId}`), from: moduleId, to: envId, kind: 'configured_by', evidence: [numberedEvidence(occurrence.file, occurrence.line, `Reads ${occurrence.name}`)], confidence: 1 });
  }
  const runtimeFile = (path: string) => !/(^|\/)(?:README(?:\.[^/]*)?|CHANGELOG(?:\.[^/]*)?|LICENSE(?:\.[^/]*)?|package\.json|composer\.json|Cargo\.toml|pyproject\.toml|[^/]*lock[^/]*)$|\.(?:md|mdx|lock)$/i.test(path);
  const outboundPattern = /\bfetch\s*\(|\baxios\.(?:get|post|put|patch|delete|request)\s*\(|\brequests\.(?:get|post|put|patch|delete|request)\s*\(|\bhttps?\.(?:get|request)\s*\(/;
  const externalFiles = files.filter((file) => runtimeFile(file.path) && outboundPattern.test(file.content));
  const externalId = stableId('external', 'external-http');
  if (externalFiles.length) nodes.push({ id: externalId, kind: 'external_api', name: 'External HTTP APIs', summary: 'Outbound network side effects', confidence: .85 });
  for (const file of externalFiles) { const line = firstMatchingLine(file, outboundPattern); edges.push({ id: stableId('edge', `${file.path}:http`), from: stableId('module', file.path), to: externalId, kind: 'calls', evidence: [numberedEvidence(file, line, 'Outbound HTTP call')], confidence: .9 }); }
  const orderedNodeIds = [...new Set([...nodes.filter((node) => node.kind === 'entry_point').map((node) => node.id), ...externalFiles.map((file) => stableId('module', file.path)), ...envs.map((env) => stableId('module', env.file.path)), ...(externalFiles.length ? [externalId] : []), ...envs.map((env) => stableId('env', env.name))])];
  if (!orderedNodeIds.length && nodes[0]) orderedNodeIds.push(nodes[0].id);
  const flowId = stableId('flow', `${input.repositoryKey}:${input.goal}`); const firstEvidence = envs[0] ? numberedEvidence(envs[0].file, envs[0].line, 'Flow configuration evidence') : (files[0] ? numberedEvidence(files[0], 0, 'Flow source evidence') : undefined);
  const stateTransitions: SystemFlow['stateTransitions'] = [];
  const stateRegressions: { file: RepositoryFile; line: number; from: string; to: string }[] = [];
  for (const file of files) {
    const assignments = [...file.content.matchAll(/(?:\w+\.)?status\s*=\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map((match) => ({ state: match[1]!.toLowerCase(), line: file.content.slice(0, match.index).split(/\r?\n/).length - 1 }));
    let previous = 'unknown';
    for (const assignment of assignments) {
      stateTransitions.push({ entity: file.path, from: previous, to: assignment.state, evidence: [numberedEvidence(file, assignment.line, `State changes from ${previous} to ${assignment.state}`)], guarded: /\bif\b/.test(file.content.split(/\r?\n/)[assignment.line] ?? '') });
      if (previous === 'paid' && assignment.state === 'pending') stateRegressions.push({ file, line: assignment.line, from: previous, to: assignment.state });
      previous = assignment.state;
    }
  }
  const invariant = { id: stableId('invariant', 'consistent-runtime-config'), statement: 'Each integration uses one consistent runtime configuration contract.', scopeNodeIds: orderedNodeIds, evidence: firstEvidence ? [firstEvidence] : [], confidence: firstEvidence ? .85 : .4 };
  const flow: SystemFlow = { id: flowId, name: input.goal || 'Primary repository flow', trigger: nodes.find((node) => node.kind === 'entry_point')?.name ?? 'Repository entry point', orderedNodeIds, inputContract: envs.map((env) => env.name), outputContract: ['Observed repository result'], sideEffects: externalFiles.length ? ['Outbound HTTP request'] : [], stateTransitions, invariants: [invariant], failurePoints: externalFiles.length ? ['External HTTP failure boundary'] : [], externalDependencies: externalFiles.length ? ['External HTTP APIs'] : [], confidence: firstEvidence ? .8 : .5 };
  const principles: CodebasePrinciple[] = [{ id: invariant.id, statement: invariant.statement, scopeNodeIds: invariant.scopeNodeIds, scopeFlowIds: [flowId], provenance: ['configuration','code'], evidence: invariant.evidence, confidence: invariant.confidence, status: 'derived', approvedExceptionIds: [], lastValidatedAt: Date.now() }];
  const findings: WhiteboxFinding[] = [];
  for (const regression of stateRegressions) {
    findings.push(findingSchema.parse({ id: stableId('finding', `state:${regression.file.path}:${regression.line}`), title: 'Paid state regresses to pending', category: 'state_flow', severity: 'critical', confidence: .98, status: 'confirmed', impact: 'A completed payment can re-enter a pre-payment state and trigger duplicate or contradictory work.', logicChain: [regression.from, 'side effect boundary', regression.to], evidence: [numberedEvidence(regression.file, regression.line, 'The state assignment moves a paid entity back to pending')], affectedNodeIds: [stableId('module', regression.file.path)], affectedFlowIds: [flowId], violatedInvariantIds: [invariant.id], businessImpact: 'Orders may be retried or fulfilled inconsistently after payment.', recommendation: 'Guard the transition using the repository state model and add a focused regression test.', repairability: 'guarded_automatic' }));
  }
  const groups = new Map<string, typeof envs>(); for (const env of envs) { const stem = envStem(env.name); groups.set(stem, [...(groups.get(stem) ?? []), env]); }
  for (const [stem, occurrences] of groups) {
    const names = [...new Set(occurrences.map((item) => item.name))]; if (names.length < 2) continue;
    const evidence = occurrences.map((item) => numberedEvidence(item.file, item.line, `Uses ${item.name}`));
    findings.push(findingSchema.parse({ id: stableId('finding', `env:${stem}`), title: `Conflicting ${stem} configuration names`, category: 'configuration', severity: 'high', confidence: .97, status: 'confirmed', impact: 'The same integration can resolve different endpoints across components.', logicChain: names.map((name) => `Runtime configuration → ${name}`), evidence, affectedNodeIds: occurrences.map((item) => stableId('module', item.file.path)), affectedFlowIds: [flowId], violatedInvariantIds: [invariant.id], businessImpact: 'Requests may fail or target an unintended service.', recommendation: `Normalize on the established ${names[0]} contract.`, repairability: 'safe_automatic' }));
  }
  for (const file of externalFiles) {
    const hasTimeout = /AbortSignal\.timeout|timeout\s*:|Timeout\(|timeout=/.test(file.content); const line = firstMatchingLine(file, outboundPattern); const evidence = [numberedEvidence(file, line, hasTimeout ? 'HTTP call includes bounded timeout handling' : 'HTTP call has no local timeout evidence')];
    findings.push(findingSchema.parse({ id: stableId('finding', `timeout:${file.path}`), title: hasTimeout ? 'Timeout concern disproved by surrounding code' : 'Outbound call lacks bounded timeout evidence', category: 'reliability', severity: hasTimeout ? 'low' : 'medium', confidence: hasTimeout ? .99 : .88, status: hasTimeout ? 'rejected' : 'confirmed', impact: hasTimeout ? 'No active impact; the call is bounded.' : 'A stalled dependency can hold the business flow open indefinitely.', logicChain: [file.path,'External HTTP APIs'], evidence, affectedNodeIds: [stableId('module', file.path),externalId], affectedFlowIds: [flowId], violatedInvariantIds: hasTimeout ? [] : [invariant.id], businessImpact: hasTimeout ? 'None.' : 'Resource exhaustion and degraded checkout availability.', recommendation: hasTimeout ? 'No repair.' : 'Use the repository timeout convention and preserve the error model.', repairability: hasTimeout ? 'human_required' : 'guarded_automatic', ...(hasTimeout ? { rejectionReason: 'AbortSignal.timeout provides an explicit failure boundary.' } : {}) }));
  }
  const dependencies: DependencyHealth[] = [];
  for (const file of files.filter((candidate) => candidate.path.endsWith('package.json'))) { try { const parsed = JSON.parse(file.content) as { dependencies?: Record<string,string> }; for (const [packageName, configuredRange] of Object.entries(parsed.dependencies ?? {})) dependencies.push({ packageName, configuredRange, deprecated:false, classification:'aging', importingFiles:[file.path], affectedNodeIds:[stableId('module',file.path)], affectedFlowIds:[flowId], probableUpgradeComplexity:'medium', safeAction:'none', evidenceSummary:`Declared in ${file.path}; registry age requires live verification before stronger claims.` }); } catch { /* invalid JSON remains a manifest limitation */ } }
  const runId = input.runId ?? 'analysis'; const dashboardUrl = input.dashboardUrl ?? `/runs/${runId}`;
  const editorDiagnostics: EditorDiagnostic[] = findings.filter((finding) => finding.status !== 'rejected' && finding.confidence >= .8 && ['medium','high','critical'].includes(finding.severity)).flatMap((finding) => finding.evidence.slice(0,1).map((evidence) => ({ id:stableId('diagnostic',finding.id), runId, findingId:finding.id, path:evidence.path, startLine:evidence.startLine, endLine:evidence.endLine, severity:finding.severity === 'critical' || finding.severity === 'high' ? 'error' : 'warning', title:finding.title, flowLabel:flow.name, principleStatement:principles[0]!.statement, impact:finding.impact, repairStatus:'proposed' as const, dashboardUrl })));
  const fileFingerprints = Object.fromEntries(manifest.files.map((file) => [file.path,file.fingerprint]));
  const snapshot = { id:stableId('schema',`${input.repositoryKey}:${input.previousVersion ?? 0}:${JSON.stringify(fileFingerprints)}`), repositoryKey:input.repositoryKey, version:(input.previousVersion ?? 0)+1, createdAt:Date.now(), nodeIds:nodes.map((node) => node.id), edgeIds:edges.map((edge) => edge.id), flowIds:[flowId], principleIds:principles.map((principle) => principle.id), preferenceIds:[], dependencyRecordIds:dependencies.map((dependency) => stableId('dependency',dependency.packageName)), confidenceSummary:`${manifest.capability.deepSemantic ? 'Deep-semantic signals available' : 'Baseline analysis'}; ${findings.filter((finding) => finding.status === 'confirmed').length} confirmed findings.`, fileFingerprints };
  return { manifest,nodes,edges,flows:[flow],principles,preferences:[],findings,dependencies,repairs:[],validations:[],snapshot,editorDiagnostics };
}
