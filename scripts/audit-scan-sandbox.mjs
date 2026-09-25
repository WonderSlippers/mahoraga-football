import {DatabaseSync} from 'node:sqlite';
import {auditLabTransition} from './local-scan-audit.mjs';
import {readLocalLab} from './local-lab-reader.mjs';

const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw new Error('Expected before and after SQLite paths.');
function snapshot(filename){
  const db=new DatabaseSync(filename,{readOnly:true});
  try{
    const get=key=>JSON.parse(db.prepare('SELECT payload FROM app_state WHERE key=?').get(key)?.payload||'null');
    const integrity=db.prepare('PRAGMA quick_check').get();
    return {lab:readLocalLab(db).lab,ledger:{state:get('sim_state'),settings:get('sim_settings')},integrity:Object.values(integrity)[0]};
  }finally{db.close();}
}
const before=snapshot(beforePath),after=snapshot(afterPath);
const audit=auditLabTransition(before.lab,after.lab,before.ledger,after.ledger);
const open=lab=>lab.portfolios.flatMap(p=>p.tickets).filter(t=>t.status==='open').length;
const report={ok:audit.ok&&before.integrity==='ok'&&after.integrity==='ok',errors:audit.errors,oldTickets:audit.oldTickets,newTickets:audit.newTickets,openBefore:open(before.lab),openAfter:open(after.lab),portfolios:after.lab.portfolios.length,stakeSettings:after.lab.portfolios.map(p=>p.stake),balanceBefore:before.ledger.state.balance,balanceAfter:after.ledger.state.balance,integrityBefore:before.integrity,integrityAfter:after.integrity};
process.stdout.write(JSON.stringify(report)+'\n');
if(!report.ok)process.exitCode=2;
