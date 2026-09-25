import {readModelObservations} from '@/db/model-observations';
import {evaluateProspective} from '@/lib/model-evaluation';

export async function GET(){
  try{
    const {forecasts,outcomes,truncated}=await readModelObservations();
    return Response.json({ok:true,evaluation:evaluateProspective(forecasts,outcomes,truncated)},{headers:{'cache-control':'no-store'}});
  }catch(error){
    console.error('model_evaluation_unavailable',String(error));
    return Response.json({ok:false,error:'前瞻验证库尚未完成本地迁移或暂时不可用；不会用历史票据事后补造预测'},{status:503,headers:{'cache-control':'no-store'}});
  }
}
