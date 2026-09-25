import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {compareTickets,fieldDiff,summarizeLab} from './ledger-reconciliation.mjs';
import {auditLabTransition} from './local-scan-audit.mjs';
import {auditSettlementArithmetic} from './settlement-arithmetic-audit.mjs';
import {restoreLabRows} from '../lib/lab-shards.js';

const [activePath,baselinePath,outputPath]=process.argv.slice(2);
if (!activePath || !baselinePath || !outputPath) throw new Error('Usage: node scripts/reconcile-local-ledger.mjs ACTIVE.sqlite BASELINE.sqlite NEW-REPORT.json');
const hash=s=>createHash('sha256').update(s).digest('hex');
function snapshot(path) {
  const db=new DatabaseSync(path,{readOnly:true});
  try {
    db.exec('BEGIN');
    const integrity=db.prepare('PRAGMA quick_check').all();
    const rows=db.prepare('SELECT key,payload,updated_at FROM app_state ORDER BY key').all();
    const stored=restoreLabRows(rows.filter(row=>row.key==='simulation_lab_v1'||row.key==='simulation_lab_v2'||row.key.startsWith('simulation_lab_v2:')));
    if(!stored||!Array.isArray(stored.lab?.portfolios))throw new Error('多策略账本缺失或格式错误');
    const get=key=>{
      const row=rows.find(r=>r.key===key);
      if (!row) throw new Error(`Missing app_state ${key}`);
      return JSON.parse(row.payload);
    };
    return {path,integrity,hash:hash(JSON.stringify(rows)),rowHashes:rows.map(r=>({key:r.key,updatedAt:r.updated_at,hash:hash(r.payload)})),lab:stored.lab,labHash:hash(JSON.stringify(stored.lab)),labStorage:stored.storage,labRevision:stored.revision,ledger:{state:get('sim_state'),settings:get('sim_settings')}};
  } finally {db.close();}
}
async function get(path) {
  const response=await fetch(`http://127.0.0.1:5173${path}`,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const body=await response.json();
  if (!body.ok) throw new Error(`${path}: not ok`);
  return body;
}
const startedAt=new Date().toISOString();
const baseline=snapshot(baselinePath),before=snapshot(activePath);
const apiLab=await get('/api/lab'),apiLedger=await get('/api/ledger'),ready=await get('/api/local-runner-ready');
const after=snapshot(activePath);
// An already-open legacy tab may update only the non-financial scan journal
// while this read-only audit is in progress. Keep checking all financial and
// ticket state, but report that volatile journal activity separately.
const labStable=before.labHash===after.labHash;
const settingsStable=fieldDiff(before.ledger.settings,after.ledger.settings).length===0;
const financialStateChanges=fieldDiff(before.ledger.state,after.ledger.state).filter(d=>!/^scanJournal(\.|$)/.test(d.path));
const stable=labStable&&settingsStable&&financialStateChanges.length===0;
const api=compareTickets(before.lab,apiLab.lab,{api:true});
const history=compareTickets(baseline.lab,before.lab);
const invariants=auditLabTransition(baseline.lab,before.lab,baseline.ledger,before.ledger);
const settlementArithmetic=auditSettlementArithmetic(before.lab.portfolios.flatMap(p=>p.tickets.map(ticket=>({key:JSON.stringify([p.id,ticket.id]),ticket}))));
const ledgerDiff=fieldDiff(before.ledger,{state:apiLedger.ledger?.state,settings:apiLedger.ledger?.settings}).filter(d=>!/^state\.scanJournal(\.|$)/.test(d.path));
const healthy=[baseline,before,after].every(s=>s.integrity.every(r=>Object.values(r)[0]==='ok'));
const report={startedAt,finishedAt:new Date().toISOString(),ok:stable&&healthy&&api.ok&&history.ok&&invariants.ok&&settlementArithmetic.ok&&ledgerDiff.length===0,stable,healthy,ready,invariants,settlementArithmetic,volatileJournalChanged:before.hash!==after.hash&&stable,financialStateChanges,
  snapshots:[baseline,before,after].map(({lab,ledger,...s})=>({...s,summary:summarizeLab(lab),balance:ledger.state.balance,initialBalance:ledger.state.initialBalance,autoStake:ledger.settings.autoStake,autoEnabled:ledger.settings.autoEnabled})),
  apiSummary:summarizeLab(apiLab.lab),api,history,ledgerDiff};
// Exclusive create prevents accidental overwrite of an earlier evidence report.
writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ok:report.ok,stable,healthy,counts:report.apiSummary.counts,apiErrors:api.errors.length,historyErrors:history.errors.length,arithmeticErrors:settlementArithmetic.errors.length,arithmeticChecked:settlementArithmetic.checked.length,arithmeticSkipped:settlementArithmetic.skipped.length,historyChangedTickets:history.changes.length,outputPath}));
if (!report.ok) process.exitCode=2;
