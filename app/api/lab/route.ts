import { readLab, updateLabConfig, analysisText, computeCalibration, scoreLeg } from "@/lib/simulation-lab";
import type {Lab} from "@/lib/simulation-lab";
import { ownerWriteDenied } from "@/lib/site-owner";
import {teamEvidence} from '@/lib/team-evidence';
import {readScanProgress} from '@/db/scan-progress';
import {readLatestSamplingAudit} from '@/db/sampling-audit';
import {readTextLimited} from '@/lib/limited-response';
// Unsettled tickets (open/review) get their leg rationale upgraded to the
// spoken-language "解析" line at READ time — user directive 2026-09-18:
// nothing frozen before settlement. Odds, stakes, evidence and stored
// history stay untouched; only the displayed explanation is refreshed.
type LabLeg=Lab['portfolios'][number]['tickets'][number]['legs'][number];
type ReviewRow=NonNullable<Lab['marketReviews']>[number];
function directionOf(l:LabLeg):string{
  if(l.market==="total")return `大小球${l.side==="over"?"大":"小"}${l.line}`;
  if(l.market==="spread")return `让球${l.side==="home"?l.home:l.away}`;
  return ["主胜","平局","客胜"][Number(l.pick)]||"所选方向";
}
// Direction-drift detector (user 2026-09-18: boards must not silently
// flip — when the latest scan's best direction for a match differs from
// an open ticket's direction, the ticket stays but carries an explicit
// "no longer recommended" explanation with the reason).
function markDirectionDrift(lab:Lab){
  const reviews=[...(lab.marketReviews||[]),...(lab.reviews||[])];
  const byMatch=new Map<string,ReviewRow>();
  for(const r of reviews){const k=String(r.leg?.matchId);const cur=byMatch.get(k);if(!cur||Number(r.edge)>Number(cur.edge))byMatch.set(k,r);}
  for(const portfolio of lab?.portfolios||[])for(const ticket of portfolio.tickets||[]){
    if(["win","loss","void"].includes(ticket.status))continue;
    for(const leg of ticket.legs||[]){
        if(leg.status!=="open"||leg.decisionVersion==="evidence-v3")continue;
      const rev=byMatch.get(String(leg.matchId));
      if(!rev?.leg)continue;
      const sameMarket=(rev.leg.market||'1x2')===(leg.market||'1x2');
      if(!sameMarket){leg.directionChanged=false;continue;}
      const nowDir=directionOf(rev.leg),myDir=directionOf(leg);
      if(nowDir===myDir){leg.directionChanged=false;continue;}
      leg.directionChanged=true;
      leg.alt={dir:nowDir,odds:Number(rev.leg.odds)||0,pick:rev.leg.pick,side:rev.leg.side,line:rev.leg.line,market:rev.leg.market||"1x2"};
      leg.driftNote=`⚠️ 模型方向已变化：当前最优方向是「${nowDir}」（估计优势 ${(Number(rev.edge)*100).toFixed(1)}%），本单「${myDir}」不再被最新模型推荐。原单保留不动（赔率/金额冻结），差异来自最新比赛数据、校准或模型权重调整——如果你对这场有新判断，以最新方向为准。`;
    }
  }
}
function upgradeUnsettledRationales(lab:Lab){
  markDirectionDrift(lab);
  for(const portfolio of lab?.portfolios||[]){
    for(const ticket of portfolio.tickets||[]){
      // Score backfill applies to EVERY leg incl. settled history (user:
      // every bet must show its 0-100 score). Only the display value is
      // computed; stored odds/stakes/evidence stay frozen.
      for(const leg of ticket.legs||[]){
        const sc=leg.score==null?NaN:Number(leg.score);
        if(!Number.isFinite(sc)){
          const probability=Number(leg.probability),odds=Number(leg.odds);
          if(!Number.isFinite(probability)||probability<=0||probability>=1||!Number.isFinite(odds)||odds<=1){leg.scoreOrigin='unscorable-missing-at-bet-probability';continue;}
          leg.score=scoreLeg({odds:[]},{probability,edge:probability*odds-1,goalModel:leg.goalEvidence||undefined});
          leg.scoreOrigin='read-time-recomputed';leg.scoreComputedAt=Date.now();leg.scoreDisplayVersion='read-score-v1';
        }else{leg.scoreOrigin='at-bet-saved';}
      }
      if(["win","loss","void"].includes(ticket.status))continue;
      for(const leg of ticket.legs||[]){
      if(leg.status!=="open")continue;
        const existing=(leg.rationale||[]).filter((line:string)=>!String(line).startsWith("解析："));
        const market=leg.market==="total"?"total":leg.market==="spread"?"spread":"1x2";
        const pickName=market==="total"?`全场${leg.side==="over"?"大":"小"} ${leg.line} 球`:market==="spread"?`${leg.side==="home"?leg.home:leg.away} ${Number(leg.line)>0?"+":""}${leg.line}`:["主胜","平局","客胜"][Number(leg.pick)]||"所选方向";
        const margin=Number(leg.goalEvidence?.uncertaintyMargin??leg.evidence?.uncertaintyMargin??0.05);
        const matchLike={home:leg.home,away:leg.away,homeForm:String(leg.evidence?.homeForm||""),awayForm:String(leg.evidence?.awayForm||""),goalModel:leg.goalEvidence||undefined};
        leg.rationale=[analysisText(matchLike,{market,pickName,odds:Number(leg.odds),probability:Number(leg.probability),margin,goalModel:leg.goalEvidence||undefined}),...existing];
      }
    }
  }
  return lab;
}
export async function GET(request:Request){try{const lab=await readLab();if(new URL(request.url).searchParams.get("meta")==="1")return Response.json({ok:true,updatedAt:lab.updatedAt,lastScanAt:lab.lastScanAt},{headers:{"cache-control":"no-store"}});const scanProgress=await readScanProgress().catch(error=>{console.error('lab_scan_progress_read_failed',error);return null;});const samplingAudit=await readLatestSamplingAudit().catch(error=>{console.error('lab_sampling_audit_read_failed',error);return null;});upgradeUnsettledRationales(lab);return Response.json({ok:true,lab:{...lab,scanProgress,samplingAudit,calibration:computeCalibration(lab),teamResearch:teamEvidence()}},{headers:{"cache-control":"no-store"}});}catch{return Response.json({ok:false,error:"多策略账本暂时不可用"},{status:503});}}
export async function POST(request:Request){
  const denied = await ownerWriteDenied(request); if (denied) return denied;
  const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return Response.json({ok:false,error:"跨站请求被拒绝"},{status:403});
  try{const raw=await readTextLimited(request,4096);const lab=await updateLabConfig(JSON.parse(raw));return Response.json({ok:true,lab});}
  catch(error){if(error instanceof RangeError)return Response.json({ok:false,error:"请求过大"},{status:413});return Response.json({ok:false,error:error instanceof Error?error.message:"设置保存失败"},{status:400});}
}
