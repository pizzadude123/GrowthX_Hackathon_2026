import type { AnalysisResult, RepositoryFile, SourceEvidence } from './contracts.js';
import { enforceAnalysisIntegrity, validateSourceEvidence } from './evidence-integrity.js';
import { strictAnalysisResultSchema } from './analysis-schema.js';

function uniqueIds(label: string, values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) throw new Error(`Duplicate ${label} ID: ${value || '(empty)'}`);
    seen.add(value);
  }
  return seen;
}

function assertEvidence(records: SourceEvidence[], files: RepositoryFile[]) {
  for (const evidence of records) {
    const check = validateSourceEvidence(evidence, files);
    if (!check.valid) throw new Error(`Canonical evidence is invalid: ${check.reasons.join('; ')}`);
  }
}

export function assertCanonicalAnalysis(input: unknown, files: RepositoryFile[]): asserts input is AnalysisResult {
  const parsed = strictAnalysisResultSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Canonical analysis schema is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const analysis = parsed.data as AnalysisResult;
  for (const [name, value] of Object.entries({ nodes: analysis.nodes, edges: analysis.edges, flows: analysis.flows, principles: analysis.principles, findings: analysis.findings, dependencies: analysis.dependencies, editorDiagnostics: analysis.editorDiagnostics })) {
    if (!Array.isArray(value)) throw new Error(`Canonical analysis ${name} must be an array`);
  }
  if (!analysis.manifest?.files || !Array.isArray(analysis.manifest.files) || !analysis.snapshot?.id) throw new Error('Canonical analysis manifest or snapshot is missing');


  const sourcePaths = uniqueIds('source path', files.map((file) => file.path));
  const manifestPaths = uniqueIds('manifest path', analysis.manifest.files.map((file) => file.path));
  if (sourcePaths.size !== manifestPaths.size || [...sourcePaths].some((path) => !manifestPaths.has(path))) throw new Error('Canonical manifest does not cover the complete source packet');

  const nodeIds = uniqueIds('node', analysis.nodes.map((node) => node.id));
  const edgeIds = uniqueIds('edge', analysis.edges.map((edge) => edge.id));
  const flowIds = uniqueIds('flow', analysis.flows.map((flow) => flow.id));
  const principleIds = uniqueIds('principle', analysis.principles.map((principle) => principle.id));
  const findingIds = uniqueIds('finding', analysis.findings.map((finding) => finding.id));
  void edgeIds;

  for (const edge of analysis.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new Error(`Canonical edge endpoint does not resolve: ${edge.id}`);
    assertEvidence(edge.evidence, files);
  }
  for (const flow of analysis.flows) {
    if (flow.orderedNodeIds.some((id) => !nodeIds.has(id))) throw new Error(`Canonical flow node does not resolve: ${flow.id}`);
    for (const transition of flow.stateTransitions) assertEvidence(transition.evidence, files);
    for (const invariant of flow.invariants) {
      if (invariant.scopeNodeIds.some((id) => !nodeIds.has(id))) throw new Error(`Canonical invariant node does not resolve: ${invariant.id}`);
      assertEvidence(invariant.evidence, files);
    }
  }
  for (const principle of analysis.principles) {
    if (principle.scopeNodeIds.some((id) => !nodeIds.has(id)) || principle.scopeFlowIds.some((id) => !flowIds.has(id))) throw new Error(`Canonical principle scope does not resolve: ${principle.id}`);
    assertEvidence(principle.evidence, files);
  }
  for (const preference of analysis.preferences.filter((preference) => preference.active)) assertEvidence(preference.evidence, files);
  for (const finding of analysis.findings.filter((finding) => finding.status !== 'rejected')) assertEvidence(finding.evidence, files);

  const integrity = enforceAnalysisIntegrity(analysis, files);
  if (integrity.rejectedFindingIds.length) throw new Error(`Canonical active finding evidence failed: ${integrity.rejectedFindingIds.join(', ')}`);
  const activeFindingIds = new Set(analysis.findings.filter((finding) => finding.status !== 'rejected').map((finding) => finding.id));
  for (const diagnostic of analysis.editorDiagnostics) {
    if (!findingIds.has(diagnostic.findingId) || !activeFindingIds.has(diagnostic.findingId)) throw new Error(`Canonical diagnostic finding does not resolve: ${diagnostic.findingId}`);
    assertEvidence([{ path: diagnostic.path, startLine: diagnostic.startLine, endLine: diagnostic.endLine, excerpt: files.find((file) => file.path === diagnostic.path)?.content.replace(/\r\n/g, '\n').split('\n').slice(diagnostic.startLine - 1, diagnostic.endLine).join('\n') ?? '', explanation: 'Editor diagnostic source range' }], files);
  }
  if (analysis.snapshot.nodeIds.some((id) => !nodeIds.has(id)) || analysis.snapshot.edgeIds.some((id) => !edgeIds.has(id)) || analysis.snapshot.flowIds.some((id) => !flowIds.has(id)) || analysis.snapshot.principleIds.some((id) => !principleIds.has(id))) throw new Error('Canonical snapshot references unresolved topology');
  const expectedReferences = {
    nodeIds: analysis.nodes.map((node) => node.id), edgeIds: analysis.edges.map((edge) => edge.id),
    flowIds: analysis.flows.map((flow) => flow.id), principleIds: analysis.principles.map((principle) => principle.id),
    preferenceIds: analysis.preferences.map((preference) => preference.id),
  };
  for (const [key, expected] of Object.entries(expectedReferences)) {
    if (canonicalStringify(analysis.snapshot[key as keyof typeof expectedReferences]) !== canonicalStringify(expected)) throw new Error(`Canonical snapshot ${key} does not exactly match analysis records`);
  }
}

const LANGUAGE_BY_EXTENSION: Record<string,string> = { ts:'TypeScript',tsx:'TypeScript',js:'JavaScript',jsx:'JavaScript',py:'Python',go:'Go',rs:'Rust',java:'Java',kt:'Kotlin',cs:'C#',rb:'Ruby',php:'PHP',swift:'Swift',c:'C',h:'C/C++',cpp:'C++',cc:'C++',json:'JSON',yaml:'YAML',yml:'YAML',toml:'TOML',md:'Markdown' };
const MANIFEST_ECOSYSTEMS: Record<string,string> = { 'package.json':'npm','pyproject.toml':'Python','requirements.txt':'Python','go.mod':'Go modules','Cargo.toml':'Cargo','pom.xml':'Maven','build.gradle':'Gradle','composer.json':'Composer','Gemfile':'Bundler','Package.swift':'SwiftPM','CMakeLists.txt':'CMake' };
function sourceLanguage(path: string) { return LANGUAGE_BY_EXTENSION[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'Text'; }
function isManifest(path: string, name: string) { return path === name || path.endsWith(`/${name}`); }

export async function assertCanonicalSourceMetadata(input: AnalysisResult, files: RepositoryFile[]) {
  const expectedFiles = await Promise.all(files.map(async (file) => ({ path:file.path, bytes:new TextEncoder().encode(file.content).byteLength, language:sourceLanguage(file.path), fingerprint:await sha256Text(file.content) })));
  const counts = new Map<string,number>();
  for (const file of expectedFiles) counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  const languages = [...counts].map(([language,count]) => ({ language, files:count, percentage:Math.round(count / Math.max(1, expectedFiles.length) * 1000) / 10 })).sort((left,right) => right.files - left.files);
  const manifests = expectedFiles.map((file) => file.path).filter((path) => Object.keys(MANIFEST_ECOSYSTEMS).some((name) => isManifest(path,name)));
  const ecosystems = [...new Set(manifests.map((path) => Object.entries(MANIFEST_ECOSYSTEMS).find(([name]) => isManifest(path,name))?.[1]).filter((value): value is string => Boolean(value)))];
  const validationCommands: string[] = [];
  const unsupportedRegions: string[] = [];
  const packageFile = files.find((file) => isManifest(file.path,'package.json'));
  if (packageFile) {
    try {
      const parsed = JSON.parse(packageFile.content) as { scripts?:Record<string,string> };
      if (parsed.scripts?.typecheck) validationCommands.push('npm run typecheck');
      if (parsed.scripts?.lint) validationCommands.push('npm run lint');
      if (parsed.scripts?.test) validationCommands.push('npm test');
    } catch { unsupportedRegions.push(`${packageFile.path}: invalid JSON`); }
  }
  if (manifests.some((path) => path.endsWith('pyproject.toml') || path.endsWith('requirements.txt'))) validationCommands.push('python -m pytest');
  if (manifests.some((path) => path.endsWith('go.mod'))) validationCommands.push('go test ./...');
  if (manifests.some((path) => path.endsWith('Cargo.toml'))) validationCommands.push('cargo test');
  const expectedManifest = { files:expectedFiles, languages, ecosystems, manifests, validationCommands, unsupportedRegions, capability:{ baseline:true as const, deepSemantic:languages.some((item) => ['TypeScript','JavaScript','Python'].includes(item.language)) } };
  if (canonicalStringify(input.manifest) !== canonicalStringify(expectedManifest)) throw new Error('Canonical manifest metadata does not match the bound source bytes');
  const fileFingerprints = Object.fromEntries(expectedFiles.map((file) => [file.path,file.fingerprint]));
  if (canonicalStringify(input.snapshot.fileFingerprints) !== canonicalStringify(fileFingerprints)) throw new Error('Canonical snapshot fingerprints do not match the bound source bytes');
  const dependencyRecordIds = await Promise.all(input.dependencies.map(async (dependency) => `dependency-${(await sha256Text(dependency.packageName)).slice(0,12)}`));
  if (canonicalStringify(input.snapshot.dependencyRecordIds) !== canonicalStringify(dependencyRecordIds)) throw new Error('Canonical snapshot dependency references do not match dependency records');
  const snapshotId = `schema-${(await sha256Text(`${input.snapshot.repositoryKey}:${input.snapshot.sourceCommitSha??'unbound'}:${input.snapshot.version - 1}:${JSON.stringify(fileFingerprints)}`)).slice(0,12)}`;
  if (input.snapshot.id !== snapshotId) throw new Error('Canonical snapshot identity does not match source fingerprints and version');
  const expectedSummary = `${expectedManifest.capability.deepSemantic ? 'Deep-semantic signals available' : 'Baseline analysis'}; ${input.findings.filter((finding) => finding.status === 'confirmed').length} confirmed findings.`;
  if (input.snapshot.confidenceSummary !== expectedSummary) throw new Error('Canonical snapshot summary does not match accepted findings');
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item === undefined ? null : item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(object[key])}`).join(',')}}`;
}

async function digestHex(algorithm: 'SHA-1' | 'SHA-256', bytes: Uint8Array) {
  const digest = await crypto.subtle.digest(algorithm, Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalDigest(value: unknown) {
  return sha256Text(canonicalStringify(value));
}

export function sha256Text(value: string) {
  return digestHex('SHA-256', new TextEncoder().encode(value));
}

export function gitBlobSha(content: string) {
  const encoder = new TextEncoder();
  const body = encoder.encode(content);
  const header = encoder.encode(`blob ${body.byteLength}\0`);
  const bytes = new Uint8Array(header.byteLength + body.byteLength);
  bytes.set(header);
  bytes.set(body, header.byteLength);
  return digestHex('SHA-1', bytes);
}
