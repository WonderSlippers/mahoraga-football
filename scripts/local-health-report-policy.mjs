const MIB = 1024 * 1024;

export function summarizeLocalHealth({runtime,ledger,scanLog,candidate,now=Date.now()}) {
  const alerts=[];
  if(!runtime?.listening) alerts.push({code:'listener-missing',severity:'critical',message:'本地 5173 没有监听'});
  if(ledger?.error || ledger?.quickCheck!=='ok') alerts.push({code:'d1-unverified',severity:'critical',message:'活动 D1 完整性未通过或无法读取'});
  if(runtime?.listening && !runtime.version) alerts.push({code:'version-unverified',severity:'warning',message:'不能从监听进程确认活动构建版本'});
  if(Number.isSafeInteger(runtime?.privateBytes) && runtime.privateBytes>=800*MIB)
    alerts.push({code:'scan-memory-gate',severity:'warning',message:'监听进程私有内存超过自动写扫描 800 MiB 门槛；这是进程指标，不是 V8 堆或泄漏证明'});
  if(Number.isInteger(candidate?.number) && Number.isInteger(runtime?.versionNumber) && candidate.number>runtime.versionNumber)
    alerts.push({code:'candidate-not-active',severity:'pending',message:`候选 ${candidate.number} 尚未在活动 5173 生效`});
  if(Number(ledger?.counts?.review)>0) alerts.push({code:'review-pending',severity:'pending',message:`${ledger.counts.review} 张历史票等待证据裁决`});
  const lastScanOk=scanLog?.lastOk?.at??null;
  const lastStoredScan=Number.isSafeInteger(ledger?.lastScanAt)&&ledger.lastScanAt>0?ledger.lastScanAt:null;
  if(!lastScanOk) alerts.push({code:'scan-task-unverified',severity:'pending',message:'任务日志尚无可核对的 SCAN_OK；D1 扫描时间不能替代任务成功'});
  return {
    state:alerts.some(item=>item.severity==='critical')?'critical':alerts.some(item=>item.severity==='warning')?'attention':'incomplete',
    alerts,
    evidence:{
      feedLastSuccessAt:null,feedStatus:'未持久记录；不能用浏览器当前显示或旧赔率推定成功',
      scanLastTaskOkAt:lastScanOk,scanLastStoredAt:lastStoredScan,
      scanStatus:lastScanOk?'有历史 SCAN_OK；是否对应活动版本需逐批核对':'尚无可核对的任务 SCAN_OK',
      reconcileLastSuccessAt:null,reconcileStatus:'没有独立持久成功记录；票据更新时间不能替代结算任务成功',
    },
    checkedAt:new Date(now).toISOString(),
  };
}
