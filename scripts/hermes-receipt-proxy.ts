import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename,join } from 'node:path';
import { canonicalStringify } from '../packages/core/src/canonical-integrity.js';
import { parseHermesAuditorProposalText, parseHermesVerifiedResultText } from '../packages/core/src/hermes-result.js';
import { parseTelegramDeliveryReceipt } from '../packages/core/src/telegram-delivery.js';
import { WHITEBOX_AUDITOR_PROMPT_DIGEST,WHITEBOX_VERIFIER_PROMPT_DIGEST } from '../packages/core/src/hermes-authority.js';
import {WHITEBOX_RELEASE_SOURCE_DIGEST} from '../packages/core/src/release-identity.js';

const execFileAsync = promisify(execFile);
const upstream = 'http://127.0.0.1:8742';
const listenPort = Number(process.env.WHITEBOX_HERMES_RECEIPT_PORT ?? 8743);
const serverKey = process.env.HERMES_SERVER_KEY ?? '';
const proxyToken=process.env.WHITEBOX_HERMES_PROXY_TOKEN??'';
const receiptKey = process.env.WHITEBOX_HERMES_RECEIPT_KEY ?? '';
const runtimeKey = process.env.WHITEBOX_HERMES_RUNTIME_KEY ?? '';
const deliveryToken = process.env.WHITEBOX_DELIVERY_TOKEN ?? '';
const deliverySignerToken = process.env.WHITEBOX_DELIVERY_SIGNER_TOKEN ?? '';
const controlPlane = (process.env.WHITEBOX_CONTROL_PLANE_URL ?? '').replace(/\/$/,'');
if ([serverKey,proxyToken,receiptKey,runtimeKey,deliveryToken,deliverySignerToken].some(value=>value.length<32)||new Set([serverKey,proxyToken,receiptKey,runtimeKey,deliveryToken,deliverySignerToken]).size!==6) throw new Error('Distinct upstream, proxy, receipt, runtime, delivery claim, and delivery signer credentials are required');
if (!controlPlane.startsWith('https://')) throw new Error('Trusted delivery control plane is required');
if(process.env.HERMES_UPSTREAM_URL&&process.env.HERMES_UPSTREAM_URL.replace(/\/$/,'')!==upstream)throw new Error('Hermes receipt proxy upstream is fixed to the dedicated loopback gateway');
type RuntimeState={runtimeProofDigest:string;runtimeIdentityDigest:string;processPid:number;bootNonce:string;effectiveToolCount:number};
type CreationAuthority={attemptId:string;role:'auditor'|'verifier';sessionId:string;promptDigest:string;inputDigest:string;repositoryKey:string;sourceCommitSha:string;snapshotDigest:string;coverageDigest:string;requestNonce:string};
type CreationBinding=CreationAuthority&{runtime:RuntimeState};
type ProducerAuthority={version:'whitebox-producer-authority-v1';jobId:string;runId:string;runPublicId:string;attemptId:string;leaseId:string;role:'auditor'|'verifier';sessionId:string;repositoryKey:string;sourceCommitSha:string;snapshotDigest:string;coverageDigest:string;nonce:string;issuedAt:number;expiresAt:number};
type ProducerAuthorityEnvelope={authority:ProducerAuthority;signature:string};
const creationBindings=new Map<string,CreationBinding>();

type RuntimeLock={version:string;hermesCommit:string;patchedApiServerDigest:string;runtimeModuleDigest:string;runtimeFiles:Record<string,string>;configSecurityDigest:string;pythonDigest:string;profile:string;model:string;provider:string;effectiveToolCount:number};
async function runtimeLock(){return JSON.parse(await readFile(resolve('hermes/runtime/runtime-lock.json'),'utf8')) as RuntimeLock;}

async function assertRuntimeInstallation(){
  const lock=await runtimeLock(),root=resolve(process.env.HERMES_AGENT_ROOT??'');
  if(lock.version!=='whitebox-hermes-runtime-lock-v1'||!root||process.env.WHITEBOX_HERMES_COMMIT!==lock.hermesCommit)throw new Error('runtime_lock_identity_invalid');
  for(const [path,expected] of Object.entries(lock.runtimeFiles)){if(!/^[a-f0-9]{64}$/.test(expected)||digestBuffer(await readFile(join(root,path)))!==expected)throw new Error('runtime_installation_digest_invalid');}
  const health=await upstreamJson('/health/detailed');if(typeof health.pid!=='number'||!Number.isInteger(health.pid))throw new Error('runtime_health_identity_missing');
  return{lock,pid:health.pid};
}

async function verifyRunRuntime(payload:Record<string,unknown>,expected:{runId:string;sessionId:string;requestNonce:string}):Promise<RuntimeState>{
  const attestation=payload.whitebox_runtime_attestation,signature=payload.whitebox_runtime_signature;
  if(!attestation||typeof attestation!=='object'||typeof signature!=='string')throw new Error('run_runtime_attestation_missing');
  const record=attestation as Record<string,unknown>,expectedSignature=createHmac('sha256',runtimeKey).update(canonicalStringify(record),'utf8').digest('hex'),left=Buffer.from(signature),right=Buffer.from(expectedSignature);
  if(left.length!==right.length||!timingSafeEqual(left,right))throw new Error('run_runtime_attestation_signature_invalid');
  const {lock,pid}=await assertRuntimeInstallation(),files=record.runtimeFiles;
  if(record.version!=='hermes.runtime-attestation.v1'||record.runId!==expected.runId||record.sessionId!==expected.sessionId||record.requestNonce!==expected.requestNonce||record.pid!==pid||record.profile!==lock.profile||record.hermesCommit!==lock.hermesCommit||record.model!==lock.model||record.provider!==lock.provider
    ||record.effectiveToolCount!==lock.effectiveToolCount||canonicalStringify(record.effectiveTools)!=='[]'||canonicalStringify(record.enabledToolsets)!=='[]'||typeof record.bootNonce!=='string'||!/^[a-f0-9]{64}$/.test(record.bootNonce)||typeof record.agentNonce!=='string'||!/^[a-f0-9]{64}$/.test(record.agentNonce)
    ||record.configSecurityDigest!==lock.configSecurityDigest||record.pythonDigest!==lock.pythonDigest||typeof record.issuedAt!=='number'||Math.abs(Date.now()-record.issuedAt)>300_000||!files||typeof files!=='object')throw new Error('run_runtime_attestation_identity_invalid');
  const manifest=files as Record<string,unknown>;
  if(canonicalStringify(manifest)!==canonicalStringify(lock.runtimeFiles)||digest(canonicalStringify(manifest))!==record.runtimeFilesDigest)throw new Error('run_runtime_attestation_source_invalid');
  const runtimeIdentityDigest=digest(canonicalStringify({version:'whitebox-hermes-runtime-identity-v1',processPid:pid,bootNonce:record.bootNonce,profile:record.profile,hermesCommit:record.hermesCommit,configSecurityDigest:record.configSecurityDigest,pythonDigest:record.pythonDigest,runtimeFilesDigest:record.runtimeFilesDigest,registryGeneration:record.registryGeneration,effectiveTools:record.effectiveTools,model:record.model,provider:record.provider})),runtimeProofDigest=digest(canonicalStringify({version:'whitebox-hermes-runtime-proof-v3',runId:expected.runId,sessionId:expected.sessionId,requestNonce:expected.requestNonce,agentNonce:record.agentNonce,processPid:pid,bootNonce:record.bootNonce,effectiveTools:record.effectiveTools,runtimeIdentityDigest}));
  return{runtimeIdentityDigest,runtimeProofDigest,processPid:pid,bootNonce:String(record.bootNonce),effectiveToolCount:Number(record.effectiveToolCount)};
}

function authorized(request: IncomingMessage) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(supplied); const right = Buffer.from(proxyToken);
  return left.length === right.length && timingSafeEqual(left,right);
}

async function readBody(request: IncomingMessage,maxBytes=400_000) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (body.length > maxBytes) throw new Error('request_too_large');
  return body;
}

function digest(value: string) { return createHash('sha256').update(value,'utf8').digest('hex'); }
function digestBuffer(value: Buffer) { return createHash('sha256').update(value).digest('hex'); }
function sign(value:unknown){return createHmac('sha256',receiptKey).update(canonicalStringify(value),'utf8').digest('hex');}
function validReceiptSignature(value:unknown,signature:string){const expected=sign(value),left=Buffer.from(signature),right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right);}
function signDelivery(value:unknown){return createHmac('sha256',deliverySignerToken).update(canonicalStringify(value),'utf8').digest('hex');}

async function proxyControl(path:string,body:unknown){const response=await fetch(`${controlPlane}${path}`,{method:'POST',headers:{Authorization:'Be'+'arer '+proxyToken,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error(`producer_authority_${response.status}`);return response.json() as Promise<Record<string,unknown>>;}

async function deliveryControl(path:string,body:unknown,attempts=1){
  let failure:unknown;
  for(let attempt=1;attempt<=attempts;attempt+=1){try{const response=await fetch(`${controlPlane}${path}`,{method:'POST',headers:{Authorization:'Be'+'arer '+deliveryToken,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20_000)});const text=await response.text();if(!response.ok)throw new Error(`delivery_control_${response.status}`);return JSON.parse(text) as Record<string,unknown>;}catch(error){failure=error;if(attempt<attempts)await new Promise(resolveDelay=>setTimeout(resolveDelay,attempt*250));}}
  throw failure;
}

async function deliver(body:Buffer){
  const input=JSON.parse(body.toString('utf8')) as Record<string,unknown>,keys=Object.keys(input).sort();
  const outboxId=typeof input.outboxId==='string'?input.outboxId:'',leaseId=typeof input.leaseId==='string'?input.leaseId:'',leg=input.leg;
  if(canonicalStringify(keys)!==canonicalStringify(['leaseId','leg','outboxId'])||!outboxId||!leaseId||!['message','attachment'].includes(String(leg)))throw new Error('invalid_delivery_request');
  const request={outboxId,leaseId,leg},claim=await deliveryControl('/api/delivery/claim',request);
  const artifactDigest=typeof claim.artifactDigest==='string'?claim.artifactDigest:'',target=typeof claim.target==='string'?claim.target:'';
  if(!/^[a-f0-9]{64}$/i.test(artifactDigest)||!/^telegram:-?\d+(?::[1-9]\d*)?$/.test(target))throw new Error('invalid_canonical_delivery_claim');
  const cli=process.env.HERMES_CLI??'/Users/pranay/.local/bin/hermes';let stdout='',directory:string|undefined;
  try{
    if(leg==='message'){
      const message=typeof claim.messageText==='string'?claim.messageText:'';if(!message||digest(message)!==artifactDigest)throw new Error('delivery_artifact_digest_mismatch');
      ({stdout}=await execFileAsync(cli,['--profile','whitebox','send','--to',target,'--json',message],{timeout:30_000,maxBuffer:100_000}));
    }else{
      const encoded=typeof claim.attachmentBase64==='string'?claim.attachmentBase64:'',rawName=typeof claim.attachmentName==='string'?claim.attachmentName:'',name=basename(rawName),mediaType=claim.attachmentMediaType;if(!encoded||rawName!==name||mediaType!=='application/pdf'||!name.endsWith('.pdf')||digest(encoded)!==artifactDigest)throw new Error('delivery_artifact_digest_mismatch');
      directory=await mkdtemp(join(tmpdir(),'whitebox-delivery-'));const file=join(directory,name);await writeFile(file,Buffer.from(encoded,'base64'));
      ({stdout}=await execFileAsync(cli,['--profile','whitebox','send','--to',target,'--json',`${outboxId} · Full Whitebox evidence report\nMEDIA:${file}`],{timeout:60_000,maxBuffer:100_000}));
    }
    const platform=await parseTelegramDeliveryReceipt(stdout,target),receipt={version:'whitebox-delivery-receipt-v1',outboxId,leaseId,leg,artifactDigest,target:platform.target,platform:'telegram',platformReceiptId:platform.platformReceiptId,issuedAt:Date.now()},signature=signDelivery(receipt);
    await deliveryControl('/api/delivery/complete',{...request,deliveryReceipt:receipt,deliverySignature:signature},3);return{receipt,signature};
  }catch(error){await deliveryControl('/api/delivery/fail',{outboxId,leaseId,code:'ambiguous_send'}).catch(()=>undefined);throw error;}finally{if(directory)await rm(directory,{recursive:true,force:true});}
}

async function upstreamJson(path: string) {
  const response = await fetch(`${upstream}${path}`, { headers:{ Authorization:'Be'+'arer '+serverKey }, signal:AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.json() as Promise<Record<string,unknown>>;
}

async function attachReceipt(payload: Record<string,unknown>) {
  const status = String(payload.status ?? '').toLowerCase();
  if (!['completed','succeeded','failed','cancelled','stopped','error'].includes(status)) return payload;
  const runId = typeof payload.run_id === 'string' ? payload.run_id : '';
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const output = typeof payload.output === 'string' ? payload.output : '';
  if (!runId || !sessionId || !output) throw new Error('terminal_run_missing_identity_or_output');
  const sessionPayload = await upstreamJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const session = sessionPayload.session && typeof sessionPayload.session === 'object' ? sessionPayload.session as Record<string,unknown> : {};
  const toolCallCount = session.tool_call_count;
  if (session.id !== sessionId) throw new Error('session_identity_mismatch');
  if (typeof toolCallCount !== 'number' || !Number.isInteger(toolCallCount)) throw new Error('session_tool_count_unavailable');
  const binding=creationBindings.get(runId);
  if(!binding||binding.sessionId!==sessionId)throw new Error('run_creation_binding_missing');
  const currentRuntime=await verifyRunRuntime(payload,{runId,sessionId,requestNonce:binding.requestNonce});
  if(currentRuntime.runtimeIdentityDigest!==binding.runtime.runtimeIdentityDigest||currentRuntime.processPid!==binding.runtime.processPid||currentRuntime.bootNonce!==binding.runtime.bootNonce)throw new Error('runtime_identity_changed_during_run');
  const parsed=binding.role==='auditor'?parseHermesAuditorProposalText(output):parseHermesVerifiedResultText(output);
  if (!parsed.result || parsed.errors.length) throw new Error('structured_output_invalid');
  const receipt = {
    version:'whitebox-hermes-receipt-v1',runId,sessionId,status,attemptId:binding.attemptId,
    role:binding.role,promptDigest:binding.promptDigest,inputDigest:binding.inputDigest,repositoryKey:binding.repositoryKey,sourceCommitSha:binding.sourceCommitSha,snapshotDigest:binding.snapshotDigest,coverageDigest:binding.coverageDigest,releaseSourceDigest:WHITEBOX_RELEASE_SOURCE_DIGEST,runtimeIdentityDigest:binding.runtime.runtimeIdentityDigest,
    outputDigest:digest(output), structuredResultDigest:digest(canonicalStringify(parsed.result)),
    toolCallCount,effectiveToolCount:binding.runtime.effectiveToolCount,runtimeProofDigest:binding.runtime.runtimeProofDigest,runtimeProcessPid:binding.runtime.processPid,runtimeBootNonce:binding.runtime.bootNonce,upstreamOrigin:upstream,issuedAt:Date.now(),
  };
  return { ...payload, whitebox_receipt:receipt, whitebox_signature:sign(receipt) };
}

async function handle(request: IncomingMessage, response: ServerResponse) {
  try {
    if (!authorized(request)) { response.writeHead(401,{'Content-Type':'application/json'}).end('{"error":"unauthorized"}'); return; }
    const url = new URL(request.url ?? '/',`http://127.0.0.1:${listenPort}`);
    if (request.method === 'GET' && url.pathname === '/whitebox/runtime') {
      const runtime=await assertRuntimeInstallation(),receipt={version:'whitebox-hermes-runtime-v1',releaseSourceDigest:WHITEBOX_RELEASE_SOURCE_DIGEST,runScopedGate:true,signerAvailable:true,runtimeLockVersion:runtime.lock.version,runtimeProcessPid:runtime.pid,upstreamOrigin:upstream,issuedAt:Date.now()};
      response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({receipt,signature:sign(receipt)})); return;
    }
    if(request.method==='POST'&&url.pathname==='/whitebox/deliver'){
      const result=await deliver(await readBody(request,1_200_000));response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));return;
    }
    if (!url.pathname.startsWith('/v1/runs')) { response.writeHead(404,{'Content-Type':'application/json'}).end('{"error":"not_found"}'); return; }
    const body = ['GET','HEAD'].includes(request.method ?? 'GET') ? undefined : await readBody(request);let upstreamBody=body;
    let pendingBinding:CreationAuthority|undefined,requestNonce='';
    if(request.method==='POST'&&url.pathname==='/v1/runs'){
      await assertRuntimeInstallation();requestNonce=randomBytes(32).toString('hex');const [auditorPrompt,verifierPrompt]=await Promise.all([readFile(resolve('hermes/WHITEBOX_AUDITOR_SYSTEM_PROMPT.md'),'utf8'),readFile(resolve('hermes/WHITEBOX_POC_SYSTEM_PROMPT.md'),'utf8')]);
      if(digest(auditorPrompt)!==WHITEBOX_AUDITOR_PROMPT_DIGEST||digest(verifierPrompt)!==WHITEBOX_VERIFIER_PROMPT_DIGEST)throw new Error('Hermes prompt authority digest mismatch');
      const submitted=JSON.parse(body!.toString('utf8')) as Record<string,unknown>,keys=Object.keys(submitted).sort(),sessionId=typeof submitted.session_id==='string'?submitted.session_id:'',instructions=typeof submitted.instructions==='string'?submitted.instructions:'',input=typeof submitted.input==='string'?submitted.input:'',match=/^(WB-[A-Z0-9]+)-(auditor|verifier)-([A-Za-z0-9-]{8,})$/.exec(sessionId),envelope=submitted.whitebox_creation_authority as ProducerAuthorityEnvelope|undefined,authority=envelope?.authority;
      if(canonicalStringify(keys)!==canonicalStringify(['input','instructions','session_id','whitebox_creation_authority'])||!match||!input||!instructions||!authority||typeof envelope?.signature!=='string'||!validReceiptSignature(authority,envelope.signature))throw new Error('invalid_run_creation_authority');
      const role=match[2] as'auditor'|'verifier',promptDigest=digest(instructions),expected=role==='auditor'?WHITEBOX_AUDITOR_PROMPT_DIGEST:WHITEBOX_VERIFIER_PROMPT_DIGEST,source=/^Whitebox run: ([^\n]+)\nRepository: ([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\nImmutable source commit: ([a-f0-9]{40})\nTrusted snapshot digest: ([a-f0-9]{64})\nTrusted coverage digest: ([a-f0-9]{64})\n/m.exec(input);
      if(promptDigest!==expected)throw new Error('untrusted_prompt_rejected');
      if(!source||source[1]!==match[1]||authority.version!=='whitebox-producer-authority-v1'||authority.runPublicId!==match[1]||authority.attemptId!==match[3]||authority.role!==role||authority.sessionId!==sessionId||authority.repositoryKey!==source[2]||authority.sourceCommitSha!==source[3]||authority.snapshotDigest!==source[4]||authority.coverageDigest!==source[5]||authority.expiresAt<=Date.now()||authority.issuedAt>Date.now()||!/^[-A-Za-z0-9_]{8,}$/.test(authority.jobId)||!/^[-A-Za-z0-9_]{8,}$/.test(authority.runId)||!/^[a-f0-9]{32}$/.test(authority.nonce))throw new Error('untrusted_source_binding_rejected');
      await proxyControl('/api/runtime/producer-authority/consume',envelope);upstreamBody=Buffer.from(JSON.stringify({input,session_id:sessionId,instructions}));
      pendingBinding={attemptId:authority.attemptId,role,sessionId,promptDigest,inputDigest:digest(input),repositoryKey:authority.repositoryKey,sourceCommitSha:authority.sourceCommitSha,snapshotDigest:authority.snapshotDigest,coverageDigest:authority.coverageDigest,requestNonce};
    }
    const upstreamResponse = await fetch(`${upstream}${url.pathname}${url.search}`, {
      method:request.method??'GET', headers:{ Authorization:'Be'+'arer '+serverKey,'Content-Type':'application/json',...(requestNonce?{'X-Whitebox-Runtime-Nonce':requestNonce}:{}) },
      ...(upstreamBody?{body:upstreamBody}:{}),signal:AbortSignal.timeout(35_000),
    });
    const text = await upstreamResponse.text();
    if(upstreamResponse.ok&&pendingBinding){const started=JSON.parse(text) as Record<string,unknown>,runId=typeof started.run_id==='string'?started.run_id:'';if(!runId)throw new Error('upstream_run_identity_missing');const runtime=await verifyRunRuntime(started,{runId,sessionId:pendingBinding.sessionId,requestNonce});creationBindings.set(runId,{...pendingBinding,runtime});}
    if (!upstreamResponse.ok || request.method !== 'GET' || !/^\/v1\/runs\/[^/]+$/.test(url.pathname)) {
      response.writeHead(upstreamResponse.status,{'Content-Type':upstreamResponse.headers.get('content-type') ?? 'application/json'}).end(text); return;
    }
    const payload = await attachReceipt(JSON.parse(text) as Record<string,unknown>);
    response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(payload));
  } catch (error) {
    const code = error instanceof SyntaxError ? 'invalid_json' : error instanceof Error ? error.message.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80) : 'proxy_failure';
    response.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({ error:code }));
  }
}

await assertRuntimeInstallation();
createServer((request,response) => { void handle(request,response); }).listen(listenPort,'127.0.0.1',() => {
  console.log(`Whitebox Hermes receipt proxy listening on 127.0.0.1:${listenPort}`);
});
