import { z } from 'zod';
type Fetcher = typeof fetch;
const runStartSchema = z.object({ run_id:z.string().min(1), status:z.string() });
const runStatusSchema = z.object({ run_id:z.string(), status:z.string(), session_id:z.string().optional(), output:z.string().optional(), usage:z.object({ input_tokens:z.number().optional(), output_tokens:z.number().optional(), total_tokens:z.number().optional() }).optional() });
export class HermesRunsClient {
  private readonly baseUrl:string; private readonly key:string|undefined; private readonly fetcher:Fetcher;
  constructor(config:{baseUrl:string;key?:string;environment?:string;fetcher?:Fetcher}) {
    this.baseUrl=config.baseUrl.replace(/\/$/,''); this.key=config.key; this.fetcher=config.fetcher ?? fetch;
    if((config.environment ?? process.env.NODE_ENV)==='production' && !this.key) throw new Error('HERMES_SERVER_KEY is required in production');
  }
  private headers(){ if(!this.key) throw new Error('HERMES_SERVER_KEY is required to call Hermes'); return { Authorization:`Bearer ${this.key}`, 'Content-Type':'application/json' }; }
  async createRun(input:{input:string;sessionId:string;instructions:string}) {
    const response=await this.fetcher(`${this.baseUrl}/v1/runs`,{method:'POST',headers:this.headers(),body:JSON.stringify({input:input.input,session_id:input.sessionId,instructions:input.instructions})});
    if(!response.ok) throw new Error(`Hermes run submission failed (${response.status})`);
    const data=runStartSchema.parse(await response.json()); return {runId:data.run_id,status:data.status};
  }
  async getRun(runId:string){ const response=await this.fetcher(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}`,{headers:this.headers()}); if(!response.ok) throw new Error(`Hermes run lookup failed (${response.status})`); const data=runStatusSchema.parse(await response.json()); return {runId:data.run_id,status:data.status,sessionId:data.session_id,output:data.output,usage:data.usage}; }
  async stopRun(runId:string){ const response=await this.fetcher(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/stop`,{method:'POST',headers:this.headers()}); if(!response.ok) throw new Error(`Hermes stop failed (${response.status})`); return response.json(); }
}
