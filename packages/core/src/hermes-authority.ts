import { frameUntrustedPayload } from './untrusted-framing.js';
import { detectorFindingClaim,detectorFindingClaimDigest,type HermesAuditorProposal } from './hermes-result.js';
import type { WhiteboxFinding } from './contracts.js';

export const WHITEBOX_AUDITOR_PROMPT_DIGEST='4d87f253db8872ebfdb10e24769f6138'+'648542c6f7e6813ed5b3dfaf1240c281';
export const WHITEBOX_VERIFIER_PROMPT_DIGEST='c902d3d0912aa7c3e025aad4a1afd9a'+'9759619a44d046b2b7065e8dd214af626';

export type HermesRepositoryFile={path:string;content:string};
export function hermesRepositoryPacket(files:HermesRepositoryFile[]){return files.map(file=>({path:file.path,numberedContent:file.content.split(/\r?\n/).map((line,index)=>`${index+1}|${line}`).join('\n')}));}
export async function trustedDetectorPacket(findings:WhiteboxFinding[]){return Promise.all(findings.map(async finding=>({...detectorFindingClaim(finding),detectorClaimDigest:await detectorFindingClaimDigest(finding)})));}
export function hermesRunIdentity(publicId:string,repositoryKey:string,sourceCommitSha:string,snapshotDigest:string,coverageDigest:string){return `Whitebox run: ${publicId}\nRepository: ${repositoryKey}\nImmutable source commit: ${sourceCommitSha}\nTrusted snapshot digest: ${snapshotDigest}\nTrusted coverage digest: ${coverageDigest}`;}
export async function hermesAuditorRunInput(publicId:string,repositoryKey:string,sourceCommitSha:string,snapshotDigest:string,coverageDigest:string,files:HermesRepositoryFile[],findings:WhiteboxFinding[]){return `${hermesRunIdentity(publicId,repositoryKey,sourceCommitSha,snapshotDigest,coverageDigest)}\n\n${await frameUntrustedPayload('repository-audit-input',{objective:'Select only exact server detector records. Never rewrite detector identity or prose.',serverDetectorCandidates:await trustedDetectorPacket(findings),repositoryFiles:hermesRepositoryPacket(files)})}`;}
export async function hermesVerifierRunInput(publicId:string,repositoryKey:string,sourceCommitSha:string,snapshotDigest:string,coverageDigest:string,files:HermesRepositoryFile[],auditorProposal:HermesAuditorProposal,findings:WhiteboxFinding[]){return `${hermesRunIdentity(publicId,repositoryKey,sourceCommitSha,snapshotDigest,coverageDigest)}\n\n${await frameUntrustedPayload('verification-input',{objective:'Disposition every exact auditor candidate against the same immutable server detector records and source bytes.',serverDetectorCandidates:await trustedDetectorPacket(findings),auditorProposal,repositoryFiles:hermesRepositoryPacket(files)})}`;}
