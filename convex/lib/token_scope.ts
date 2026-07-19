export type TokenScope = 'command' | 'worker' | 'delivery' | 'release' | 'proxy';
export class RunOwnershipError extends Error {}

type ScopedTokens = { commandToken?: string; workerToken?: string; deliveryToken?: string; releaseToken?: string; proxyToken?:string };

function constantTimeEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function authorizedFor(scope: TokenScope, authorization: null | string | undefined, tokens: ScopedTokens) {
  const values = {
    command: tokens.commandToken ?? '',
    worker: tokens.workerToken ?? '',
    delivery: tokens.deliveryToken ?? '',
    release: tokens.releaseToken ?? '',
    proxy:tokens.proxyToken??'',
  };
  const configured = Object.values(values);
  if (configured.some((value) => value.length < 32) || new Set(configured).size !== configured.length) return false;
  const expected = values[scope];
  return constantTimeEqual(authorization ?? '', `Bearer ${expected}`);
}

export function assertRunOwner(ownerId: string | undefined, actorId: string | undefined) {
  if (!ownerId || !actorId || !constantTimeEqual(ownerId, actorId)) throw new RunOwnershipError('Run owner does not match the command actor');
}
