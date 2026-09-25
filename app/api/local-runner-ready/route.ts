import {env} from 'cloudflare:workers';
import {LOCAL_SCAN_PROTOCOL} from '@/lib/local-scan-policy';

// A scheduled local scanner must never write to whichever unrelated app
// happens to occupy 5173. This marker exists only in the intended build.
export async function GET(request:Request){
  const url=new URL(request.url);
  if(!['127.0.0.1','localhost'].includes(url.hostname))return new Response(null,{status:404});
  try{
    if(!env.DB)throw new Error('D1 unavailable');
    await Promise.all([
      env.DB.prepare('SELECT id FROM model_forecasts LIMIT 1').all(),
      env.DB.prepare('SELECT id FROM model_outcomes LIMIT 1').all(),
    ]);
    return Response.json({ok:true,app:'edge-football-local',runnerProtocol:LOCAL_SCAN_PROTOCOL,port:5173},{headers:{'cache-control':'no-store'}});
  }catch{
    return Response.json({ok:false,error:'本地前瞻库迁移未完成；定时扫描暂不写入账本'},{status:503,headers:{'cache-control':'no-store'}});
  }
}
