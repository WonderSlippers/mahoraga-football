const MIB=1048576;

// Compare only observations of the same listening process and build. A PID
// change starts a new series; a rising RSS here is not a leak diagnosis.
export function summarizeHealthHistory(reports,current){
  const pid=current?.runtime?.pid;
  const version=current?.runtime?.version;
  const checkedAt=Date.parse(current?.summary?.checkedAt||'');
  const samples=[...reports,current].flatMap(report=>{
    const at=Date.parse(report?.summary?.checkedAt||'');
    const bytes=report?.runtime?.privateBytes;
    if(report?.kind!=='edge-local-health-v1'||!Number.isSafeInteger(at)||
      !Number.isSafeInteger(pid)||pid<=0||!version||!Number.isSafeInteger(checkedAt)||
      !Number.isSafeInteger(bytes)||bytes<0||report?.runtime?.pid!==pid||
      report?.runtime?.version!==version||at>checkedAt)return [];
    return [{at,bytes}];
  }).sort((a,b)=>a.at-b.at);
  const unique=[...new Map(samples.map(row=>[row.at,row])).values()];
  const first=unique[0],last=unique.at(-1);
  const previous=[...reports].filter(report=>report?.kind==='edge-local-health-v1'&&
    Number.isFinite(Date.parse(report?.summary?.checkedAt||''))&&
    Date.parse(report.summary.checkedAt)<checkedAt).sort((a,b)=>
    Date.parse(b.summary.checkedAt)-Date.parse(a.summary.checkedAt))[0];
  const priorCodes=new Set((previous?.summary?.alerts||[]).map(item=>item.code));
  const currentCodes=new Set((current?.summary?.alerts||[]).map(item=>item.code));
  return {
    process:{pid:pid??null,version:version??null,samples:unique.length,
      firstAt:first?new Date(first.at).toISOString():null,
      lastAt:last?new Date(last.at).toISOString():null,
      firstMiB:first?Math.round(first.bytes/MIB):null,
      lastMiB:last?Math.round(last.bytes/MIB):null,
      deltaMiB:first&&last?Math.round((last.bytes-first.bytes)/MIB):null,
      note:'仅同 PID、同构建的私有内存快照；不能据此认定 V8 堆泄漏或长期稳定'},
    alertChanges:{previousAt:previous?.summary?.checkedAt??null,
      new:[...currentCodes].filter(code=>!priorCodes.has(code)),
      continuing:[...currentCodes].filter(code=>priorCodes.has(code)),
      resolved:[...priorCodes].filter(code=>!currentCodes.has(code))},
  };
}
