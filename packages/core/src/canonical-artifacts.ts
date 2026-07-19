import type { AnalysisResult, RunMode } from './contracts.js';
import { formatTelegramFinalResult } from './telegram-progress.js';

function printable(value:string){return value.normalize('NFKD').replace(/[^\x20-\x7E]/g,'?').replace(/([\\()])/g,'\\$1');}
function wrap(value:string,width=92){if(!value)return[' '];const out:string[]=[];let line='';for(const word of value.split(/\s+/)){if(!line)line=word;else if(`${line} ${word}`.length<=width)line+=` ${word}`;else{out.push(line);line=word;}}if(line)out.push(line);return out;}
function asciiBase64(value:string){return btoa(value);}

export function canonicalSchemaDocument(run:{publicId:string;repository:string;mode:RunMode},analysis:AnalysisResult){
 const flows=analysis.flows.slice(0,3).map(flow=>`- **${flow.name}** — ${flow.orderedNodeIds.join(' → ')}`).join('\n')||'- No complete high-confidence flow found.';
 const findings=analysis.findings.filter(finding=>finding.status==='confirmed').slice(0,5).map(finding=>`- **${finding.severity.toUpperCase()} · ${finding.title}** — ${finding.evidence[0]?.path??'evidence unavailable'}:${finding.evidence[0]?.startLine??0}`).join('\n')||'- No confirmed findings.';
 return `# Whitebox Living Code Logistics Schema\n\nRun: ${run.publicId}  \nRepository: ${run.repository}  \nMode: ${run.mode}  \nSnapshot: ${analysis.snapshot.id}\n\n## Capability profile\n\n${analysis.manifest.languages.map(language=>`- ${language.language}: ${language.percentage}%`).join('\n')}\n\n## High-value flows\n\n${flows}\n\n## Confirmed findings\n\n${findings}\n\n## Principles\n\n- Confirmed claims require exact repository evidence.\n- Whitebox is read-only and cannot publish repairs.\n- Unsupported tree blobs are explicitly recorded in the private coverage manifest.\n\nGenerated from repository evidence by Whitebox. The structured snapshot remains in Convex.\n`;
}

export function canonicalPdfBase64(lines:string[]){
 const wrapped=lines.flatMap(line=>wrap(line));const pages=Array.from({length:Math.max(1,Math.ceil(wrapped.length/46))},(_,index)=>wrapped.slice(index*46,(index+1)*46));const fontId=3+pages.length*2;const objects:string[]=[];
 objects[1]='<< /Type /Catalog /Pages 2 0 R >>';objects[2]=`<< /Type /Pages /Kids [${pages.map((_,index)=>`${3+index*2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
 pages.forEach((page,index)=>{const pageId=3+index*2,contentId=pageId+1;const stream=`BT\n/F1 10 Tf\n50 760 Td\n${page.map(line=>`(${printable(line)}) Tj\n0 -15 Td`).join('\n')}\nET`;objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;objects[contentId]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;});objects[fontId]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
 let document='%PDF-1.4\n';const offsets:number[]=[0];for(let id=1;id<objects.length;id+=1){offsets[id]=document.length;document+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}const xref=document.length;document+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let id=1;id<objects.length;id+=1)document+=`${String(offsets[id]).padStart(10,'0')} 00000 n \n`;document+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return asciiBase64(document);
}

export function canonicalDeliveryArtifacts(run:{publicId:string;repository:string;mode:RunMode;dashboardUrl:string;sourceCommitSha:string;elapsedMs:number},analysis:AnalysisResult){
 const confirmed=analysis.findings.filter(finding=>finding.status==='confirmed');
 const message=formatTelegramFinalResult({publicId:run.publicId,repository:run.repository,mode:run.mode,commitSha:run.sourceCommitSha,elapsedMs:run.elapsedMs,mappedFiles:analysis.manifest.files.length,languages:analysis.manifest.languages.map(item=>item.language),flows:analysis.flows.map(flow=>flow.name),rejectedFindings:analysis.findings.filter(finding=>finding.status==='rejected').length,findings:confirmed.map(finding=>({severity:finding.severity,title:finding.title,evidence:finding.evidence[0]?`${finding.evidence[0].path}:${finding.evidence[0].startLine}-${finding.evidence[0].endLine}`:'No exact source range persisted'})),dependencies:analysis.dependencies.map(dependency=>({packageName:dependency.packageName,classification:dependency.classification})),agents:[{role:'Repository Auditor',status:'completed'},{role:'Verification Lead',status:'completed'}],resultState:'verified',dashboardUrl:run.dashboardUrl});
 const schema=canonicalSchemaDocument(run,analysis);const attachmentBase64=canonicalPdfBase64([...message.split('\n'),'','EDITOR DIAGNOSTICS',...analysis.editorDiagnostics.map(diagnostic=>`${diagnostic.severity.toUpperCase()} ${diagnostic.title} - ${diagnostic.path}:${diagnostic.startLine}-${diagnostic.endLine} - ${diagnostic.impact}`),'','LIVING CODE LOGISTICS SCHEMA',...schema.split('\n')]);
 return{messageText:message,attachmentBase64,attachmentName:`${run.publicId}-WHITEBOX-REPORT.pdf`,schemaDocument:schema};
}
