import {ownerWriteDenied} from '@/lib/site-owner';
import {readTextLimited} from '@/lib/limited-response';
import {appendPublicPaperTicket} from '@/lib/simulation-lab';
import {nationalQuoteReferences} from '@/lib/external-quote-reference';
import {loadMergedFeed} from '../feed/route';
import {GET as externalQuoteGET} from '../external-quote-reference/route';

export async function POST(request:Request){
  const denied=await ownerWriteDenied(request);if(denied)return denied;
  const origin=request.headers.get('origin');
  if(origin&&origin!==new URL(request.url).origin)return Response.json({ok:false,error:'跨站请求已拒绝'},{status:403});
  try{
    const input=JSON.parse(await readTextLimited(request,256));
    const id=String(input?.id||'');
    const fixture=nationalQuoteReferences[id as keyof typeof nationalQuoteReferences];
    if(!fixture)return Response.json({ok:false,error:'赛事不在已核对的本轮清单'},{status:404});
    if(Date.now()+10*60000>=fixture.kickoffAt)return Response.json({ok:false,error:'距离开赛不足十分钟或已经开赛'},{status:410});
    const feed=await loadMergedFeed('uefa.nations','20260924-20260925');
    const event=feed.events?.find(row=>String(row?.id)===id);
    if(!event||Date.parse(String(event.date))!==fixture.kickoffAt||event.status?.type?.state!=='pre')throw new Error('公开赛程的身份、开赛时间或状态不符');
    const response=await externalQuoteGET(new Request(`${new URL(request.url).origin}/api/external-quote-reference?id=${encodeURIComponent(id)}`));
    if(!response.ok)throw new Error(`报价来源 HTTP ${response.status}`);
    const payload=await response.json() as {ok?:boolean;capturedAt?:number;rows?:{bookmaker:string;odds:number[];sourceUrl?:string}[];sourceUrl?:string};
    const row=payload.rows?.find(value=>value.bookmaker==='Winamax')||payload.rows?.[0];
    if(!payload.ok||!row||!Number.isSafeInteger(payload.capturedAt)||Date.now()-Number(payload.capturedAt)>10*60000)throw new Error('没有完整且近期抓取的公开报价');
    const teams=(event.competitions?.[0]?.competitors||[]) as {homeAway?:string;team?:{displayName?:string}}[];
    const home=teams.find(team=>team.homeAway==='home')?.team?.displayName||fixture.home;
    const away=teams.find(team=>team.homeAway==='away')?.team?.displayName||fixture.away;
    const result=await appendPublicPaperTicket({matchId:id,leagueCode:'uefa.nations',home,away,kickoffAt:fixture.kickoffAt,odds:row.odds,provider:row.bookmaker,sourceUrl:row.sourceUrl||payload.sourceUrl||'',capturedAt:Number(payload.capturedAt)});
    return Response.json({ok:true,created:result.created,id:result.id,matchId:id,provider:row.bookmaker,sourceUrl:row.sourceUrl||payload.sourceUrl,odds:row.odds,pick:result.pick,assumedPrice:result.odds,marketProbability:result.probability,marketOnlyEdge:result.edge,classification:'public-price-paper-fill',note:'已按公开展示价记录虚拟娱乐对照单；不属于严格精选，未验证真实账户可成交性。'},{headers:{'cache-control':'no-store'}});
  }catch(error){
    if(error instanceof RangeError)return Response.json({ok:false,error:'请求过大'},{status:413});
    return Response.json({ok:false,error:String(error instanceof Error?error.message:error)},{status:503,headers:{'cache-control':'no-store'}});
  }
}
