export type ProducerAuthorityWindow={nonce:string;issuedAt:number;expiresAt:number};

export function assertProducerAuthorityConsumable(authority:ProducerAuthorityWindow,stored:{nonce?:string;expiresAt?:number;consumedAt?:number},now:number){
  if(authority.issuedAt>now||authority.expiresAt<=now||authority.expiresAt<=authority.issuedAt||authority.expiresAt-authority.issuedAt>60_000)throw new Error('Producer authority window is invalid');
  if(!/^[a-f0-9]{32}$/.test(authority.nonce)||authority.nonce!==stored.nonce||authority.expiresAt!==stored.expiresAt||stored.consumedAt)throw new Error('Producer authority is stale or consumed');
}
