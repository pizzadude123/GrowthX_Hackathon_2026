import {readdir,readFile} from 'node:fs/promises';
import {join,relative} from 'node:path';

const ignored=new Set(['node_modules','.git','.convex','dist','coverage','.wrangler']);
const credentialPatterns=[/github_pat_[A-Za-z0-9_]{20,}/g,/ghp_[A-Za-z0-9]{20,}/g,/\bsk-[A-Za-z0-9_-]{20,}\b/g];
const opaqueHexPattern=/\b[a-f0-9]{64}\b/gi;
const publicDigestFiles=new Set(['hermes/runtime/runtime-lock.json','packages/core/src/release-identity.ts','apps/web/src/release-identity.ts']);
const hits:string[]=[];

async function walk(dir:string){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(ignored.has(entry.name))continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory()){await walk(path);continue;}
    let text:string;
    try{text=await readFile(path,'utf8');}catch{continue;}
    const repositoryPath=relative(process.cwd(),path);
    if(path.endsWith('secret-scan.ts'))continue;
    for(const pattern of credentialPatterns){pattern.lastIndex=0;if(pattern.test(text))hits.push(repositoryPath);}
    if(!publicDigestFiles.has(repositoryPath)){opaqueHexPattern.lastIndex=0;if(opaqueHexPattern.test(text))hits.push(repositoryPath);}
  }
}

await walk(process.cwd());
if(hits.length){console.error(`Potential secrets in: ${[...new Set(hits)].join(', ')}`);process.exit(1);}
console.log('Secret scan passed: no credential patterns found.');
