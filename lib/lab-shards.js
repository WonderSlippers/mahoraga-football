export const LAB_SHARD_FORMAT='simulation-lab-shards-v1';
export const LAB_SHARD_MAX_BYTES=1_900_000;
export const LAB_V1_KEY='simulation_lab_v1';
export const LAB_V2_KEY='simulation_lab_v2';
export const LAB_READ_SQL="SELECT key,payload,updated_at FROM app_state WHERE key='simulation_lab_v2' OR key LIKE 'simulation_lab_v2:%' OR (key='simulation_lab_v1' AND NOT EXISTS (SELECT 1 FROM app_state WHERE key='simulation_lab_v2'))";
const v2Absent="NOT EXISTS (SELECT 1 FROM app_state WHERE key='simulation_lab_v2')";
const leaseCurrent="EXISTS (SELECT 1 FROM app_state AS lease WHERE lease.key='scan_lock' AND json_extract(lease.payload,'$.token')=?)";
export const LAB_V1_INSERT_SQL=`INSERT INTO app_state(key,payload,updated_at) SELECT ?,?,? WHERE ${v2Absent} ON CONFLICT(key) DO NOTHING`;
export const LAB_V1_UPDATE_SQL=`UPDATE app_state SET payload=?,updated_at=? WHERE key=? AND updated_at=? AND ${v2Absent}`;
export const FENCED_LAB_V1_INSERT_SQL=`INSERT INTO app_state(key,payload,updated_at) SELECT ?,?,? WHERE ${v2Absent} AND ${leaseCurrent} ON CONFLICT(key) DO NOTHING`;
export const FENCED_LAB_V1_UPDATE_SQL=`UPDATE app_state SET payload=?,updated_at=? WHERE key=? AND updated_at=? AND ${v2Absent} AND ${leaseCurrent}`;
export const LAB_V2_COMMIT_GUARD_SQL=`SELECT CASE WHEN
  (? IS NULL OR EXISTS (SELECT 1 FROM app_state AS lease WHERE lease.key='scan_lock' AND json_extract(lease.payload,'$.token')=?))
  AND ((?='v1' AND NOT EXISTS (SELECT 1 FROM app_state WHERE key='simulation_lab_v2')
    AND ((?=0 AND NOT EXISTS (SELECT 1 FROM app_state WHERE key='simulation_lab_v1'))
      OR EXISTS (SELECT 1 FROM app_state WHERE key='simulation_lab_v1' AND updated_at=?)))
    OR (?='v2' AND EXISTS (SELECT 1 FROM app_state WHERE key='simulation_lab_v2' AND updated_at=?)))
  THEN 1 ELSE json_extract('invalid-lab-shard-commit','$') END AS allowed`;
const CHUNK_BYTES=600_000;
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const validId=id=>typeof id==='string'&&/^[a-z0-9-]{1,80}$/.test(id);

function checkedJson(value,label){
  const payload=JSON.stringify(value);
  if(!payload||encoder.encode(payload).byteLength>=LAB_SHARD_MAX_BYTES)throw new Error(`${label} exceeds safe D1 row limit`);
  return payload;
}

function chunksOf(json){
  const bytes=encoder.encode(json),parts=[];
  for(let start=0;start<bytes.length;){
    let end=Math.min(start+CHUNK_BYTES,bytes.length);
    if(end<bytes.length)while(end>start&&(bytes[end]&0xc0)===0x80)end--;
    if(end===start)throw new Error('invalid UTF-8 chunk boundary');
    parts.push(decoder.decode(bytes.subarray(start,end)));
    start=end;
  }
  return parts;
}

export function splitLab(lab){
  if(!lab||!Array.isArray(lab.portfolios)||!Number.isSafeInteger(lab.updatedAt))throw new Error('invalid simulation lab');
  const ids=lab.portfolios.map(portfolio=>portfolio?.id);
  if(ids.some(id=>!validId(id))||new Set(ids).size!==ids.length)throw new Error('invalid or duplicate portfolio id');
  const {portfolios,...meta}=lab;
  const portfolioIndex=Object.keys(lab).indexOf('portfolios');
  const manifest=[],shards=[];
  for(const portfolio of portfolios){
    if(!Array.isArray(portfolio.tickets))throw new Error(`portfolio ${portfolio.id} tickets malformed`);
    const parts=chunksOf(JSON.stringify(portfolio));
    manifest.push({id:portfolio.id,parts:parts.length});
    for(let index=0;index<parts.length;index++)shards.push({id:`${portfolio.id}:${index}`,payload:checkedJson({revision:lab.updatedAt,portfolioId:portfolio.id,index,chunk:parts[index]},`portfolio ${portfolio.id} part ${index}`)});
  }
  const root=checkedJson({format:LAB_SHARD_FORMAT,revision:lab.updatedAt,portfolioIndex,manifest,meta},'simulation lab root');
  return {root,shards};
}

export function joinLab(rootPayload,shardPayloads){
  const root=JSON.parse(rootPayload);
  if(root?.format!==LAB_SHARD_FORMAT||!Number.isSafeInteger(root.revision)||!Array.isArray(root.manifest)||!root.meta||root.meta.updatedAt!==root.revision||!Number.isInteger(root.portfolioIndex)||root.portfolioIndex<0||root.portfolioIndex>Object.keys(root.meta).length||Object.hasOwn(root.meta,'portfolios'))throw new Error('simulation lab root malformed');
  const ids=root.manifest.map(row=>row?.id);
  if(ids.some(id=>!validId(id))||new Set(ids).size!==ids.length||root.manifest.some(row=>!Number.isSafeInteger(row.parts)||row.parts<1||row.parts>10_000))throw new Error('simulation lab manifest malformed');
  const expected=new Set(root.manifest.flatMap(row=>Array.from({length:row.parts},(_,index)=>`${row.id}:${index}`)));
  const rows=new Map();
  for(const [id,payload] of shardPayloads){
    if(!expected.has(id))throw new Error(`unexpected simulation lab shard: ${id}`);
    if(rows.has(id))throw new Error('duplicate simulation lab shard');
    const shard=JSON.parse(payload);
    if(shard?.revision!==root.revision||`${shard.portfolioId}:${shard.index}`!==id||typeof shard.chunk!=='string')throw new Error(`simulation lab shard malformed: ${id}`);
    rows.set(id,shard.chunk);
  }
  if(rows.size!==expected.size)throw new Error('simulation lab shard missing or extra');
  const portfolios=root.manifest.map(row=>{
    const json=Array.from({length:row.parts},(_,index)=>rows.get(`${row.id}:${index}`)).join('');
    const portfolio=JSON.parse(json);
    if(portfolio?.id!==row.id||!Array.isArray(portfolio.tickets))throw new Error(`simulation lab portfolio malformed: ${row.id}`);
    return portfolio;
  });
  const entries=Object.entries(root.meta);
  entries.splice(root.portfolioIndex,0,['portfolios',portfolios]);
  return Object.fromEntries(entries);
}

export function restoreLabRows(rows){
  const byKey=new Map();
  for(const row of rows){
    if(byKey.has(row.key))throw new Error(`duplicate simulation lab row: ${row.key}`);
    byKey.set(row.key,row);
  }
  const root=byKey.get(LAB_V2_KEY);
  const shardRows=[...byKey.values()].filter(row=>row.key.startsWith(`${LAB_V2_KEY}:`));
  if(root){
    const revision=Number(root.updated_at);
    if(!Number.isSafeInteger(revision)||shardRows.some(row=>Number(row.updated_at)!==revision))throw new Error('simulation lab shard revision mismatch');
    const lab=joinLab(root.payload,shardRows.map(row=>[row.key.slice(LAB_V2_KEY.length+1),row.payload]));
    if(lab.updatedAt!==revision)throw new Error('simulation lab root revision mismatch');
    return {lab,revision,storage:'v2'};
  }
  if(shardRows.length)throw new Error('simulation lab shards without root');
  const legacy=byKey.get(LAB_V1_KEY);
  if(!legacy)return null;
  return {lab:JSON.parse(legacy.payload),revision:Number(legacy.updated_at),storage:'v1'};
}

/** @param {string|null} leaseToken */
export function prepareLabShardCommit(db,lab,expectedRevision,expectedStorage,leaseToken=null,now=Date.now()){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!['v1','v2'].includes(expectedStorage)||!Number.isSafeInteger(now)||now<0||lab?.updatedAt!==expectedRevision||leaseToken!==null&&(!leaseToken||typeof leaseToken!=='string'))throw new Error('invalid lab shard commit inputs');
  const revision=Math.max(now,expectedRevision+1);
  const nextLab={...lab,updatedAt:revision};
  const {root,shards}=splitLab(nextLab);
  const insert=db.prepare('INSERT INTO app_state(key,payload,updated_at) VALUES (?,?,?)');
  const statements=[
    db.prepare(LAB_V2_COMMIT_GUARD_SQL).bind(leaseToken,leaseToken,expectedStorage,expectedRevision,expectedRevision,expectedStorage,expectedRevision),
    db.prepare("DELETE FROM app_state WHERE key LIKE 'simulation_lab_v2:%'"),
    ...shards.map(row=>insert.bind(`${LAB_V2_KEY}:${row.id}`,row.payload,revision)),
    db.prepare("INSERT INTO app_state(key,payload,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(LAB_V2_KEY,root,revision),
  ];
  return {nextLab,revision,statements,shardCount:shards.length};
}
