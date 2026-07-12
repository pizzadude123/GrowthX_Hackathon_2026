import { z } from 'zod';
import type { ExecutiveRunBrief, RunMode } from './contracts.js';
const briefSchema = z.object({ headline:z.string().max(90), systemFlow:z.string().max(180), highestRisk:z.string().max(180), actionTaken:z.string().max(180), validation:z.string().max(180), nextAction:z.string().max(160).optional() });
export function validateExecutiveBrief(value: ExecutiveRunBrief) { return briefSchema.parse(value); }
const label = (mode:RunMode) => mode === 'guarded_repair' ? 'Guarded repair' : 'Audit only';
export function formatAcceptedTelegram(run:{publicId:string;repository:string;mode:RunMode;dashboardUrl:string}) {
  return `🧭 Whitebox · ${run.publicId}\n\nRepo: ${run.repository}\nMode: ${label(run.mode)}\nStage: Mapping system logic\n\nDashboard:\n${run.dashboardUrl}`;
}
export function formatCompletedTelegram(run:{publicId:string;repository:string;mode:RunMode;dashboardUrl:string;found:number;fixed:number;reverted:number;escalated:number;dependencies:number;elapsedMs:number;prUrl?:string}) {
  const minutes=Math.floor(run.elapsedMs/60000); const seconds=Math.floor((run.elapsedMs%60000)/1000);
  const pr=run.prUrl ? `\nPR: ${run.prUrl}` : '';
  const message=`✅ ${run.publicId} · Completed\n\nFound: ${run.found}\nFixed: ${run.fixed}\nReverted: ${run.reverted}\nEscalated: ${run.escalated}\nDependencies: ${run.dependencies}\nTime: ${minutes}m ${seconds}s\n${pr}\nDashboard: ${run.dashboardUrl}`;
  if(message.length>700) throw new Error('Telegram completion message exceeds 700 characters');
  return message;
}
