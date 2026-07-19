import { MAX_AUDIT_BYTES, MAX_AUDIT_FILES, MAX_AUDIT_FILE_BYTES } from './audit-limits.js';

export type AuditTreeItem = { path: string; type: string; size?: number | undefined; sha?: string | undefined };
export type AuditCoverageDisposition={path:string;reason:'excluded_generated_or_vendored'|'unsupported_file_type'};
const MAX_TREE_BLOBS=500;
const sourceExtensions=/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|astro|py|pyi|go|rs|java|kt|kts|scala|cs|fs|fsx|rb|php|swift|m|mm|c|cc|cpp|cxx|h|hpp|hxx|ex|exs|erl|hrl|hs|lhs|clj|cljs|cljc|groovy|dart|lua|r|jl|sol|move|sql|graphql|gql|proto|sh|bash|zsh|fish|ps1|tf|hcl|nix|json|jsonc|ya?ml|toml|ini|env\.example|md|mdx)$/i;
const namedSource=/(^|\/)(README(?:\.[^/]*)?|LICENSE(?:\.[^/]*)?|Dockerfile(?:\.[^/]*)?|Makefile|Procfile|Gemfile|Rakefile|Podfile|Vagrantfile|CMakeLists\.txt)$/i;
const manifests=/(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|mix\.exs|pubspec\.yaml|Dockerfile|wrangler\.toml|vite\.config\.[^/]+|next\.config\.[^/]+)$/i;
const excluded=/(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|\.nuxt|target|Pods|DerivedData|venv|\.venv|__pycache__|fixtures\/generated)(\/|$)|\.(?:min\.|map$)|(?:^|\/)(?:package-lock|yarn\.lock|pnpm-lock|bun\.lockb|Cargo\.lock)$/i;
function priority(path:string){if(manifests.test(path))return 0;if(/(^|\/)(src|app|lib|server|api|cmd|internal|packages)(\/|$)/i.test(path))return 10;if(/(^|\/)(config|infra|migrations|db|scripts)(\/|$)/i.test(path))return 20;if(/(^|\/)(test|tests|spec|__tests__)(\/|$)/i.test(path))return 30;if(/\.(?:md|mdx)$/i.test(path))return 50;return 40;}
function safePath(path:string){return Boolean(path)&&!path.startsWith('/')&&!path.includes('../')&&!path.includes('\\')&&!path.includes('\0');}

export function classifyCompleteAuditTree(tree:AuditTreeItem[]){
 for(const item of tree){if(!safePath(item.path))throw new Error('Repository contains an unsafe tree path');if(item.type==='commit')throw new Error('Repository submodules are unsupported by the complete audit boundary');if(item.type!=='blob'&&item.type!=='tree')throw new Error('Repository contains an unsupported Git tree entry');}
 const blobs=tree.filter(item=>item.type==='blob');if(blobs.length>MAX_TREE_BLOBS)throw new Error('Repository exceeds the supported complete tree-coverage boundary');
 const dispositions:AuditCoverageDisposition[]=[];const supported:AuditTreeItem[]=[];
 for(const item of blobs){if(excluded.test(item.path)){dispositions.push({path:item.path,reason:'excluded_generated_or_vendored'});continue;}if(!(sourceExtensions.test(item.path)||namedSource.test(item.path))){dispositions.push({path:item.path,reason:'unsupported_file_type'});continue;}supported.push(item);}
 supported.sort((left,right)=>priority(left.path)-priority(right.path)||left.path.localeCompare(right.path));dispositions.sort((left,right)=>left.path.localeCompare(right.path));
 if(supported.some(item=>(item.size??MAX_AUDIT_FILE_BYTES)>=MAX_AUDIT_FILE_BYTES))throw new Error('Repository exceeds the supported file size for a complete bounded audit');let bytes=0;const selected:AuditTreeItem[]=[];
 for(const item of supported){const size=item.size??MAX_AUDIT_FILE_BYTES;if(selected.length>=MAX_AUDIT_FILES||bytes+size>MAX_AUDIT_BYTES)continue;selected.push(item);bytes+=size;}
 if(selected.length!==supported.length)throw new Error('Repository exceeds the supported file limit for a complete bounded audit');if(!selected.length)throw new Error('Repository has no supported readable source or configuration files');
 return{selected,dispositions,totalBlobCount:blobs.length};
}
export function selectCompleteAuditTree(tree:AuditTreeItem[]){return classifyCompleteAuditTree(tree).selected;}
