import { describe,expect,it } from 'vitest';
import { projectPublicDependency,projectPublicEdge,projectPublicFinding,projectPublicFlow,projectPublicRun,projectPublicSnapshot,projectPublicStep } from './public_run.js';

const canary='PRIVATE_CANARY_/private/report.pdf';
describe('recursive public projections',()=>{
 it('allowlists run and step fields without database or producer identities',()=>{
  expect(projectPublicRun({publicId:'WB-ABC',repository:'acme/demo',_id:canary,_creationTime:1,telegramChatId:canary,hermesRunId:canary,error:canary,snapshotDigest:'a',resultDigest:'b',resultProtocolVersion:'whitebox-verified-result-v1'})).toEqual({publicId:'WB-ABC',repository:'acme/demo',sourceBound:false,resultBound:true,schemaPublished:false});
  expect(projectPublicStep({_id:canary,role:'Repository Auditor',status:'completed',objective:'audit',startedAt:1,dynamicallySpawned:false,inputSummary:canary,error:canary})).toEqual({role:'Repository Auditor',status:'completed',objective:'audit',startedAt:1,dynamicallySpawned:false});
 });
 it('allowlists every nested data and evidence object',()=>{
  const evidence={path:'src/a.ts',startLine:1,endLine:1,excerpt:'safe',explanation:'safe',secret:canary};
  const projected=[
   projectPublicEdge({edgeId:'e',from:'a',to:'b',kind:'calls',confidence:1,evidence:[evidence],secret:canary}),
   projectPublicFlow({flowId:'f',name:'flow',secret:canary,data:{id:'f',name:'flow',trigger:'x',orderedNodeIds:['a'],inputContract:[],outputContract:[],sideEffects:[],stateTransitions:[{entity:'x',from:'a',to:'b',guarded:true,evidence:[evidence],secret:canary}],invariants:[{id:'i',statement:'x',scopeNodeIds:['a'],confidence:1,evidence:[evidence],secret:canary}],failurePoints:[],externalDependencies:[],confidence:1,secret:canary}}),
   projectPublicFinding({findingId:'x',title:'safe',category:'logic',severity:'high',confidence:1,status:'confirmed',impact:'safe',logicChain:[],evidence:[evidence],affectedNodeIds:['a'],affectedFlowIds:['f'],violatedInvariantIds:['i'],businessImpact:'safe',recommendation:'safe',repairability:'manual',rejectionReason:canary,secret:canary}),
   projectPublicDependency({packageName:'pkg',data:{configuredRange:'1',deprecated:false,classification:'current',affectedFlowIds:[],probableUpgradeComplexity:'low',safeAction:'none',evidenceSummary:canary},secret:canary}),
   projectPublicSnapshot({snapshotId:'s',version:1,createdAt:1,confidenceSummary:'safe',data:{secret:canary}},'# generated'),
  ];
  expect(JSON.stringify(projected)).not.toContain(canary);
  expect(JSON.stringify(projected)).not.toContain('secret');
 });
});
