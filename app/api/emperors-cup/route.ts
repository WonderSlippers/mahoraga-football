import {EMPERORS_CUP_SOURCE,parseEmperorsCupFixtures} from '@/lib/emperors-cup-policy';

type Fixture=ReturnType<typeof parseEmperorsCupFixtures>[number];
let cached:{at:number;fixtures:Fixture[]}|null=null;

export async function GET(){
  try{
    if(!cached||Date.now()-cached.at>5*60_000){
      const response=await fetch(EMPERORS_CUP_SOURCE,{headers:{accept:'text/html'},signal:AbortSignal.timeout(9000)});
      if(!response.ok){await response.body?.cancel();throw Error(`JFA HTTP ${response.status}`);}
      const html=await response.text();
      const fixtures=parseEmperorsCupFixtures(html);
      if(fixtures.length!==16)throw Error(`JFA fixture count ${fixtures.length}, expected 16`);
      cached={at:Date.now(),fixtures};
    }
    return Response.json({ok:true,competition:'天皇杯 JFA 第106回',season:2026,source:'日本足协官方赛程公告',sourceUrl:EMPERORS_CUP_SOURCE,capturedAt:cached.at,
      dataKind:'official-schedule-only',hasVerifiedLiveScore:false,hasVerifiedCurrentOdds:false,
      fixtures:cached.fixtures},{headers:{'cache-control':'public, max-age=120'}});
  }catch(error){
    console.error('emperors_cup_schedule_unavailable',String(error));
    if(cached&&Date.now()-cached.at<60*60_000)return Response.json({ok:true,stale:true,competition:'天皇杯 JFA 第106回',source:'日本足协官方赛程公告',sourceUrl:EMPERORS_CUP_SOURCE,capturedAt:cached.at,
      dataKind:'official-schedule-only',hasVerifiedLiveScore:false,hasVerifiedCurrentOdds:false,fixtures:cached.fixtures},{headers:{'cache-control':'no-store'}});
    return Response.json({ok:false,error:'日本足协赛程暂时无法核验，未生成比赛或赔率',sourceUrl:EMPERORS_CUP_SOURCE},{status:502,headers:{'cache-control':'no-store'}});
  }
}
