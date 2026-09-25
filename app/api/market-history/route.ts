import {readMarketQuotes} from '@/db/market-quotes';
export async function GET(request:Request){
  const url=new URL(request.url),matchId=url.searchParams.get('matchId')||'',league=url.searchParams.get('league')||'';
  if(!/^\d{3,30}$/.test(matchId)||!/^[-_a-z0-9.]{3,50}$/.test(league))return Response.json({ok:false,error:'赛事参数无效'},{status:400});
  try{return Response.json({ok:true,...await readMarketQuotes(league,matchId),note:'独立保存的赛前参考报价；同来源、阶段、盘口与价格每5分钟最多一条。抓取时间不是供应商更新时间；不是可成交价。最近200条，truncated表示还有更早历史。'}, {headers:{'cache-control':'no-store'}});}
  catch{return Response.json({ok:false,error:'多玩法历史暂不可用'},{status:503});}
}
