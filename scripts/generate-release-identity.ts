import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const identityPaths=['packages/core/src/release-identity.ts','apps/web/src/release-identity.ts'];
const raw=execFileSync('git',['ls-files','-s','-z'],{encoding:'utf8'});
const entries=raw.split('\0').filter(Boolean).map((entry)=>{const match=/^(\d+) ([a-f0-9]{40}) 0\t(.+)$/.exec(entry);if(!match)throw new Error('Release identity requires a stage-0 Git index');return{mode:match[1]!,blobSha:match[2]!,path:match[3]!};}).filter((entry)=>!identityPaths.includes(entry.path)).sort((left,right)=>left.path.localeCompare(right.path));
const sourceDigest=createHash('sha256').update(JSON.stringify({version:'whitebox-release-source-v1',entries}),'utf8').digest('hex');
writeFileSync(resolve(identityPaths[0]!),`export const WHITEBOX_RELEASE_IDENTITY_VERSION='whitebox-release-source-v1' as const;\nexport const WHITEBOX_RELEASE_SOURCE_DIGEST='${sourceDigest}' as const;\n`);
writeFileSync(resolve(identityPaths[1]!),`export const WHITEBOX_RELEASE_SOURCE_DIGEST='${sourceDigest}' as const;\n`);
console.log(`whitebox_release_source_digest=${sourceDigest}`);
