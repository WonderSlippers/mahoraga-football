import {spawn,spawnSync} from 'node:child_process';
import {connect} from 'node:net';
import {appendFileSync,cpSync,existsSync,mkdirSync,mkdtempSync,openSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Runs only when the existing user-owned login task starts. Never kills a
// listener, never publishes remotely, and never restores/rewrites the ledger.
const root=fileURLToPath(new URL('../',import.meta.url));
const stateDir=process.env.MAHORAGA_D1_STATE_DIR?.trim();
if(!stateDir)throw new Error('MAHORAGA_D1_STATE_DIR is required for the local launcher');
const runtime=path.join(root,'.sites-runtime');
const backupRoot=path.join(root,'.local-backups');
const backupMarker=path.join(runtime,'prospective-upgrade-backup.json');
const logFile=path.join(runtime,'local-server-launch.log');
// The candidate is immutable; the running listener is never hot-swapped.
const newConfig=path.join(root,'dist-next-56','server','wrangler.json');
const oldConfig=path.join(root,'dist-next-55','server','wrangler.json');
mkdirSync(runtime,{recursive:true});
function log(message){appendFileSync(logFile,`${new Date().toISOString()} ${message.slice(0,800)}\n`);}
function portOpen(){return new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port:5173});const finish=value=>{socket.destroy();resolve(value);};socket.setTimeout(2500);socket.once('connect',()=>finish(true));socket.once('timeout',()=>finish(false));socket.once('error',()=>finish(false));});}
function backupOnce(){
  try{const marker=JSON.parse(readFileSync(backupMarker,'utf8'));if(typeof marker.path==='string'&&marker.path.startsWith(backupRoot+path.sep)&&existsSync(marker.path))return marker.path;}catch{}
  if(!existsSync(stateDir)||!statSync(stateDir).isDirectory())throw new Error('原始本地 D1 状态目录不存在，拒绝自动迁移');
  mkdirSync(backupRoot,{recursive:true});
  const target=mkdtempSync(path.join(backupRoot,'before-model-'));
  if(!target.startsWith(backupRoot+path.sep))throw new Error('备份路径不在限定目录');
  cpSync(stateDir,target,{recursive:true,errorOnExist:false,force:false});
  writeFileSync(backupMarker,JSON.stringify({path:target,createdAt:Date.now(),source:stateDir}));
  log(`BACKUP_OK ${target}`);
  return target;
}
function migrate(){
  backupOnce();
  const args=['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','site-creator-d1','--local','--config','wrangler.local.jsonc','--persist-to',stateDir,'--file','drizzle/0004_yielding_liz_osborn.sql','--yes'];
  const result=spawnSync(process.execPath,args,{cwd:root,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
  if(result.status!==0)throw new Error(`D1 追加表迁移失败：${String(result.stderr||result.stdout||result.error||'unknown').slice(-500)}`);
  log('MIGRATION_OK model_forecasts/model_outcomes additive SQL');
}
async function launch(config,label){
  if(await portOpen()){log(`PORT_OCCUPIED before ${label}; no takeover`);return;}
  const args=['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','dev','--config',config,'--local','--persist-to',stateDir,'--ip','127.0.0.1','--inspector-port','0','--port','5173'];
  const fd=openSync(logFile,'a');
  const startedAt=Date.now();
  const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore',fd,fd]});
  log(`START_${label} pid=${child.pid||'unknown'}`);
  const code=await new Promise(resolve=>{child.once('exit',code=>resolve(code));child.once('error',error=>{log(`SPAWN_${label}_ERROR ${error.message}`);resolve(-1);});});
  log(`EXIT_${label} code=${code}`);
  return Date.now()-startedAt;
}
if(await portOpen()){log('PORT_ALREADY_OWNED; no server started');process.exit(0);}
let newUptime=0;
if(existsSync(newConfig)){
  try{migrate();newUptime=await launch(newConfig,'NEW');}
  catch(error){log(`NEW_PRESTART_FAILED ${String(error?.message||error)}`);}
}
// A long-running new server should be restarted as new by the watchdog;
// fall back only for immediate startup/migration failures.
if(newUptime<120000&&existsSync(oldConfig)&&!(await portOpen()))await launch(oldConfig,'OLD_FALLBACK');
