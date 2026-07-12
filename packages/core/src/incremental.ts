import type { LivingSchemaSnapshot, SchemaDelta } from './contracts.js';
export function calculateSchemaDelta(runId:string, previous:LivingSchemaSnapshot, next:LivingSchemaSnapshot, flowIndex:Record<string,string[]>):SchemaDelta {
  const paths = new Set([...Object.keys(previous.fileFingerprints), ...Object.keys(next.fileFingerprints)]);
  const changedFiles = [...paths].filter((path) => previous.fileFingerprints[path] !== next.fileFingerprints[path]).sort();
  const impactedFlowIds = [...new Set(changedFiles.flatMap((path) => flowIndex[path] ?? []))].sort();
  const addedNodeIds = next.nodeIds.filter((id) => !previous.nodeIds.includes(id));
  const removedNodeIds = previous.nodeIds.filter((id) => !next.nodeIds.includes(id));
  const addedPrincipleIds = next.principleIds.filter((id) => !previous.principleIds.includes(id));
  return { id:`delta-${runId}`, runId, fromSnapshotId:previous.id, toSnapshotId:next.id, changedFiles, addedNodeIds, changedNodeIds:[], removedNodeIds, impactedFlowIds, addedPrincipleIds, changedPrincipleIds:[], resolvedFindingIds:[], newFindingIds:[], regressionFindingIds:[], conciseSummary:`${changedFiles.length} changed files impact ${impactedFlowIds.length} flows.` };
}
