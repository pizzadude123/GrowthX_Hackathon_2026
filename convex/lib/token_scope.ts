export type TokenScope = 'command' | 'worker';

type ScopedTokens = { commandToken?: string; workerToken?: string };

function constantTimeEqual(left: string, right: string) {
  const size = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function authorizedFor(scope: TokenScope, authorization: string | null | undefined, tokens: ScopedTokens) {
  const commandToken = tokens.commandToken ?? '';
  const workerToken = tokens.workerToken ?? '';
  if (commandToken.length < 32 || workerToken.length < 32 || constantTimeEqual(commandToken, workerToken)) return false;
  const expected = scope === 'command' ? commandToken : workerToken;
  return constantTimeEqual(authorization ?? '', `Bearer ${expected}`);
}
