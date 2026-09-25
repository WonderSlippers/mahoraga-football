import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,statSync,statfsSync,writeSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// All live reads are query-only. Archives are additive local files; this tool
// never deletes quote rows, modifies the live D1, or serves old prices as live.
const root=fileURLToPath(new URL('../',import.meta.url));
const archiveDir=path.join(root,'.local-backups','odds-archives');
const stateDir=path.resolve(root,'../football-live-site/.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const tables=[
  {name:'odds_snapshots',time:'captured_at',columns:['id','match_id','league_code','captured_at','home_odds','draw_odds','away_odds','provider'],sql:'CREATE TABLE odds_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,match_id TEXT NOT NULL,league_code TEXT NOT NULL,captured_at INTEGER NOT NULL,home_odds REAL,draw_odds REAL,away_odds REAL,provider TEXT NOT NULL)'},
  {name:'market_quotes',time:'captured_at',columns:['id','match_id','league_code','home','away','kickoff_at','captured_at','market','line','over_odds','under_odds','provider','phase','source_url'],sql:'CREATE TABLE market_quotes(id TEXT PRIMARY KEY NOT NULL,match_id TEXT NOT NULL,league_code TEXT NOT NULL,home TEXT NOT NULL,away TEXT NOT NULL,kickoff_at INTEGER NOT NULL,captured_at INTEGER NOT NULL,market TEXT NOT NULL,line REAL NOT NULL,over_odds REAL NOT NULL,under_odds REAL NOT NULL,provider TEXT NOT NULL,phase TEXT NOT NULL,source_url TEXT NOT NULL)'},
  {name:'market_results',time:'observed_at',columns:['id','match_id','league_code','observed_at','state','home_score','away_score','detail','source_url','fingerprint'],sql:'CREATE TABLE market_results(id TEXT PRIMARY KEY NOT NULL,match_id TEXT NOT NULL,league_code TEXT NOT NULL,observed_at INTEGER NOT NULL,state TEXT NOT NULL,home_score INTEGER,away_score INTEGER,detail TEXT NOT NULL,source_url TEXT NOT NULL,fingerprint TEXT NOT NULL)'},
];
const schemaHash=createHash('sha256').update(JSON.stringify(tables)).digest('hex');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function previousMonthWindow(now=Date.now()){
  // The task runs at 03:15 Asia/Shanghai, still the prior UTC day. Boundaries
  // therefore follow the local calendar, stored as absolute UTC timestamps.
  const offset=8*3600000,date=new Date(now+offset);
  const to=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)-offset;
  const from=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-1,1)-offset;
  const month=new Date(from+offset).toISOString().slice(0,7).replace('-','');
  return {from,to,mode:'month-'+month};
}
function liveFile(){
  const directory=realpathSync(stateDir);
  const files=readdirSync(directory).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite');
  if(files.length!==1)throw new Error('活动 D1 文件不唯一');
  const file=realpathSync(path.join(directory,files[0]));
  if(path.dirname(file).toLowerCase()!==directory.toLowerCase())throw new Error('活动 D1 路径越界');
  return file;
}
function sourceSchema(db){
  for(const table of tables){
    const actual=db.prepare('PRAGMA table_info('+quote(table.name)+')').all().map(row=>row.name);
    if(JSON.stringify(actual)!==JSON.stringify(table.columns))throw new Error(table.name+' schema 与归档契约不一致');
  }
}
function assertSpace(sourceFile,dir){
  const fs=statfsSync(dir,{bigint:true});
  const free=fs.bavail*fs.bsize;
  if(free<BigInt(statSync(sourceFile).size)*6n)throw new Error('归档目标剩余空间不足安全预算');
  return Number(free);
}
function checkedManifest(name,dir=archiveDir){
  if(!name||path.basename(name)!==name||!/^odds-(baseline|month-\d{6})-\d{17}\.manifest\.json$/.test(name))throw new Error('归档文件名无效');
  const manifest=JSON.parse(readFileSync(path.join(dir,name),'utf8'));
  if(manifest.kind!=='edge-odds-archive-v1'||manifest.schemaHash!==schemaHash||manifest.dataFile!==name.replace('.manifest.json','.ndjson'))throw new Error('归档清单无效或 schema 不匹配');
  return manifest;
}
export function archiveOdds(db,sourceFile,mode,from,to,at=Date.now(),dir=archiveDir){
  mkdirSync(dir,{recursive:true});
  const freeBytes=assertSpace(sourceFile,dir);
  const stamp=new Date(at).toISOString().replace(/\D/g,'').slice(0,17);
  const stem='odds-'+mode+'-'+stamp;
  const dataFile=stem+'.ndjson',manifestFile=stem+'.manifest.json';
  const dataPath=path.join(dir,dataFile),manifestPath=path.join(dir,manifestFile);
  if(existsSync(dataPath)||existsSync(manifestPath))throw new Error('归档名已存在，不覆盖');
  let fd;
  const counts={};
  const hash=createHash('sha256');
  try{
    fd=openSync(dataPath,'wx');
    db.exec('PRAGMA query_only=ON; BEGIN');
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('活动 D1 quick_check 未通过');
    sourceSchema(db);
    for(const table of tables){
      counts[table.name]=0;
      const sql='SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.name)+' WHERE '+quote(table.time)+' >= ? AND '+quote(table.time)+' < ? ORDER BY '+quote('id');
      for(const row of db.prepare(sql).iterate(from,to)){
        const line=JSON.stringify({table:table.name,row})+'\n';
        const bytes=Buffer.from(line);
        for(let offset=0;offset<bytes.length;){
          const written=writeSync(fd,bytes,offset,bytes.length-offset);
          if(written<=0)throw new Error('归档文件未能完整写入');
          offset+=written;
        }
        hash.update(bytes);counts[table.name]++;
      }
    }
    db.exec('COMMIT');
    fsyncSync(fd);closeSync(fd);fd=null;
    const manifest={kind:'edge-odds-archive-v1',createdAt:new Date(at).toISOString(),mode,from,to,sourceFile,sourceBytes:statSync(sourceFile).size,freeBytesBefore:freeBytes,schemaHash,dataFile,dataSha256:hash.digest('hex'),dataBytes:statSync(dataPath).size,counts};
    writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    verifyArchive(manifestFile,dir);
    return {manifestFile,manifest};
  }catch(error){
    try{db.exec('ROLLBACK')}catch{}
    if(fd!==undefined&&fd!==null)closeSync(fd);
    throw error;
  }
}
export function verifyArchive(name,dir=archiveDir){
  const manifest=checkedManifest(name,dir),bytes=readFileSync(path.join(dir,manifest.dataFile));
  if(bytes.length!==manifest.dataBytes||sha(bytes)!==manifest.dataSha256)throw new Error('归档数据长度或 SHA256 不匹配');
  const rows=bytes.toString('utf8').trimEnd().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const counts=Object.fromEntries(tables.map(table=>[table.name,0]));
  for(const entry of rows){
    const table=tables.find(item=>item.name===entry.table);
    if(!table||JSON.stringify(Object.keys(entry.row))!==JSON.stringify(table.columns)||!Number.isSafeInteger(entry.row[table.time])||entry.row[table.time]<manifest.from||entry.row[table.time]>=manifest.to)throw new Error('归档行不符合契约');
    counts[table.name]++;
  }
  if(JSON.stringify(counts)!==JSON.stringify(manifest.counts))throw new Error('归档计数不匹配');
  return {manifest,rows};
}
export function restoreArchive(name,dir=archiveDir){
  const {rows}=verifyArchive(name,dir);
  const file=path.join(dir,name.replace('.manifest.json','.restored.sqlite'));
  if(existsSync(file))throw new Error('隔离恢复文件已存在，不覆盖');
  const db=new DatabaseSync(file);
  try{
    db.exec('BEGIN');
    for(const table of tables)db.exec(table.sql);
    const inserts=Object.fromEntries(tables.map(table=>[table.name,db.prepare('INSERT INTO '+quote(table.name)+'('+table.columns.map(quote).join(',')+') VALUES ('+table.columns.map(()=>'?').join(',')+')')]));
    for(const {table,row} of rows)inserts[table].run(...tables.find(item=>item.name===table).columns.map(column=>row[column]));
    db.exec('COMMIT');
  }finally{db.close()}
  return auditRestoredArchive(name,dir);
}
export function auditRestoredArchive(name,dir=archiveDir){
  const {manifest}=verifyArchive(name,dir);
  const file=path.join(dir,name.replace('.manifest.json','.restored.sqlite'));
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON; BEGIN');
    const counts=Object.fromEntries(tables.map(table=>[table.name,db.prepare('SELECT COUNT(*) AS n FROM '+quote(table.name)).get().n]));
    const restoredHash=createHash('sha256');
    for(const table of tables)for(const row of db.prepare('SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.name)+' ORDER BY '+quote('id')).iterate())
      restoredHash.update(JSON.stringify({table:table.name,row})+'\n');
    const verifiedHash=restoredHash.digest('hex');
    const quickCheck=db.prepare('PRAGMA quick_check').get().quick_check;
    db.exec('COMMIT');
    if(JSON.stringify(counts)!==JSON.stringify(manifest.counts)||quickCheck!=='ok'||verifiedHash!==manifest.dataSha256)throw new Error('隔离恢复计数、内容或完整性校验失败');
    return {file,counts,quickCheck,sourceHash:manifest.dataSha256,restoredHash:verifiedHash};
  }finally{db.close()}
}
export function queryArchive(name,league,matchId,limit=360,dir=archiveDir){
  if(!league||!matchId||!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('查询参数无效');
  const {rows}=verifyArchive(name,dir);
  return rows.filter(item=>item.row.league_code===league&&item.row.match_id===matchId)
    .sort((a,b)=>(b.row.captured_at??b.row.observed_at)-(a.row.captured_at??a.row.observed_at))
    .slice(0,limit);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const command=process.argv[2];
  if(command==='snapshot'||command==='previous-month'){
    const {from,to,mode}=command==='snapshot'?{from:0,to:Date.now()+1,mode:'baseline'}:previousMonthWindow();
    const file=liveFile(),db=new DatabaseSync(file,{readOnly:true});
    try{process.stdout.write(JSON.stringify(archiveOdds(db,file,mode,from,to))+'\n')}finally{db.close()}
  }else if(command==='verify')process.stdout.write(JSON.stringify(verifyArchive(process.argv[3]).manifest)+'\n');
  else if(command==='restore')process.stdout.write(JSON.stringify(restoreArchive(process.argv[3]))+'\n');
  else if(command==='audit-restored')process.stdout.write(JSON.stringify(auditRestoredArchive(process.argv[3]))+'\n');
  else if(command==='query')process.stdout.write(JSON.stringify(queryArchive(process.argv[3],process.argv[4],process.argv[5]))+'\n');
  else throw new Error('用法：snapshot | previous-month | verify <manifest> | restore <manifest> | audit-restored <manifest> | query <manifest> <league> <matchId>');
}
