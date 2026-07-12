import type { AnalysisResult, RepairRecord, RepositoryFile, ValidationRecord, WhiteboxFinding } from './contracts.js';
import { analyzeRepository } from './analyzer.js';
import { assertRepairBounds } from './security.js';

export type RepairCandidate = RepairRecord & { replacements: { path: string; before: string; after: string }[] };
function changedLines(before: string, after: string) {
  const a = before.split(/\r?\n/); const b = after.split(/\r?\n/); const length = Math.max(a.length, b.length); let count = 0;
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) count += 1;
  return count;
}
export function proposeRepairs(files: RepositoryFile[], findings: WhiteboxFinding[]): RepairCandidate[] {
  const candidates: RepairCandidate[] = [];
  for (const finding of findings.filter((item) => item.status === 'confirmed' && item.repairability !== 'human_required')) {
    if (finding.category === 'configuration') {
      const names = [...new Set(finding.evidence.flatMap((evidence) => evidence.excerpt.match(/[A-Z][A-Z0-9_]{2,}/g) ?? []))].sort((a, b) => a.length - b.length);
      const canonical = names[0]; if (!canonical || names.length < 2) continue;
      const replacements = files.flatMap((file) => {
        let content = file.content; for (const name of names.slice(1)) content = content.replaceAll(name, canonical);
        return content === file.content ? [] : [{ path: file.path, before: file.content, after: content }];
      });
      const count = replacements.reduce((total, replacement) => total + changedLines(replacement.before, replacement.after), 0);
      assertRepairBounds(replacements.map((item) => item.path), count);
      candidates.push({ id: `repair-${finding.id}`, findingId: finding.id, title: `Normalize configuration on ${canonical}`, status: 'proposed', intendedInvariant: finding.violatedInvariantIds[0] ?? 'consistent configuration', affectedFlowIds: finding.affectedFlowIds, predictedBlastRadius: `${replacements.length} configuration consumers`, changedFiles: replacements.map((item) => item.path), changedLineCount: count, patch: replacements.map((item) => `${item.path}: ${names.slice(1).join(', ')} → ${canonical}`).join('\n'), validationPlan: ['parse','focused_tests','invariant','graph_diff'], rollbackCondition: 'Any validation failure or surviving configuration mismatch', replacements });
    }
    if (finding.category === 'reliability') {
      const evidence = finding.evidence[0]; if (!evidence) continue; const source = files.find((file) => file.path === evidence.path); if (!source) continue;
      const after = source.content.replace(/fetch\(([^,()]+)\)/, 'fetch($1, { signal: AbortSignal.timeout(5000) })');
      if (after === source.content) continue;
      const replacements = [{ path: source.path, before: source.content, after }]; const count = changedLines(source.content, after); assertRepairBounds([source.path], count);
      candidates.push({ id: `repair-${finding.id}`, findingId: finding.id, title: 'Bound external call with repository-safe timeout', status: 'proposed', intendedInvariant: finding.violatedInvariantIds[0] ?? 'bounded external calls', affectedFlowIds: finding.affectedFlowIds, predictedBlastRadius: 'One outbound HTTP call and its caller', changedFiles: [source.path], changedLineCount: count, patch: `${source.path}: add AbortSignal.timeout(5000)`, validationPlan: ['parse','focused_tests','invariant','graph_diff'], rollbackCondition: 'Parse failure, test failure, or timeout finding remains', replacements });
    }
  }
  return candidates;
}
export async function validateRepairs(repositoryKey: string, files: RepositoryFile[], candidates: RepairCandidate[]): Promise<{ repairs: RepairRecord[]; validations: ValidationRecord[]; after: AnalysisResult; files: RepositoryFile[] }> {
  let working = files.map((file) => ({ ...file })); const repairs: RepairRecord[] = []; const validations: ValidationRecord[] = [];
  for (const candidate of candidates) {
    const before = working.map((file) => ({ ...file }));
    working = working.map((file) => { const replacement = candidate.replacements.find((item) => item.path === file.path); return replacement ? { ...file, content: replacement.after } : file; });
    const analysis = await analyzeRepository({ repositoryKey, files: working, goal: 'validate guarded repair' });
    const survives = analysis.findings.some((finding) => finding.id === candidate.findingId && finding.status === 'confirmed');
    if (survives) {
      working = before; repairs.push({ ...candidate, status: 'reverted', failureReason: 'The target violation survived schema regeneration.' });
      validations.push({ id: `validation-${candidate.id}`, runId: 'eval', repairId: candidate.id, check: 'invariant', status: 'failed', summary: 'Target violation remains; repair reverted.' });
    } else {
      repairs.push({ ...candidate, status: 'verified' });
      validations.push({ id: `validation-${candidate.id}`, runId: 'eval', repairId: candidate.id, check: 'graph_diff', status: 'passed', summary: 'Affected schema region regenerated and target violation disappeared.' });
    }
  }
  const after = await analyzeRepository({ repositoryKey, files: working, goal: 'validate guarded repair' });
  return { repairs, validations, after, files: working };
}
