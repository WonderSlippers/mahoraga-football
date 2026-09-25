export function recognizedLocalBuild(status,data){
  return status===200&&data?.ok===true&&data?.app==='edge-football-local'
    &&['prospective-scan-v2','prospective-scan-v3','prospective-scan-v4','prospective-scan-v5'].includes(data?.runnerProtocol)&&data?.port===5173;
}

export function scanDue(status,data,now){
  if(status!==200||data?.ok!==true)return false;
  const last=Number(data.lastScanAt);
  return Number.isSafeInteger(last)&&last>=0&&Number.isSafeInteger(now)
    &&(last===0||now-last>=4.5*60000);
}

// Workerd V8 fatally terminated near 1.4 GB. Reserve ample headroom for one
// bounded request; a missing/invalid reading fails closed, never kills a PID.
export function scanMemorySafe(privateBytes,limitBytes=800*1024*1024){
  return Number.isSafeInteger(privateBytes)&&privateBytes>0&&privateBytes<limitBytes;
}
