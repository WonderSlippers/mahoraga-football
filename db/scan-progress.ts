import {env} from 'cloudflare:workers';
import {advanceScanProgress} from '@/lib/scan-progress-policy';
import {ADVANCE_SCAN_PROGRESS_SQL,CLAIM_SCAN_PROGRESS_SQL,nextScanRevision} from '@/lib/scan-progress-claim';
import {FINALIZE_SCAN_GUARD_SQL,FINALIZE_SCAN_LEDGER_SQL,FINALIZE_SCAN_PROGRESS_SQL} from '@/lib/scan-finalize-sql';

const KEY='scan_progress_v1';
export type ScanProgress={id:string;startedAt:number;updatedAt:number;stage:string;status:'running'|'partial'|'complete';selectedLeagues:string[];errors:string[]};
const database=()=>{if(!env.DB)throw new Error('D1 binding DB is unavailable');return env.DB;};

export async function readScanProgress():Promise<ScanProgress|null>{
  const row=await database().prepare('SELECT payload FROM app_state WHERE key=?').bind(KEY).first<{payload:string}>();
  if(!row)return null;
  const value=JSON.parse(row.payload) as ScanProgress;
  if(!value || typeof value.id!=='string' || !Array.isArray(value.errors))throw new Error('scan progress malformed');
  return value;
}

async function recordIncident(value:ScanProgress){
  await database().prepare('INSERT INTO app_state (key,payload,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING')
    .bind(`scan_incident:${value.id}`,JSON.stringify(value),value.updatedAt).run();
}

export async function beginScanProgress(id:string,selectedLeagues:string[],leaseToken:string){
  if(!leaseToken)throw new Error('scan lease token missing');
  const row=await database().prepare('SELECT payload,updated_at FROM app_state WHERE key=?').bind(KEY).first<{payload:string;updated_at:number}>();
  const previous=row?JSON.parse(row.payload) as ScanProgress:null;
  if(previous&&(!previous.id||!Array.isArray(previous.errors)))throw new Error('scan progress malformed');
  const now=Date.now();
  const staleBefore=now-15*60_000;
  const stamp=nextScanRevision(now,row?.updated_at??0);
  const value:ScanProgress={id,startedAt:now,updatedAt:stamp,stage:'prepared',status:'running',selectedLeagues:selectedLeagues.slice(0,16),errors:[]};
  const claimed=await database().prepare(CLAIM_SCAN_PROGRESS_SQL)
    .bind(KEY,JSON.stringify(value),stamp,leaseToken,row?.updated_at??0,staleBefore,leaseToken).run();
  if(Number(claimed.meta.changes)!==1)return false;
  if(previous && previous.status!=='complete')await recordIncident(previous).catch(error=>console.error('scan_progress_incident_record_failed',String(error)));
  return true;
}

export async function markScanProgress(id:string,stage:string,leaseToken:string,error=''){
  if(!leaseToken)throw new Error('scan lease token missing');
  for(let attempt=0;attempt<3;attempt++){
    const row=await database().prepare('SELECT payload,updated_at FROM app_state WHERE key=?').bind(KEY).first<{payload:string;updated_at:number}>();
    if(!row)throw new Error('scan progress missing');
    const current=JSON.parse(row.payload) as ScanProgress;
    if(current.id!==id)throw new Error('scan progress owner changed');
    const updatedAt=Math.max(Date.now(),row.updated_at+1);
    const value={...advanceScanProgress(current,stage,error),updatedAt} as ScanProgress;
    const result=await database().prepare(ADVANCE_SCAN_PROGRESS_SQL)
      .bind(JSON.stringify(value),updatedAt,KEY,row.updated_at,leaseToken).run();
    if(Number(result.meta.changes)===1){
      if(value.status==='partial' && stage==='complete')await recordIncident(value);
      return value;
    }
  }
  throw new Error('scan progress concurrent update');
}

export function prepareScanFinalizationStatements(db:D1Database,row:{payload:string;updated_at:number},id:string,leaseToken:string,state:unknown,expectedLedgerRevision:number,nextLedgerRevision:number,stage:'odds'|'prepared'='odds',error=''){
  if(!leaseToken)throw new Error('scan lease token missing');
  const current=JSON.parse(row.payload) as ScanProgress;
  if(current.id!==id||current.stage!==stage)throw new Error('scan progress not ready to finalize');
  const revision=nextScanRevision(Date.now(),row.updated_at);
  const ready=stage==='odds'?advanceScanProgress(current,'ledger'):advanceScanProgress(current,'prepared',error);
  const progress={...advanceScanProgress(ready,'complete'),updatedAt:revision} as ScanProgress;
  const statements=[
    db.prepare(FINALIZE_SCAN_GUARD_SQL).bind(leaseToken,row.updated_at,id,stage,expectedLedgerRevision,expectedLedgerRevision),
    db.prepare(FINALIZE_SCAN_LEDGER_SQL).bind(JSON.stringify(state),nextLedgerRevision,expectedLedgerRevision,expectedLedgerRevision),
    db.prepare(FINALIZE_SCAN_PROGRESS_SQL).bind(JSON.stringify(progress),revision,row.updated_at,id),
  ];
  if(progress.status==='partial')statements.push(db.prepare('INSERT INTO app_state (key,payload,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING').bind(`scan_incident:${id}`,JSON.stringify(progress),revision));
  return {progress,statements};
}

export async function finalizeScanWithLedger(id:string,leaseToken:string,state:unknown,expectedLedgerRevision:number,nextLedgerRevision:number,stage:'odds'|'prepared'='odds',error=''){
  const db=database();
  const row=await db.prepare('SELECT payload,updated_at FROM app_state WHERE key=?').bind(KEY).first<{payload:string;updated_at:number}>();
  if(!row)throw new Error('scan progress missing');
  const {progress,statements}=prepareScanFinalizationStatements(db,row,id,leaseToken,state,expectedLedgerRevision,nextLedgerRevision,stage,error);
  const results=await db.batch(statements);
  if(Number(results[1].meta.changes)!==1||Number(results[2].meta.changes)!==1)throw new Error('scan finalization CAS changed unexpectedly');
  return progress;
}

export async function readScanIncidents(){
  const result=await database().prepare("SELECT payload FROM app_state WHERE key LIKE 'scan_incident:%' ORDER BY updated_at DESC LIMIT 20").all<{payload:string}>();
  return result.results.map(row=>JSON.parse(row.payload) as ScanProgress);
}
