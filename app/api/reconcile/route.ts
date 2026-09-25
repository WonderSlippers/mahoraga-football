import {reconcilableLabLegs,runSimulationLab} from "@/lib/simulation-lab";
import type {Match} from "@/lib/simulation-lab";
import { ownerWriteDenied } from "@/lib/site-owner";
import {officialMatches,officialJ1DayMatches,attachOfficial} from "@/lib/jleague-source";
import {afcResults,attachAfc} from "@/lib/afc-source";
import {recordMarketResults} from "@/db/market-results";
import { teamOriginal } from "../../../public/names-zh.js";
import {requireOk} from "@/lib/http-response";
import {readJsonLimited} from "@/lib/limited-response";

// Leagues used for a team-name + kickoff-date recovery when an ESPN event
// id was absent from its normal scoreboard response.
const RESCUE_LEAGUES=["afc.champions","afc.cup","jpn.1","chn.1","conmebol.libertadores","conmebol.sudamericana","bra.1","mex.1","arg.1","esp.1"];
type PendingLeg=Awaited<ReturnType<typeof reconcilableLabLegs>>[number];
type ReconTeam={homeAway?:string;score?:string|number;team?:{displayName?:string;shortDisplayName?:string;logo?:string;logos?:{href?:string}[]}};
type ReconStatus={type?:{completed?:boolean;state?:string;name?:string;detail?:string;description?:string};period?:number};
type ReconCompetition={date?:string;competitors?:ReconTeam[];status?:ReconStatus};
type OfficialScore={state?:string;score?:number[];sourceUrl?:string;capturedAt?:number;provider?:string};
type ReconEvent={id?:string|number;date?:string;competitions?:ReconCompetition[];status?:ReconStatus;_edgeOfficial?:OfficialScore;_edgeScoreConflict?:boolean};
type FeedPayload={content?:{sbData?:{events?:unknown}};events?:unknown;data?:{events?:unknown}};
type ReconcileRow=Match&{sourceCount?:number;sourceUrl?:string;observedAt?:number;verificationAudit?:Record<string,unknown>};
const normName=(s:string)=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
async function rescueLegacyLeg(leg:PendingLeg){
  const kickoff=Number(leg.kickoffAt);
  if(!Number.isFinite(kickoff)||kickoff>Date.now()||kickoff<Date.now()-7*86400000)return null;
  // ESPN scoreboard dates are match-local; Americas games that kick off
  // past midnight UTC sit on the previous board date. Check both.
  const days=[0,-1].map(offset=>new Date(kickoff+offset*86400000).toISOString().slice(0,10).replaceAll("-",""));
  const homeEn=teamOriginal(leg.home),awayEn=teamOriginal(leg.away);
  const homeKeys=[normName(leg.home),normName(homeEn)].filter(Boolean),awayKeys=[normName(leg.away),normName(awayEn)].filter(Boolean);
  if(!homeKeys.length||!awayKeys.length)return null;
  // Known league codes must be queried first and exclusively: a missing
  // J1 result should not spend minutes polling unrelated continents.
  const knownLeague=validLeague(String(leg.leagueCode))?String(leg.leagueCode):"";
  const leagues=knownLeague&&knownLeague!=="legacy"?[knownLeague]:RESCUE_LEAGUES;
  for(const league of leagues){
    for(const day of days){
      const urls=[
        `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${league}&date=${day}&limit=100`,
        `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${day}&limit=100`,
      ];
      const fetched=await Promise.allSettled(urls.map(feed));
      const finals:{hs:number;as:number;sourceUrl:string}[]=[];
      for(const [index,item] of fetched.entries()){
        if(item.status!=="fulfilled")continue;
        for(const event of item.value){
          const comp=event?.competitions?.[0]||{},teams=comp.competitors||[];
          const home=teams.find(t=>t.homeAway==="home")||teams[0],away=teams.find(t=>t.homeAway==="away")||teams[1];
          const status=event?.status?.type||comp.status?.type||{};
          const eventDate=Date.parse(event?.date||comp.date||"");
          const homeName=normName(home?.team?.displayName||home?.team?.shortDisplayName||""),awayName=normName(away?.team?.displayName||away?.team?.shortDisplayName||"");
          const homeHit=homeKeys.some(k=>k&&(homeName.includes(k)||k.includes(homeName))&&homeName.length>3),awayHit=awayKeys.some(k=>k&&(awayName.includes(k)||k.includes(awayName))&&awayName.length>3);
          if(!homeHit||!awayHit)continue;
          if(Math.abs(eventDate-kickoff)>12*3600000)continue;
          if(!(status.completed||status.state==="post"))continue;
          const hs=Number(home?.score),as=Number(away?.score);
          if(!Number.isInteger(hs)||!Number.isInteger(as)||hs<0||as<0)continue;
          finals.push({hs,as,sourceUrl:urls[index]});
        }
      }
      // A normal-time final from any public scoreboard is enough to settle.
      // Keep the provenance so a second endpoint can later corroborate it.
      if(finals.length){
        const verified=finals.length>=2&&finals.every(f=>f.hs===finals[0].hs&&f.as===finals[0].as);
        return {id:String(leg.matchId),leagueCode:String(leg.leagueCode),date:kickoff,status:"finished",home:leg.home,away:leg.away,hs:finals[0].hs,as:finals[0].as,period:2,detail:"FT",odds:[0,0,0],providers:[],homeForm:"",awayForm:"",sourceCount:finals.length,independentFinalVerified:verified,settlementEvidence:{provider:verified?"ESPN 双端点一致 · 队名+日期回查":"ESPN 公开单源完场比分 · 队名+日期回查",sourceUrl:finals[0].sourceUrl,primarySourceUrl:finals[0].sourceUrl,capturedAt:Date.now(),score:[finals[0].hs,finals[0].as] as [number,number]},sourceUrl:finals[0].sourceUrl,observedAt:Date.now()};
      }
    }
  }
  return null;
}

type Group={league:string;day:string;ids:Set<string>};
const dayOf=(at:number)=>new Date(at).toISOString().slice(0,10).replaceAll("-","");
const validLeague=(code:string)=>/^[a-z0-9_.]{3,48}$/.test(code);
const rank=(event:ReconEvent)=>{
  const type=event?.competitions?.[0]?.status?.type||event?.status?.type||{};
  return type.completed||type.state==="post"?3:type.state==="in"?2:1;
};
const scores=(event:ReconEvent)=>{
  const teams=event?.competitions?.[0]?.competitors||[];
  const home=teams.find(team=>team.homeAway==="home")||teams[0];
  const away=teams.find(team=>team.homeAway==="away")||teams[1];
  return [home?.score,away?.score].map(value=>/^\d+$/.test(String(value))?Number(value):null);
};
async function feed(url:string){
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(7_000)});
  await requireOk(response,"ESPN");
  const data=await readJsonLimited(response,4_000_000) as FeedPayload;
  const events=data?.content?.sbData?.events||data?.events||data?.data?.events||[];
  if(!Array.isArray(events))throw new Error("ESPN malformed");
  if(events.length>1000)throw new RangeError('ESPN feed has too many events');
  return events as ReconEvent[];
}
// Scoreboards occasionally omit a finished event around date boundaries.
// The event-summary endpoint is a direct, single-source fallback: it is used
// only for the pending ticket's exact ID and does not wait for confirmation.
async function eventSummary(league:string,id:string){
  const url=`https://site.web.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/summary?event=${encodeURIComponent(id)}`;
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(7_000)});
  await requireOk(response,"ESPN summary");
  const data=await readJsonLimited(response,4_000_000) as {header?:{competitions?:ReconCompetition[]}},competition=data?.header?.competitions?.[0];
  if(!competition)throw new Error("ESPN summary malformed");
  return {id,date:competition.date,competitions:[competition],status:competition.status,sourceUrl:url};
}
async function groupResults(group:Group,official:Awaited<ReturnType<typeof officialMatches>>,afc:Awaited<ReturnType<typeof afcResults>>){
  const league=encodeURIComponent(group.league),day=group.day;
  const prev=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(4,6))-1,Number(day.slice(6,8))-1)).toISOString().slice(0,10).replaceAll("-","");
  const urls=[
    `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${league}&date=${day}&limit=100`,
    `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${day}&limit=100`,
    `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${league}&date=${prev}&limit=100`,
    `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${prev}&limit=100`,
  ];
  const fetched=await Promise.allSettled(urls.map(feed));
  const versions=new Map<string,{event:ReconEvent;sourceUrl:string}[]>();
  fetched.forEach((item,index)=>{
    if(item.status!=="fulfilled")return;
    for(const event of item.value){
      const id=String(event?.id||"");
      if(!group.ids.has(id))continue;
      versions.set(id,[...(versions.get(id)||[]),{event,sourceUrl:urls[index]}]);
    }
  });
  // Query only IDs missing from both day scoreboards. This closes a visible
  // completed event even when its league/date feed is stale or shifted.
  const missing=[...group.ids].filter(id=>!versions.has(id));
  const direct=await Promise.allSettled(missing.map(id=>eventSummary(group.league,id)));
  direct.forEach((item,index)=>{if(item.status==="fulfilled")versions.set(missing[index],[{event:item.value,sourceUrl:item.value.sourceUrl}]);});
  const rows:ReconcileRow[]=[];
  for(const [id,observations] of versions){
    const sorted=observations.slice().sort((a,b)=>rank(b.event)-rank(a.event));
    const chosen=sorted[0],finalVersions=observations.filter(item=>rank(item.event)===3);
    const primaryConflict=finalVersions.length>1&&finalVersions.some(item=>scores(item.event).join("-")!==scores(finalVersions[0].event).join("-"));
    // These are two separately fetched ESPN endpoints, not two independent
    // providers. Matching final records are still sufficient to close a
    // simulation ticket, and the stored evidence keeps that limitation clear.
    const primaryConsensus=finalVersions.length>=2&&!primaryConflict;
    const jleagueLinked=(group.league==="afc.champions"||group.league==="jpn.1")?attachOfficial([chosen.event],official)[0]:chosen.event;
    const linked=group.league==="afc.champions"?attachAfc([jleagueLinked],afc)[0]:jleagueLinked;
    const competition=linked?.competitions?.[0]||{},teams=competition.competitors||[];
    const home=teams.find(team=>team.homeAway==="home")||teams[0];
    const away=teams.find(team=>team.homeAway==="away")||teams[1];
    if(!home||!away)continue;
    const sourceType=competition.status?.type||linked.status?.type||{},date=Date.parse(linked.date||competition.date||"");
    if(!Number.isFinite(date)||date>Date.now())continue;
    const rawScore=scores(linked),officialRow=linked._edgeOfficial,detail=[sourceType.name,sourceType.detail,sourceType.description].filter(Boolean).join(" ");
    const primaryScore=rawScore.length===2&&rawScore.every(score=>Number.isInteger(score)&&Number(score)>=0)?[Number(rawScore[0]),Number(rawScore[1])] as [number,number]:null;
    const officialScore=Array.isArray(officialRow?.score)&&officialRow.score.length===2&&officialRow.score.every(score=>Number.isInteger(score)&&score>=0)?[officialRow.score[0],officialRow.score[1]] as [number,number]:null;
    const primaryFinal=rank(linked)===3&&primaryScore!==null;
    const authorizedOfficialUrl=officialRow?.sourceUrl?.startsWith("https://www.jleague.jp/en/match/")||officialRow?.sourceUrl?.startsWith("https://www.the-afc.com/en/club/afc_champions_league_elite.html/news/md");
    const officialCapturedAt=Number(officialRow?.capturedAt||0);
    const officialFinal=Boolean(officialRow?.state==="finished"&&officialScore&&authorizedOfficialUrl&&Number.isSafeInteger(officialCapturedAt)&&officialCapturedAt>0&&Date.now()-officialCapturedAt<10*60000);
    const officialVerified=Boolean(primaryFinal&&officialFinal&&!primaryConflict&&!linked._edgeScoreConflict&&primaryScore&&officialScore&&primaryScore[0]===officialScore[0]&&primaryScore[1]===officialScore[1]);
    const verified=Boolean(primaryFinal&&!linked._edgeScoreConflict&&(officialVerified||primaryConsensus));
    if(group.league==="afc.champions"&&primaryFinal&&!verified)console.info("reconcile_afc_final_audit",{
      id,day,primaryFinal,officialFinal,primaryConflict,linkedConflict:Boolean(linked._edgeScoreConflict),
      score:rawScore,officialScore:officialRow?.score||null,officialProvider:officialRow?.provider||null,
      officialUrlValid:Boolean(authorizedOfficialUrl),officialAgeMs:officialRow?.capturedAt?Date.now()-officialRow.capturedAt:null,
      primarySource:chosen.sourceUrl,
    });
    const officialOnly=officialFinal&&!verified;
    rows.push({
      id,leagueCode:group.league,date,status:primaryFinal||officialOnly?"finished":sourceType.state==="in"?"live":"soon",
      home:home.team?.shortDisplayName||home.team?.displayName||"主队",away:away.team?.shortDisplayName||away.team?.displayName||"客队",
      hs:officialOnly&&officialScore?officialScore[0]:rawScore[0]??0,as:officialOnly&&officialScore?officialScore[1]:rawScore[1]??0,
      period:officialOnly?2:Number(competition.status?.period||linked.status?.period||0),
      detail:officialOnly?detail+" "+String(officialRow?.provider||'官方赛果')+" final / ESPN pending":detail,
      odds:[0,0,0],providers:[],homeForm:"",awayForm:"",sourceCount:verified?2:1,
      homeLogo:home.team?.logo||home.team?.logos?.[0]?.href,awayLogo:away.team?.logo||away.team?.logos?.[0]?.href,
      independentFinalVerified:verified,
      settlementEvidence:primaryFinal||officialOnly?officialVerified&&officialScore
        ?{provider:String(officialRow?.provider||'官方赛果'),sourceUrl:String(officialRow?.sourceUrl||''),capturedAt:officialCapturedAt,score:officialScore,primarySourceUrl:chosen.sourceUrl,primaryCapturedAt:Date.now()}
        :verified&&primaryScore
          ?{provider:"ESPN 双端点一致（同一供应商）",sourceUrl:finalVersions[1].sourceUrl,capturedAt:Date.now(),score:primaryScore,primarySourceUrl:finalVersions[0].sourceUrl,primaryCapturedAt:Date.now()}
          :{provider:"ESPN 公开单源完场比分（待后续交叉核验）",sourceUrl:officialOnly?String(officialRow?.sourceUrl||''):chosen.sourceUrl,capturedAt:Date.now(),score:officialOnly&&officialScore?officialScore:primaryScore!}
        :undefined,
      sourceUrl:officialOnly?String(officialRow?.sourceUrl||''):chosen.sourceUrl,observedAt:Date.now(),
      verificationAudit:group.league==="afc.champions"?{
        primaryFinal,officialFinal,primaryConflict,linkedConflict:Boolean(linked._edgeScoreConflict),
        rawScore,officialScore:officialRow?.score||null,officialProvider:officialRow?.provider||null,
        officialUrlValid:Boolean(authorizedOfficialUrl),officialAgeMs:officialRow?.capturedAt?Date.now()-officialRow.capturedAt:null,
      }:undefined,
    });
  }
  return rows;
}
export async function POST(request:Request){
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return Response.json({ok:false,error:"跨站请求已拒绝"},{status:403});
  // Same-origin viewers may trigger deterministic settlement, but cannot edit
  // picks or create tickets. Non-browser maintenance still requires a key.
  if(!origin){const denied=await ownerWriteDenied(request);if(denied)return denied;}
  try{
    const pending=await reconcilableLabLegs();
    const grouped=new Map<string,Group>();
    for(const leg of pending){
      const league=String(leg.leagueCode||""),id=String(leg.matchId||""),kickoff=Number(leg.kickoffAt);
      if(!validLeague(league)||!/^\d{3,30}$/.test(id)||!Number.isFinite(kickoff)||kickoff>Date.now()||kickoff<Date.now()-7*86400000)continue;
      const day=dayOf(kickoff),key=league+":"+day;
      const group=grouped.get(key)||{league,day,ids:new Set<string>()};
      group.ids.add(id);grouped.set(key,group);
    }
    const groups=[...grouped.values()].sort((a,b)=>Number(b.league==="afc.champions")-Number(a.league==="afc.champions")||b.day.localeCompare(a.day)).slice(0,24);
    // Audit transparency: pendingLegs counts every open leg, but the group
    // loop above silently skips legs (placeholder ids, stale kickoffs, the
    // 24-group cap, ...). That gap caused recurring "pending N but checked 0"
    // audit doubts. Classify each open leg by its exclusion reason —
    // read-only counts, no settlement behavior change.
    const now=Date.now();
    const groupedIds=new Set<string>();for(const g of groups)for(const id of g.ids)groupedIds.add(id);
    const pendingLegsAudit={total:0,grouped:0,capped:0,placeholderId:0,invalidKickoff:0,futureKickoff:0,staleLeg:0,invalidLeagueOrId:0};
    for(const leg of pending){
      if(leg.status!=="open")continue;
      pendingLegsAudit.total++;
      const league=String(leg.leagueCode||""),id=String(leg.matchId||""),kickoff=Number(leg.kickoffAt);
      const valid=validLeague(league)&&/^\d{3,30}$/.test(id)&&Number.isFinite(kickoff)&&kickoff<=now&&kickoff>=now-7*86400000;
      if(!valid){
        if(!/^\d{3,30}$/.test(id))pendingLegsAudit.placeholderId++;
        else if(!Number.isFinite(kickoff))pendingLegsAudit.invalidKickoff++;
        else if(kickoff>now)pendingLegsAudit.futureKickoff++;
        else if(kickoff<now-7*86400000)pendingLegsAudit.staleLeg++;
        else pendingLegsAudit.invalidLeagueOrId++;
      }else if(groupedIds.has(id))pendingLegsAudit.grouped++;
      else pendingLegsAudit.capped++;
    }
    const officialDays=[...new Set(groups.filter(group=>group.league==="afc.champions"||group.league==="jpn.1").map(group=>group.day))].slice(0,5);
    const [jleagueResult,afcResult]=officialDays.length?await Promise.allSettled([officialMatches(officialDays),afcResults(officialDays)]):[];
    const jpnDays=[...new Set(groups.filter(group=>group.league==="jpn.1").map(group=>group.day))].slice(0,2);
    const directJ1Results=await Promise.allSettled(jpnDays.map(officialJ1DayMatches));
    const indexedOfficial=jleagueResult?.status==="fulfilled"?jleagueResult.value:[];
    const official=[...indexedOfficial,...directJ1Results.flatMap(result=>result.status==="fulfilled"?result.value:[])];
    const afc=afcResult?.status==="fulfilled"?afcResult.value:[];
    if(jleagueResult?.status==="rejected")console.error("reconcile_jleague_unavailable",String(jleagueResult.reason));
    if(afcResult?.status==="rejected")console.error("reconcile_afc_unavailable",String(afcResult.reason));
    const rows:ReconcileRow[]=[];let failures=0;
    for(let start=0;start<groups.length;start+=6){
      const checked=await Promise.allSettled(groups.slice(start,start+6).map(group=>groupResults(group,official,afc)));
      checked.forEach(item=>{if(item.status==="fulfilled")rows.push(...item.value);else failures++;});
    }
    // The J.LEAGUE official pages also close a leg when ESPN's daily board
    // omits its event ID. This is a public, regular-time final — no second
    // source is required for settlement.
    const officialRows=new Set(rows.map(row=>String(row.id)));
    for(const leg of pending){
      if(leg.status!=="open"||leg.leagueCode!=="jpn.1"||officialRows.has(String(leg.matchId)))continue;
      const match=official.find(row=>row.state==="finished"&&Math.abs(Date.parse(row.fixtureDate)-Number(leg.kickoffAt))<=10*60_000&&normName(row.home?.name)===normName(teamOriginal(leg.home))&&normName(row.away?.name)===normName(teamOriginal(leg.away)));
      const score=match?.score?.length===2&&match.score.every(value=>Number.isInteger(value)&&Number(value)>=0)?[Number(match.score[0]),Number(match.score[1])] as [number,number]:null;
      if(!match||!score)continue;
      rows.push({id:String(leg.matchId),leagueCode:leg.leagueCode,date:Number(leg.kickoffAt),status:"finished",home:leg.home,away:leg.away,hs:score[0],as:score[1],period:2,detail:"FT",odds:[0,0,0],providers:[],homeForm:"",awayForm:"",sourceCount:1,independentFinalVerified:false,settlementEvidence:{provider:"J.LEAGUE 官方完场比分",sourceUrl:match.sourceUrl,capturedAt:match.capturedAt,score},sourceUrl:match.sourceUrl,observedAt:Date.now()});
      officialRows.add(String(leg.matchId));
    }
    // Close scoreboards and official-page results before the slower
    // team-name recovery pass. A slow, unrelated legacy lookup must never
    // hold an already confirmed final (such as the Kashiwa match) hostage.
    const primaryResult=await runSimulationLab(rows,"本轮只补查已记录的虚拟单；不新增下注",true);
    // Legacy cloud-import tickets carry placeholder match ids and never
    // Recover all past open legs missing from the normal event-id response,
    // including real numeric IDs such as the Kashiwa fixture.
    const recoveredIds=new Set(rows.map(row=>String(row.id)));
    const legacyPending=pending.filter(leg=>leg.status==="open"&&!recoveredIds.has(String(leg.matchId))&&Number(leg.kickoffAt)<Date.now()&&Number(leg.kickoffAt)>Date.now()-7*86400000);
    let rescued=0,rescueConflicts=0;
    const rescueQueue=legacyPending.sort((a,b)=>Number(b.kickoffAt)-Number(a.kickoffAt));
    for(const leg of rescueQueue.slice(0,12)){
      try{const row=await rescueLegacyLeg(leg);if(row){rows.push(row);rescued++;}else rescueConflicts++;}
      catch(error){console.error("reconcile_rescue_failed",{matchId:String(leg.matchId),error:String(error)});failures++;}
    }
    const fallbackResult=await runSimulationLab(rows,"本轮只补查已记录的虚拟单；不新增下注",true);
    const marketResults=await recordMarketResults(rows).catch(error=>{console.error("reconcile_market_result_failed",error);return null;});
    const summary={ok:true,pendingLegs:pending.filter(leg=>leg.status==="open").length,logoBackfills:pending.filter(leg=>!leg.homeLogo||!leg.awayLogo).length,checkedGroups:groups.length,matched:rows.length,officialMatches:official.length,afcReports:afc.length,
      verifiedFinals:rows.filter(row=>row.independentFinalVerified).length,
      independentlyVerifiedFinals:rows.filter(row=>row.settlementEvidence?.provider&&row.settlementEvidence.provider!=="ESPN 双端点一致（同一供应商）").length,
      unverifiedAfcFinals:rows.filter(row=>row.leagueCode==="afc.champions"&&row.status==="finished"&&!row.independentFinalVerified).map(row=>({id:row.id,audit:row.verificationAudit})),
      sourceFailures:failures,settled:primaryResult.settled+fallbackResult.settled,
      pendingLegsAudit,
      // Audit transparency: which tickets this run actually closed (id,
      // portfolio, resulting status, stake, pnl). Read-only report of
      // settlePortfolio transitions — no historical evidence is rewritten.
      settledTickets:[...(primaryResult.settledTickets||[]),...(fallbackResult.settledTickets||[])].map((t:{portfolioId:string;ticketId:string;day:string;status:string;stake:number;pnl:number;legs:number})=>t),
      marketResults,legacyRescued:rescued,legacyUnresolved:rescueConflicts};
    console.info("reconcile_summary",summary);
    return Response.json(summary,{headers:{"cache-control":"no-store"}});
  }catch(error){console.error("reconcile_failed",error);return Response.json({ok:false,error:"补查暂时失败"},{status:503});}
}
