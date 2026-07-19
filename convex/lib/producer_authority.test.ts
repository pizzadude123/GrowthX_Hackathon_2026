import {describe,expect,it} from 'vitest';
import {assertProducerAuthorityConsumable} from './producer_authority.js';

const now=1_000_000,authority={nonce:'a'.repeat(32),issuedAt:now-1_000,expiresAt:now+59_000},stored={nonce:'a'.repeat(32),expiresAt:now+59_000};
describe('producer creation authority',()=>{
  it('accepts one exact live server-issued capability',()=>expect(()=>assertProducerAuthorityConsumable(authority,stored,now)).not.toThrow());
  it('rejects replay, expiry, nonce substitution, and overlong authority',()=>{
    expect(()=>assertProducerAuthorityConsumable(authority,{...stored,consumedAt:now-1},now)).toThrow('stale or consumed');
    expect(()=>assertProducerAuthorityConsumable({...authority,expiresAt:now},stored,now)).toThrow('window');
    expect(()=>assertProducerAuthorityConsumable({...authority,nonce:'b'.repeat(32)},stored,now)).toThrow('stale or consumed');
    expect(()=>assertProducerAuthorityConsumable({...authority,issuedAt:now-2_000},stored,now)).toThrow('window');
  });
});
