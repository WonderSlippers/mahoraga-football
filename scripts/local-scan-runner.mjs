import {appendFileSync,existsSync,mkdirSync,renameSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {recognizedLocalBuild,scanDue,scanMemorySafe} from './local-scan-policy.mjs';
import {auditLabTransition,openDuplicateDirections} from './local-scan-audit.mjs';

// Invoked invisibly by a user-owned scheduled task. It cannot start, stop,
// rebuild, publish, or take over any listener, and never touches real wagers.
const root=fileURLToPath(new URL('../',import.meta.url));
const runtime=path.join(root,'.sites-runtime');
const logFile=path.join(runtime,'local-scan.log');
const base='http://127.0.0.1:5173';
function listenerPrivateBytes(){
  if(process.platform!=='win32')return null;
  const script='$edgeConnection=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalAddress -eq "127.0.0.1"} | Select-Object -First 1; if(!$edgeConnection){exit 2}; $edgeProcess=Get-Process -Id $edgeConnection.OwningProcess -ErrorAction SilentlyContinue; if(!$edgeProcess){exit 3}; [Console]::Out.Write($edgeProcess.PrivateMemorySize64)';
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:1024});
  if(result.status!==0)return null;
  const value=Number(result.stdout.trim());
  return Number.isSafeInteger(value)?value:null;
}
function log(message){
  mkdirSync(runtime,{recursive:true});
  if(existsSync(logFile)&&statSync(logFile).size>1024*1024)renameSync(logFile,path.join(runtime,'local-scan.previous.log'));
  appendFileSync(logFile,`${new Date().toISOString()} ${message.slice(0,500)}\n`);
}
async function json(pathname,options={}){
  // A full 65-league scan has taken over six minutes on this machine. Keep
  // the runner alive through the server response so it can audit the ledger.
  const write=options.method==='POST',attempts=write?1:3;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      const response=await fetch(base+pathname,{cache:'no-store',signal:AbortSignal.timeout(write?720000:15000),...options});
      const data=await response.json().catch(()=>null);
      return {status:response.status,data};
    }catch(error){
      if(attempt===attempts)throw new Error(`${write?'POST':'GET'} ${pathname} failed after ${attempts} attempt(s): ${String(error?.message||error)}`);
      await new Promise(resolve=>setTimeout(resolve,1000*attempt));
    }
  }
}
async function run(){
  const ready=await json('/api/local-runner-ready');
  if(!recognizedLocalBuild(ready.status,ready.data))return;
  if(ready.data.runnerProtocol==='prospective-scan-v4'){
    // The full sweep remains disabled after its heap failure. The focused
    // paper-price pass is bounded to one verified fixture and is idempotent.
    const privateBytes=listenerPrivateBytes();
    if(!scanMemorySafe(privateBytes)){
      log(`PAPER_SCAN_PAUSED_MEMORY privateMB=${Number.isSafeInteger(privateBytes)?Math.round(privateBytes/1048576):'unknown'}; listener untouched`);
      process.exitCode=1;return;
    }
    const result=await json('/api/public-paper-scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'401861048'})});
    if(result.status===404||result.status===410)return;
    if(result.status!==200||result.data?.ok!==true){log(`PAPER_SCAN_FAILED status=${result.status} reason=${String(result.data?.error||'unknown')}`);process.exitCode=1;return;}
    if(result.data.created)log(`PAPER_SCAN_OK match=${result.data.matchId} provider=${result.data.provider} odds=${result.data.assumedPrice} id=${result.data.id}`);
    return;
  }
  // The v3 65-league scan exhausted the local server heap and took 5173 down.
  // Keep the task installed but do not submit another write until a bounded
  // scan build advertises v5 after a safe, listener-free recovery.
  if(ready.data.runnerProtocol!=='prospective-scan-v5')return;
  const privateBytes=listenerPrivateBytes();
  if(!scanMemorySafe(privateBytes)){
    log(`SCAN_PAUSED_MEMORY privateMB=${Number.isSafeInteger(privateBytes)?Math.round(privateBytes/1048576):'unknown'}; no write; listener untouched`);
    process.exitCode=1;return;
  }
  const meta=await json('/api/lab?meta=1');
  if(meta.status!==200||meta.data?.ok!==true){log('LAB_META_UNAVAILABLE; scan skipped');process.exitCode=1;return;}
  if(!scanDue(meta.status,meta.data,Date.now()))return;
  const beforeLab=await json('/api/lab'),beforeLedger=await json('/api/ledger');
  if(beforeLab.status!==200||beforeLab.data?.ok!==true||beforeLedger.status!==200||beforeLedger.data?.ok!==true){log('PRE_SCAN_AUDIT_UNAVAILABLE; scan skipped');process.exitCode=1;return;}
  const duplicates=openDuplicateDirections(beforeLab.data.lab);
  if(duplicates.length&&ready.data.runnerProtocol!=='prospective-scan-v3'){
    log(`PRE_SCAN_DUPLICATES ${duplicates.slice(0,5).join(' | ')}; scan skipped until repair-capable build is active`);process.exitCode=2;return;
  }
  log(`SCAN_START lastScanAt=${meta.data.lastScanAt} tickets=${beforeLab.data.lab.portfolios.reduce((n,p)=>n+p.tickets.length,0)}`);
  const scan=await json('/api/scan',{method:'POST'});
  if(scan.status===202&&scan.data?.activeScan){log('SCAN_IN_PROGRESS another local scan holds the lease');return;}
  if(scan.data?.commitStatus==='committed-unverified'){
    log(`SCAN_COMMIT_UNVERIFIED batch=${scan.data.scanBatchId||'unknown'}; inspect progress and both ledgers before accepting or retrying`);
    process.exitCode=2;return;
  }
  if(scan.status!==200||scan.data?.ok!==true||scan.data?.labHealthy!==true||scan.data?.modelObservations?.error){
    log(`SCAN_FAILED status=${scan.status} reason=${String(scan.data?.error||scan.data?.modelObservations?.error||scan.data?.lab?.error||'unknown')}`);process.exitCode=1;return;
  }
  const afterLab=await json('/api/lab'),afterLedger=await json('/api/ledger');
  const audit=auditLabTransition(beforeLab.data?.lab,afterLab.data?.lab,beforeLedger.data?.ledger,afterLedger.data?.ledger);
  if(afterLab.status!==200||afterLedger.status!==200||!audit.ok){log(`AUDIT_FAILED ${audit.errors.join(' | ')||`lab=${afterLab.status} ledger=${afterLedger.status}`}`);process.exitCode=2;return;}
  const coverage=scan.data.oddsCoverage||{};
  log(`SCAN_OK batch=${scan.data.sweepSlot||0}/${scan.data.sweepSlots||0} scannedLeagues=${scan.data.scannedLeagues||0}/${scan.data.totalLeagues||0} monitored=${scan.data.monitored} failedLeagues=${scan.data.failedLeagues} priced24h=${coverage.executionComplete||0}/${coverage.executionFuture||0} placed=${scan.data.labPlaced} settled=${scan.data.settled} forecasts=${scan.data.modelObservations?.forecastInserted||0} outcomes=${scan.data.modelObservations?.outcomeInserted||0} tickets=${audit.oldTickets}->${audit.newTickets}`);
  if(Number(scan.data.failedLeagues)>Math.max(2,Math.floor(Number(scan.data.selectedLeagues?.length||0)/4))){log(`SCAN_DEGRADED failedLeagues=${scan.data.failedLeagues}`);process.exitCode=1;}
}
try{await run();}catch(error){
  log(`RUNNER_ERROR ${String(error?.message||error)}`);
  process.exitCode=1;
}
