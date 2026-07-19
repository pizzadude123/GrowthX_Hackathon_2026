import { internalMutation } from './_generated/server';
import { v } from 'convex/values';

const terminal=new Set(['audit_only','partial','completed','cancelled','blocked','failed']);
export const act = internalMutation({
 args:{publicId:v.string(),action:v.union(v.literal('pause'),v.literal('resume'),v.literal('cancel')),actor:v.string()},
 handler:async(ctx,args)=>{
  const run=await ctx.db.query('runs').withIndex('by_public_id',q=>q.eq('publicId',args.publicId)).unique();if(!run)throw new Error('Run not found');if(terminal.has(run.status))throw new Error('Terminal run state is immutable');
  const now=Date.now();
  if(args.action==='pause'){if(run.paused)return{ok:true,idempotent:true};await ctx.db.patch(run._id,{paused:true});}
  if(args.action==='resume'){if(!run.paused)return{ok:true,idempotent:true};await ctx.db.patch(run._id,{paused:false});}
  if(args.action==='cancel'){
   await ctx.db.patch(run._id,{status:'cancelled',currentStage:'cancelled',paused:false,completedAt:now,error:'Cancelled by owner',deliveryStatus:'not_requested'});
   const jobs=await ctx.db.query('workerJobs').withIndex('by_run',q=>q.eq('runId',run._id)).collect();for(const job of jobs.filter(item=>!['completed','failed'].includes(item.status)))await ctx.db.patch(job._id,{status:'failed',error:'cancelled',updatedAt:now});
   const attempts=await ctx.db.query('analysisAttempts').withIndex('by_run_status',q=>q.eq('runId',run._id)).collect();for(const attempt of attempts.filter(item=>!['completed','failed','aborted','expired'].includes(item.status)))await ctx.db.patch(attempt._id,{status:'aborted',failureCode:'cancelled',updatedAt:now,completedAt:now});
   const outboxes=await ctx.db.query('deliveryOutbox').withIndex('by_run',q=>q.eq('runId',run._id)).collect();for(const outbox of outboxes.filter(item=>!['delivered','failed'].includes(item.status)))await ctx.db.patch(outbox._id,{status:'failed',messageStatus:outbox.messageStatus==='sending'?'unknown':outbox.messageStatus,attachmentStatus:outbox.attachmentStatus==='sending'?'unknown':outbox.attachmentStatus,lastFailureCode:outbox.messageStatus==='sending'||outbox.attachmentStatus==='sending'?'ambiguous_send':'cancelled',updatedAt:now,completedAt:now});
  }
  await ctx.db.insert('managementActions',{runId:run._id,action:args.action,actor:args.actor,createdAt:now});return{ok:true};
 },
});
