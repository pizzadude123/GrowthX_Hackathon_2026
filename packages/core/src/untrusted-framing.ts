import { canonicalStringify,sha256Text } from './canonical-integrity.js';

const KINDS = new Set(['repository-audit-input', 'verification-input']);

export async function frameUntrustedPayload(kind: 'repository-audit-input' | 'verification-input', value: unknown) {
  if (!KINDS.has(kind)) throw new Error('Unsupported untrusted payload kind');
  const payload = canonicalStringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const bytes = new TextEncoder().encode(payload).byteLength;
  const digest = await sha256Text(payload);
  return [
    'WHITEBOX_UNTRUSTED_FRAME_V1',
    `kind=${kind}`,
    'encoding=canonical-json-angle-escaped',
    `utf8_bytes=${bytes}`,
    `sha256=${digest}`,
    'payload_follows_to_end_of_message=true',
    payload,
  ].join('\n');
}
