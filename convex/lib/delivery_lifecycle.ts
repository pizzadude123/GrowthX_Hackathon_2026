export function deliveryTransition(status: 'delivered' | 'failed', attempts: number, maxAttempts: number) {
  const retry = status === 'failed' && attempts < maxAttempts;
  return {
    retry,
    jobStatus: retry ? 'delivery_pending' as const : 'completed' as const,
    publicStatus: retry ? 'pending' as const : status,
  };
}

type DeliveryLegStatus = 'pending' | 'sending' | 'delivered' | 'unknown';

export function deliveryLeaseProjection(input: {
  outboxId:string; runId:string; publicId:string; repository:string; leaseId:string;
  messageStatus:DeliveryLegStatus; attachmentStatus:DeliveryLegStatus;
}) {
  return { kind:'delivery' as const,outboxId:input.outboxId,runId:input.runId,publicId:input.publicId,repository:input.repository,mode:'audit_only' as const,leaseId:input.leaseId,messageStatus:input.messageStatus,attachmentStatus:input.attachmentStatus };
}

export function canonicalDeliveryClaim(row: {
  target?:string;
  messageText:string; messageDigest:string; attachmentBase64:string; attachmentName:string; attachmentMediaType:string; attachmentDigest:string;
  messageStatus:DeliveryLegStatus; attachmentStatus:DeliveryLegStatus;
}, leg:'message'|'attachment') {
  const target=row.target;
  if (typeof target!=='string'||!/^telegram:-?\d+(?::[1-9]\d*)?$/.test(target)) throw new Error('Canonical delivery target is invalid');
  const status = leg === 'message' ? row.messageStatus : row.attachmentStatus;
  if (status !== 'pending') throw new Error('Delivery leg is not pending');
  if (leg === 'message') {
    if (!row.messageText || !/^[a-f0-9]{64}$/i.test(row.messageDigest)) throw new Error('Canonical message artifact is invalid');
    return { artifactDigest:row.messageDigest,target,messageText:row.messageText };
  }
  if(row.messageStatus!=='delivered')throw new Error('Message delivery must complete before attachment claim');
  if (!row.attachmentBase64 || row.attachmentMediaType!=='application/pdf' || !/^[A-Za-z0-9._-]+\.pdf$/.test(row.attachmentName) || !/^[a-f0-9]{64}$/i.test(row.attachmentDigest)) throw new Error('Canonical attachment artifact is invalid');
  return { artifactDigest:row.attachmentDigest,target,attachmentBase64:row.attachmentBase64,attachmentName:row.attachmentName,attachmentMediaType:row.attachmentMediaType };
}
