async function replaceRunRows(ctx: any, table: string, runId: any) {
  const rows = await ctx.db.query(table).withIndex('by_run', (query: any) => query.eq('runId', runId)).collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

export async function replaceCanonicalAnalysis(ctx: any, args: { runId: any; repositoryKey: string; analysis: any }) {
  const run = await ctx.db.get(args.runId);
  if (!run) throw new Error('Run record disappeared');
  if (run.repository.toLowerCase() !== args.repositoryKey.toLowerCase()) throw new Error('Analysis repository does not match the run');
  const analysis = args.analysis;
  if (!analysis?.manifest?.files || !Array.isArray(analysis.nodes) || !Array.isArray(analysis.edges) || !Array.isArray(analysis.flows) || !Array.isArray(analysis.findings) || !analysis.snapshot?.id) throw new Error('Analysis payload is incomplete');
  if (analysis.snapshot.repositoryKey.toLowerCase() !== args.repositoryKey.toLowerCase()) throw new Error('Analysis snapshot repository does not match the run');
  if (!analysis.snapshot.sourceCommitSha || !/^[a-f0-9]{40}$/i.test(analysis.snapshot.sourceCommitSha)) throw new Error('Analysis snapshot requires an immutable commit SHA');
  if (!run.sourceCommitSha || run.sourceCommitSha.toLowerCase() !== analysis.snapshot.sourceCommitSha.toLowerCase()) throw new Error('Analysis snapshot commit does not match the bound run commit');

  for (const table of ['graphNodes','graphEdges','flows','findings','dependencies','repairs','validations','editorDiagnostics']) {
    await replaceRunRows(ctx, table, args.runId);
  }
  for (const node of analysis.nodes) await ctx.db.insert('graphNodes', { runId: args.runId, nodeId: node.id, kind: node.kind, name: node.name, path: node.path, startLine: node.startLine, endLine: node.endLine, summary: node.summary, confidence: node.confidence });
  for (const edge of analysis.edges) await ctx.db.insert('graphEdges', { runId: args.runId, edgeId: edge.id, from: edge.from, to: edge.to, kind: edge.kind, evidence: edge.evidence, confidence: edge.confidence });
  for (const flow of analysis.flows) await ctx.db.insert('flows', { runId: args.runId, flowId: flow.id, name: flow.name, data: flow });
  for (const finding of analysis.findings) {
    const { id, ...data } = finding;
    await ctx.db.insert('findings', { runId: args.runId, findingId: id, ...data });
  }
  for (const dependency of analysis.dependencies ?? []) await ctx.db.insert('dependencies', { runId: args.runId, packageName: dependency.packageName, data: dependency });
  for (const repair of analysis.repairs ?? []) await ctx.db.insert('repairs', { runId: args.runId, repairId: repair.id, findingId: repair.findingId, status: repair.status, data: repair });
  for (const validation of analysis.validations ?? []) await ctx.db.insert('validations', { runId: args.runId, repairId: validation.repairId, check: validation.check, status: validation.status, durationMs: validation.durationMs, summary: validation.summary, artifactUrl: validation.artifactUrl });
  for (const diagnostic of analysis.editorDiagnostics ?? []) {
    const data: any = { ...diagnostic };
    delete data.id;
    delete data.runId;
    await ctx.db.insert('editorDiagnostics', { ...data, runId: args.runId, repositoryKey: args.repositoryKey });
  }

  const existingSnapshot = await ctx.db.query('schemaSnapshots').withIndex('by_snapshot_id', (query: any) => query.eq('snapshotId', analysis.snapshot.id)).first();
  const snapshotData = { repositoryKey: args.repositoryKey, snapshotId: analysis.snapshot.id, version: analysis.snapshot.version, parentSnapshotId: analysis.snapshot.parentSnapshotId, sourceCommitSha: analysis.snapshot.sourceCommitSha, data: analysis.snapshot, createdAt: analysis.snapshot.createdAt, confidenceSummary: analysis.snapshot.confidenceSummary };
  if (existingSnapshot) await ctx.db.patch(existingSnapshot._id, snapshotData);
  else await ctx.db.insert('schemaSnapshots', snapshotData);

  return {
    run,
    mappedFiles: analysis.manifest.files.length,
    flowCount: analysis.flows.length,
    confirmedFindingCount: analysis.findings.filter((finding: any) => finding.status === 'confirmed').length,
    rejectedFindingCount: analysis.findings.filter((finding: any) => finding.status === 'rejected').length,
    dependencyRiskCount: (analysis.dependencies ?? []).length,
    outputSchemaSnapshotId: analysis.snapshot.id,
    capabilityProfile: analysis.manifest.capability,
  };
}
