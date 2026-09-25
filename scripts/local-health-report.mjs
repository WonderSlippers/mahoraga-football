import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {summarizeLocalHealth} from './local-health-report-policy.mjs';
import {summarizeHealthHistory} from './local-health-history.mjs';
import {readLocalLab} from './local-lab-reader.mjs';

// Read-only local evidence. No HTTP fetch, scheduled-task action, D1 write,
// process signal, migration, or remote request occurs in this command.
const root=fileURLToPath(new URL('../',import.meta.url));
const stateRoot=path.resolve(root,'../football-live-site/.wrangler/state');
const d1Directory=path.join(stateRoot,'v3','d1','miniflare-D1DatabaseObject');
const runtimeDir=path.join(root,'.sites-runtime');
const backupDir=path.join(root,'.local-backups');

function listener(){
  if(process.platform!=='win32')return {listening:false,error:'本工具仅支持当前 Windows 本机环境'};
  const script='$edgeConnection=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -eq "127.0.0.1"} | Select-Object -First 1; if(!$edgeConnection){[pscustomobject]@{listening=$false}|ConvertTo-Json -Compress;exit 0}; $edgeProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($edgeConnection.OwningProcess)"; $edgeParent=Get-CimInstance Win32_Process -Filter "ProcessId=$($edgeProcess.ParentProcessId)"; $edgeMemory=Get-Process -Id $edgeProcess.ProcessId -ErrorAction SilentlyContinue; [pscustomobject]@{listening=$true;pid=$edgeProcess.ProcessId;parentCommand=$edgeParent.CommandLine;privateBytes=$edgeMemory.PrivateMemorySize64}|ConvertTo-Json -Compress';
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:20_000});
  if(result.status!==0)throw new Error(`本机监听检查失败：${String(result.stderr||result.error||result.status).slice(0,200)}`);
  const data=JSON.parse(result.stdout);
  const found=String(data.parentCommand||'').match(/dist-next-(\d+)[\\/]server[\\/]wrangler\.json/i);
  return {listening:!!data.listening,pid:Number(data.pid)||null,version:found?`dist-next-${found[1]}`:null,versionNumber:found?Number(found[1]):null,privateBytes:Number.isSafeInteger(Number(data.privateBytes))?Number(data.privateBytes):null};
}
function candidate(){
  const source=readFileSync(path.join(root,'scripts','local-server-launch.mjs'),'utf8');
  const found=source.match(/const newConfig=path\.join\(root,'dist-next-(\d+)'/);
  return found?{version:`dist-next-${found[1]}`,number:Number(found[1])}:{version:null,number:null};
}
function dbFile(){
  const expected=realpathSync(d1Directory);
  const files=readdirSync(expected).filter(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite').map(name=>path.join(expected,name)).filter(file=>statSync(file).isFile());
  if(files.length!==1)throw new Error(`活动 D1 路径不唯一或不存在：${files.length} 个 SQLite 文件`);
  const resolved=realpathSync(files[0]);
  if(path.dirname(resolved).toLowerCase()!==expected.toLowerCase())throw new Error('活动 D1 路径越界');
  return resolved;
}
function readDatabase(){
  const file=dbFile(),db=new DatabaseSync(file,{readOnly:true});
  try{
    db.exec('PRAGMA query_only=ON; BEGIN');
    const checks=db.prepare('PRAGMA quick_check').all();
    const quickCheck=checks.length===1?String(Object.values(checks[0])[0]):'failed';
    const rows=db.prepare("SELECT key,payload,updated_at FROM app_state WHERE key IN ('sim_state','sim_settings','scan_progress_v1')").all();
    const byKey=new Map(rows.map(row=>[row.key,row]));
    const parse=key=>byKey.has(key)?JSON.parse(byKey.get(key).payload):null;
    const stored=readLocalLab(db),lab=stored.lab,personal=parse('sim_state'),settings=parse('sim_settings'),progress=parse('scan_progress_v1');
    if(!Array.isArray(lab?.portfolios)||!Array.isArray(personal?.records))throw new Error('活动账本缺少必要字段');
    const counts={open:0,review:0,win:0,loss:0,void:0};
    for(const portfolio of lab.portfolios){if(!Array.isArray(portfolio.tickets))throw new Error('策略票据结构无效');for(const ticket of portfolio.tickets){if(!Object.hasOwn(counts,ticket.status))throw new Error(`未知票据状态 ${ticket.status}`);counts[ticket.status]++;}}
    const result={file,quickCheck,portfolios:lab.portfolios.length,tickets:Object.values(counts).reduce((a,b)=>a+b,0),counts,personalTickets:personal.records.length,personalBalance:personal.balance,autoStake:settings?.autoStake,autoEnabled:settings?.autoEnabled,lastScanAt:Number(lab.lastScanAt)||null,scanProgress:progress?{id:progress.id,status:progress.status,stage:progress.stage,updatedAt:progress.updatedAt,errors:progress.errors}:null,ledgerUpdatedAt:stored.revision,ledgerStorage:stored.storage};
    db.exec('COMMIT');
    return result;
  }finally{db.close();}
}
function lastEvents(filename){
  if(!existsSync(filename))return {lastOk:null,lastFailure:null,lastLine:null};
  const lines=readFileSync(filename,'utf8').trim().split(/\r?\n/).slice(-2000);
  const find=predicate=>{for(let i=lines.length-1;i>=0;i--)if(predicate(lines[i]))return{at:lines[i].split(' ')[0],line:lines[i].slice(0,500)};return null;};
  return {lastOk:find(line=>/\sSCAN_OK\b/.test(line)),lastFailure:find(line=>/\s(SCAN_FAILED|RUNNER_ERROR|AUDIT_FAILED)\b/.test(line)),lastLine:lines.at(-1)||null};
}
const report={kind:'edge-local-health-v1',runtime:null,candidate:null,ledger:null,scanTask:null,watchdog:null,summary:null,history:null};
for(const [key,read] of [
  ['runtime',listener],['candidate',candidate],['ledger',readDatabase],
  ['scanTask',()=>lastEvents(path.join(runtimeDir,'local-scan.log'))],
  ['watchdog',()=>lastEvents(path.join(runtimeDir,'local-health.log'))],
]){
  try{report[key]=read();}catch(error){report[key]={error:String(error?.message||error)};}
}
report.summary=summarizeLocalHealth({runtime:report.runtime,ledger:report.ledger,scanLog:report.scanTask,candidate:report.candidate});
// Historical snapshots are optional evidence. Ignore malformed or oversized
// files rather than letting an old report prevent a fresh read-only check.
const history=[];
if(existsSync(backupDir))for(const name of readdirSync(backupDir).filter(name=>/^health-report-.*\.json$/.test(name)).sort().slice(-96)){
  const filename=path.join(backupDir,name);
  try{if(statSync(filename).size<=100_000)history.push(JSON.parse(readFileSync(filename,'utf8')));}catch{}
}
report.history=summarizeHealthHistory(history,report);
const outputIndex=process.argv.indexOf('--out'),archive=process.argv.includes('--archive');
if(archive&&outputIndex>=0)throw new Error('--archive 与 --out 不能同时使用');
const outputFilename=archive?path.join(backupDir,`health-report-${report.summary.checkedAt.replace(/\D/g,'').slice(0,17)}.json`):
  outputIndex>=0?process.argv[outputIndex+1]:null;
if(outputIndex>=0&&!outputFilename)throw new Error('--out 需要目标文件路径');
if(outputFilename)writeFileSync(outputFilename,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({state:report.summary.state,version:report.runtime?.version,candidate:report.candidate?.version,privateMiB:Number.isSafeInteger(report.runtime?.privateBytes)?Math.round(report.runtime.privateBytes/1048576):null,history:report.history,quickCheck:report.ledger?.quickCheck,tickets:report.ledger?.tickets,counts:report.ledger?.counts,lastScanOk:report.summary.evidence.scanLastTaskOkAt,alerts:report.summary.alerts,output:outputFilename})+'\n');
if(report.summary.state==='critical')process.exitCode=2;
