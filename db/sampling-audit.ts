import {env} from 'cloudflare:workers';
import {summarizeSamplingRun} from '@/lib/sampling-audit-policy';

type Match=Parameters<typeof summarizeSamplingRun>[4][number];
type Observations=Parameters<typeof summarizeSamplingRun>[5];
export type SamplingAudit=ReturnType<typeof summarizeSamplingRun>;
const database=()=>{if(!env.DB)throw new Error('D1 binding DB is unavailable');return env.DB;};

export function prepareSamplingAuditStatement(db:D1Database,id:string,capturedAt:number,selectedLeagues:string[],failedLeagues:string[],matches:Match[],observations:Observations){
  const value=summarizeSamplingRun(id,capturedAt,selectedLeagues,failedLeagues,matches,observations);
  const statement=db.prepare('INSERT INTO app_state (key,payload,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING')
    .bind(`sampling_run:${id}`,JSON.stringify(value),capturedAt);
  return {value,statement};
}

export async function recordSamplingAudit(id:string,capturedAt:number,selectedLeagues:string[],failedLeagues:string[],matches:Match[],observations:Observations){
  const {value,statement}=prepareSamplingAuditStatement(database(),id,capturedAt,selectedLeagues,failedLeagues,matches,observations);
  const result=await statement.run();
  return {recorded:Number(result.meta.changes)===1,...value};
}

export async function readLatestSamplingAudit():Promise<SamplingAudit|null>{
  const row=await database().prepare("SELECT payload FROM app_state WHERE key LIKE 'sampling_run:%' ORDER BY updated_at DESC LIMIT 1").first<{payload:string}>();
  if(!row)return null;
  const value=JSON.parse(row.payload) as SamplingAudit;
  if(!value||typeof value.id!=='string'||!Number.isSafeInteger(value.capturedAt))throw new Error('sampling audit malformed');
  return value;
}
