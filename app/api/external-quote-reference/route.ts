import {nationalQuoteReferences,parseQuoteReference,quoteReferenceUrl} from '@/lib/external-quote-reference';
import {readTextLimited} from '@/lib/limited-response';
import {austriaIsraelWinamaxUrl,parseWinamaxPublicQuote} from '@/lib/winamax-public-quote';

const cache=new Map<string,{at:number;payload:unknown}>();
export async function GET(request:Request){
  const id=new URL(request.url).searchParams.get('id')||'';
  const fixture=nationalQuoteReferences[id as keyof typeof nationalQuoteReferences];
  if(!fixture)return Response.json({ok:false,error:'本场尚未配置外部参考源'},{status:404,headers:{'cache-control':'no-store'}});
  if(Date.now()>=fixture.kickoffAt)return Response.json({ok:false,error:'已开赛；赛前参考报价停止刷新'},{status:410,headers:{'cache-control':'no-store'}});
  const old=cache.get(id);
  if(old&&Date.now()-old.at<5*60_000)return Response.json(old.payload,{headers:{'cache-control':'no-store'}});
  const sourceUrl=quoteReferenceUrl(fixture);
  try{
    const response=await fetch(sourceUrl,{headers:{accept:'text/html'},signal:AbortSignal.timeout(9000)});
    if(!response.ok)throw new Error(`来源 HTTP ${response.status}`);
    const html=await readTextLimited(response,1_000_000);
    const rows:Array<{bookmaker:string;odds:number[];sourceUrl?:string}>=parseQuoteReference(html,fixture);
    if(id==='401861048'){
      try{
        const winamax=await fetch(austriaIsraelWinamaxUrl,{headers:{accept:'text/html'},signal:AbortSignal.timeout(9000)});
        if(winamax.ok){
          const text=await readTextLimited(winamax,700_000);
          rows.unshift({...parseWinamaxPublicQuote(text),sourceUrl:austriaIsraelWinamaxUrl});
        }
      }catch(error){console.warn('winamax_public_quote_unavailable',String(error instanceof Error?error.message:error).slice(0,160));}
    }
    const payload={ok:true,id,source:'公开网页报价',sourceUrl,bookUrl:fixture.bookUrl,capturedAt:Date.now(),sourceUpdatedAt:null,rows,classification:'public-quote-paper-fill',usableForSimulation:true,realAccountExecutableVerified:false,note:'按公开展示价作虚拟成交假设；没有验证真实账户能按此价下注。Winamax 行来自第三方转载页，不是 Winamax 官网直接盘口。'};
    cache.set(id,{at:Date.now(),payload});
    if(cache.size>12)cache.delete(cache.keys().next().value!);
    return Response.json(payload,{headers:{'cache-control':'no-store'}});
  }catch(error){
    return Response.json({ok:false,id,sourceUrl,bookUrl:fixture.bookUrl,error:String(error instanceof Error?error.message:error),classification:'unavailable',usableForSimulation:false},{status:503,headers:{'cache-control':'no-store'}});
  }
}
