import { canonicalDigest } from './canonical-integrity.js';

const allowedKeys = new Set(['success','platform','chat_id','message_id','message_thread_id','warnings','mirrored']);
export async function parseTelegramDeliveryReceipt(stdout: string, expectedTarget: string) {
  const topLevelStart = stdout.lastIndexOf('\n{');
  const value = JSON.parse(stdout.slice(topLevelStart < 0 ? 0 : topLevelStart + 1)) as Record<string,unknown>;
  if (!value || typeof value !== 'object' || Object.keys(value).some((key) => !allowedKeys.has(key))
    || value.success !== true || value.platform !== 'telegram' || (value.mirrored !== undefined && value.mirrored !== true)) throw new Error('invalid_receipt');
  const platformReceiptId = typeof value.message_id === 'number' ? String(value.message_id) : value.message_id;
  if (typeof platformReceiptId !== 'string' || !/^[1-9]\d*$/.test(platformReceiptId)) throw new Error('invalid_receipt');
  const target=/^telegram:(-?\d+)(?::([1-9]\d*))?$/.exec(expectedTarget),chatId=typeof value.chat_id==='number'?String(value.chat_id):value.chat_id,threadId=typeof value.message_thread_id==='number'?String(value.message_thread_id):value.message_thread_id;
  if(!target||chatId!==target[1]||threadId!==target[2])throw new Error('invalid_receipt');
  return { platform:'telegram' as const, platformReceiptId, target:expectedTarget, receiptDigest:await canonicalDigest(value) };
}

export type DeliveryFailureCode = 'gateway_timeout'|'gateway_unavailable'|'invalid_receipt'|'artifact_unavailable'|'lease_lost'|'ambiguous_send'|'cancelled'|'unknown';
export function classifyDeliveryError(error: unknown): DeliveryFailureCode {
  const value = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase();
  if (value.includes('invalid_receipt')) return 'invalid_receipt';
  if (value.includes('timeout') || value.includes('timed out')) return 'gateway_timeout';
  if (value.includes('enoent') || value.includes('artifact')) return 'artifact_unavailable';
  if (value.includes('lease')) return 'lease_lost';
  if (value.includes('fetch') || value.includes('connect') || value.includes('unavailable')) return 'gateway_unavailable';
  return 'unknown';
}
