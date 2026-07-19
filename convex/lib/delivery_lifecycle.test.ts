import { describe, expect, it } from 'vitest';
import { canonicalDeliveryClaim, deliveryLeaseProjection, deliveryTransition } from './delivery_lifecycle.js';

describe('delivery lifecycle', () => {
  it('requeues bounded failures and closes only on receipt or exhaustion', () => {
    expect(deliveryTransition('failed', 1, 3)).toEqual({ retry: true, jobStatus: 'delivery_pending', publicStatus: 'pending' });
    expect(deliveryTransition('failed', 3, 3)).toEqual({ retry: false, jobStatus: 'completed', publicStatus: 'failed' });
    expect(deliveryTransition('delivered', 1, 3)).toEqual({ retry: false, jobStatus: 'completed', publicStatus: 'delivered' });
  });

  it('keeps canonical artifacts and destinations out of worker lease payloads', () => {
    const projection = deliveryLeaseProjection({ outboxId: 'outbox-1', runId: 'run-1', publicId: 'WB-TEST', repository: 'acme/demo', leaseId: 'lease-1', messageStatus: 'pending', attachmentStatus: 'pending' });
    expect(projection).toEqual({ kind: 'delivery', outboxId: 'outbox-1', runId: 'run-1', publicId: 'WB-TEST', repository: 'acme/demo', mode: 'audit_only', leaseId: 'lease-1', messageStatus: 'pending', attachmentStatus: 'pending' });
    expect(JSON.stringify(projection)).not.toMatch(/messageText|attachmentBase64|telegramChatId|target/);
  });

  it('derives the exact delivery payload only from server-owned state', () => {
    const row = {target:'telegram:-1001:7', messageText: 'canonical message', messageDigest: 'a'.repeat(64), attachmentBase64: 'cGRm', attachmentName: 'report.pdf', attachmentMediaType:'application/pdf', attachmentDigest: 'b'.repeat(64), messageStatus: 'pending', attachmentStatus: 'pending' } as const;
    expect(canonicalDeliveryClaim(row, 'message')).toEqual({ artifactDigest: 'a'.repeat(64), target: 'telegram:-1001:7', messageText: 'canonical message' });
    const legacy={...row} as Omit<typeof row,'target'>&{target?:string};delete legacy.target;
    expect(()=>canonicalDeliveryClaim(legacy,'message')).toThrow('target is invalid');
    expect(()=>canonicalDeliveryClaim(row, 'attachment')).toThrow('Message delivery');
    expect(canonicalDeliveryClaim({ ...row,messageStatus:'delivered' }, 'attachment')).toEqual({ artifactDigest: 'b'.repeat(64), target: 'telegram:-1001:7', attachmentBase64: 'cGRm', attachmentName: 'report.pdf',attachmentMediaType:'application/pdf' });
    expect(() => canonicalDeliveryClaim({ ...row, messageStatus: 'sending' }, 'message')).toThrow('pending');
  });
});
