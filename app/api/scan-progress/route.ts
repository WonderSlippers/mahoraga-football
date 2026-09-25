import {readScanIncidents,readScanProgress} from '@/db/scan-progress';

export async function GET(request:Request){
  if(!['localhost','127.0.0.1'].includes(new URL(request.url).hostname))return new Response(null,{status:404});
  try{return Response.json({ok:true,current:await readScanProgress(),incidents:await readScanIncidents()},{headers:{'cache-control':'no-store'}});}
  catch(error){console.error('scan_progress_read_failed',error);return Response.json({ok:false,error:'扫描进度暂不可用'},{status:503});}
}
