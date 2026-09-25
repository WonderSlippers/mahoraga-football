import { goalEvidenceForMatches } from "@/lib/goal-model";
import {putBoundedCache} from '@/lib/bounded-cache';
import { buildDeepDive } from "@/lib/deep-dive";
import {requireOk} from "@/lib/http-response";
import {readJsonLimited,readTextLimited} from "@/lib/limited-response";
import {womensCompetition,newsInScope,classifyInjuryPayload,verifiedAbsenceCount,orderLastFive} from "@/lib/research-source-policy";
// Display alias map (ESPN English → Chinese) shared with the frontend.
// Reused here so DQD league-map lookups (keyed by Chinese team names)
// can resolve most teams without a hand-written alias per club.
import { teamZh } from "../../../public/names-zh.js";

const ESPN = "https://site.web.api.espn.com";
const DONGQIUDI = "https://pc.dongqiudi.com";
const DQD_DATA = "https://sport-data.dongqiudi.com";
type TeamInfo={id?:string|number;displayName?:string};
type SummaryCompetition={date?:string;status?:{type?:{state?:string}};competitors?:{homeAway?:string;team?:TeamInfo}[]};
type RosterRow={team?:TeamInfo;formation?:string;roster?:{starter?:boolean;athlete?:{displayName?:string};position?:{displayName?:string}}[]};
type FormRow={team?:TeamInfo;form?:string;events?:{gameDate?:string;opponent?:{displayName?:string};gameResult?:string;score?:string;leagueName?:string;competitionName?:string}[]};
type StandingEntry={id?:string|number;team?:string|TeamInfo;stats?:{name?:string;value?:unknown}[]};
type NewsArticle={headline?:string;description?:string;published?:string;links?:{web?:{href?:string}}};
type SummaryPayload={header?:{competitions?:SummaryCompetition[];league?:{name?:string;abbreviation?:string};season?:{type?:string}};rosters?:RosterRow[];lastFiveGames?:FormRow[];standings?:{groups?:{standings?:{entries?:StandingEntry[]}}[];fullViewLink?:{href?:string}};news?:{articles?:NewsArticle[]}[]};
type DqdNews={id:string;title:string;published:string;url:string;availabilitySignal:boolean};
type DqdRow={team:string;teamId?:string;sourceUrl:string;capturedAt:number;news:DqdNews[];availabilitySignals:number;matchStatus?:string};
type DqdConfigPayload={data?:{list?:{data?:{competition_id?:string|number;season_id?:string|number}[]}}};
type DqdStandingsPayload={content?:{rounds?:{content?:{data?:{team_id?:string|number;team_name?:string}[]};data?:{team_id?:string|number;team_name?:string}[]}[]}};
let dqdMapCache: {at:number;map:Map<string,string>}|null = null;
const dqdLeagueMapCache = new Map<string,{at:number;map:Map<string,string>}>();
const dqdPageCache = new Map<string,{at:number;data:DqdRow}>();
let dqdConfigCache: {at:number;competitions:Map<string,number>}|null = null;
// Full research responses are expensive (~10s of upstream calls). Cache
// the final payload for 10 minutes so re-opening a match is instant and
// parallel clicks do not hammer ESPN/DQD.
const researchResponseCache=new Map<string,{at:number;body:string;degraded?:boolean}>();
const RESEARCH_TTL=10*60*1000;
const dqdLeagueCompetition:Record<string,string> = {"eng.1":"4","eng.2":"2","esp.1":"3","esp.2":"8","ita.1":"9","ita.2":"10","ger.1":"5","ger.2":"14","fra.1":"12","fra.2":"13","ned.1":"7","por.1":"15","bel.1":"16","tur.1":"17","sco.1":"18","chn.1":"43","jpn.1":"34","ksa.1":"111","usa.1":"22","mex.1":"21","bra.1":"6","arg.1":"20","uefa.champions":"6","uefa.europa":"7"};
const dqdAliases:Record<string,string> = {"barcelona":"巴塞罗那","barcafc":"巴塞罗那","racingsantander":"桑坦德竞技","racingclub":"桑坦德竞技","internazionale":"国际米兰","inter":"国际米兰","asroma":"罗马","roma":"罗马","acmilan":"AC米兰","milan":"AC米兰","juventus":"尤文图斯","napoli":"那不勒斯","atleticomadrid":"马德里竞技","realmadrid":"皇家马德里","realbetis":"皇家贝蒂斯","sevilla":"塞维利亚","arsenal":"阿森纳","chelsea":"切尔西","liverpool":"利物浦","manchesterunited":"曼联","manchestercity":"曼城","tottenhamhotspur":"托特纳姆热刺","tottenham":"托特纳姆热刺","bayernmunich":"拜仁慕尼黑","bayern":"拜仁慕尼黑","borussiadortmund":"多特蒙德","dortmund":"多特蒙德","bayerleverkusen":"勒沃库森","leverkusen":"勒沃库森","rbleipzig":"RB莱比锡","leipzig":"RB莱比锡","eintrachtfrankfurt":"法兰克福","frankfurt":"法兰克福","vfbstuttgart":"斯图加特","stuttgart":"斯图加特","borussiamonchengladbach":"门兴格拉德巴赫","monchengladbach":"门兴格拉德巴赫","gladbach":"门兴格拉德巴赫","1fcunionberlin":"柏林联合","unionberlin":"柏林联合","scfreiburg":"弗赖堡","freiburg":"弗赖堡","tsghoffenheim":"霍芬海姆","hoffenheim":"霍芬海姆","1fsvmainz05":"美因茨","mainz05":"美因茨","mainz":"美因茨","fcaugsburg":"奥格斯堡","augsburg":"奥格斯堡","werderbremen":"云达不莱梅","bremen":"云达不莱梅","fcschalke04":"沙尔克04","schalke04":"沙尔克04","schalke":"沙尔克04","fckoln":"科隆","koln":"科隆","hamburgersv":"汉堡","hamburg":"汉堡","svelversberg":"埃尔沃斯贝格","elversberg":"埃尔沃斯贝格","scpaderborn07":"帕德博恩","paderborn":"帕德博恩","psg":"巴黎圣日耳曼","parissaintgermain":"巴黎圣日耳曼","shanghaiport":"上海海港"};

function outcomeProbabilities(homeLambda:number,awayLambda:number){
  const mass=(lambda:number)=>{const rows=[Math.exp(-lambda)];for(let n=1;n<=14;n++)rows.push(rows.at(-1)!*lambda/n);return rows;};
  const home=mass(homeLambda),away=mass(awayLambda);let h=0,d=0,a=0;
  for(let i=0;i<home.length;i++)for(let j=0;j<away.length;j++){const p=home[i]*away[j];if(i>j)h+=p;else if(i===j)d+=p;else a+=p;}
  const total=h+d+a;return {home:h/total,draw:d/total,away:a/total};
}

async function jsonFrom<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
  await requireOk(response,"ESPN");
  return await readJsonLimited(response,3_000_000) as T;
}

async function textFrom(url: string): Promise<string> {
  const response = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(9000) });
  await requireOk(response,"Dongqiudi");
  return readTextLimited(response,2_000_000);
}

async function dqdJsonFrom<T>(url:string):Promise<T>{
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(9000)});
  await requireOk(response,"Dongqiudi data");
  return await readJsonLimited(response,3_000_000) as T;
}

function normalizeTeamName(name:string) {
  // Fold Latin diacritics so ESPN names (1. FC Köln, Borussia
  // Mönchengladbach, São Paulo) can match aliases and DQD map keys.
  return String(name||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[.\-·\s队俱乐部足球]/g,"").replace(/ß/g,"ss");
}

async function dongqiudiLeagueMap(league:string):Promise<Map<string,string>>{
  const now=Date.now(),cached=dqdLeagueMapCache.get(league);
  if(cached&&now-cached.at<6*60*60*1000)return cached.map;
  const competition=dqdLeagueCompetition[league];
  if(!competition)return new Map();
  try{
    if(!dqdConfigCache||now-dqdConfigCache.at>6*60*60*1000){
      // The data_menu config moved off sport-data (404 since 2026-09);
      // pc.dongqiudi.com serves it now. Try both so a future host change
      // degrades to the other domain instead of an empty league map.
      let payload:DqdConfigPayload;
      try{payload=await dqdJsonFrom<DqdConfigPayload>(DQD_DATA+"/api/v2/config/data_menu?mark=gif&platform=web&version=0&a=4");}
      catch{payload=await dqdJsonFrom<DqdConfigPayload>(DONGQIUDI+"/api/v2/config/data_menu?mark=gif&platform=web&version=0&a=4");}
      const entries=Array.isArray(payload?.data?.list?.data)?payload.data.list.data:[];
      const competitions=new Map<string,number>();
      for(const row of entries){if(row?.competition_id!=null&&row?.season_id!=null)competitions.set(String(row.competition_id),Number(row.season_id));}
      dqdConfigCache={at:now,competitions};
    }
    const season=dqdConfigCache?.competitions.get(competition); if(!season)return new Map();
    const payload=await dqdJsonFrom<DqdStandingsPayload>(DQD_DATA+`/soccer/biz/data/standing?season_id=${season}&app=dqd&version=850&platform=ios&language=zh-cn`);
    const map=new Map<string,string>();
    const rounds=Array.isArray(payload?.content?.rounds)?payload.content.rounds:[];
    for(const round of rounds){const rows=Array.isArray(round?.content?.data)?round.content.data:Array.isArray(round?.data)?round.data:[];for(const row of rows){if(row?.team_id&&row?.team_name)map.set(normalizeTeamName(row.team_name),String(row.team_id));}}
    putBoundedCache(dqdLeagueMapCache,league,{at:now,map},96,24*60*60*1000); return map;
  }catch{return new Map();}
}

async function dongqiudiTeamId(teamName:string,league:string): Promise<string|null> {
  // Prefer the hand-written alias, then the shared zh display map (an
  // English name that translates to its official DQD Chinese name hits
  // the league map directly), then the raw name as before.
  const normalized=normalizeTeamName(teamName);
  const alias=dqdAliases[normalized]||teamZh(teamName)||teamName;
  const known:Record<string,string> = {"上海海港":"50007190","上海上港":"50007190","国际米兰":"50001042","巴塞罗那":"50001756","桑坦德竞技":"50001768","罗马":"50001766","皇家马德里":"50001755","马德里竞技":"50001759"};
  const direct=known[alias]||known[normalized];
  if(direct)return direct;
  const leagueMap=await dongqiudiLeagueMap(league);
  const matched=leagueMap.get(normalizeTeamName(alias)); if(matched)return matched;
  const now=Date.now();
  if(!dqdMapCache||now-dqdMapCache.at>6*60*60*1000) {
    try {
      const html=await textFrom(DONGQIUDI + "/data?expanded=1"), map=new Map<string,string>();
      const re=/\{id:"(\d+)",rank:[^,]+,name:"([^"]+)"/g; let hit:RegExpExecArray|null;
      while((hit=re.exec(html))) map.set(normalizeTeamName(hit[2]),hit[1]);
      dqdMapCache={at:now,map};
    } catch { dqdMapCache={at:now,map:new Map()}; }
  }
  return dqdMapCache.map.get(normalizeTeamName(alias))||null;
}

function parseDongqiudiTeamPage(html:string, teamName:string, teamId:string):DqdRow {
  const news:DqdNews[]=[];
  const section=html.match(/newsList:\[([\s\S]*?)\],(?:schedule|matches|players|team)/)?.[1]||html;
  const re=/\{id:(\d+),title:"((?:\\.|[^"])*)",category:[^,]+,time:"([^"]*)"/g; let hit:RegExpExecArray|null;
  while((hit=re.exec(section))&&news.length<30) {
    const title=hit[2].replace(/\\u([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\(["\\])/g,"$1");
    const published=hit[3],at=Date.parse(published);
    if(!Number.isFinite(at)||Date.now()-at>14*86400000||at>Date.now()+5*60000) continue;
    news.push({id:hit[1],title,published,url:DONGQIUDI + "/articles/" + hit[1],availabilitySignal:/(缺战|伤停|受伤|停赛|无缘|出战成疑|伤愈|复出|轮休|疲劳|肌肉|膝|腿筋|脚踝|首发|大名单|出场)/i.test(title)});
  }
  return {team:teamName,teamId,sourceUrl:DONGQIUDI + "/team/" + teamId,capturedAt:Date.now(),news,availabilitySignals:news.filter(row=>row.availabilitySignal).length};
}

async function dongqiudiResearch(teams:{name:string}[],league:string):Promise<DqdRow[]> {
  // Available DQD IDs and league maps identify men's clubs only. A women's
  // Barcelona/Real Madrid is a different entity despite the same short name.
  if(womensCompetition(league))return teams.map(team=>({team:team.name,sourceUrl:"",capturedAt:Date.now(),news:[],availabilitySignals:0,matchStatus:"unsupported-gender"}));
  const rows:DqdRow[]=[];
  for(const team of teams) {
    const teamId=await dongqiudiTeamId(team.name,league);
    if(!teamId){rows.push({team:team.name,sourceUrl:DONGQIUDI + "/data?expanded=1",capturedAt:Date.now(),news:[],availabilitySignals:0,matchStatus:"unmatched"});continue;}
    const cached=dqdPageCache.get(teamId);
    if(cached&&Date.now()-cached.at<10*60*1000){rows.push(cached.data);continue;}
    try { const data=parseDongqiudiTeamPage(await textFrom(DONGQIUDI + "/team/" + teamId),team.name,teamId); putBoundedCache(dqdPageCache,teamId,{at:Date.now(),data},128,10*60*1000); rows.push(data); }
    catch { rows.push({team:team.name,teamId,sourceUrl:DONGQIUDI + "/team/" + teamId,capturedAt:Date.now(),news:[],availabilitySignals:0,matchStatus:"source-unavailable"}); }
  }
  return rows;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const league = query.get("league") || "", id = query.get("id") || "";
  if (!/^[a-z0-9_.]{3,48}$/.test(league) || !/^\d{5,30}$/.test(id)) return Response.json({ ok:false, error:"无效赛事标识" }, { status:400 });
  const cacheKey = `${league}:${id}`;
  const cached = researchResponseCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.degraded ? 2*60*1000 : RESEARCH_TTL)) return new Response(cached.body, { headers: { "cache-control": "no-store", "content-type": "application/json" } });
  const respond = (body:unknown, degraded = false) => {
    putBoundedCache(researchResponseCache,cacheKey,{at:Date.now(),body:JSON.stringify(body),degraded},80,RESEARCH_TTL,8_000_000,row=>row.body.length*2);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  };
  const sourceUrl = `${ESPN}/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/summary?event=${id}`;
  try {
    const summary = await jsonFrom<SummaryPayload>(sourceUrl);
    const competition = summary?.header?.competitions?.[0];
    const state = String(competition?.status?.type?.state || "unknown");
    const kickoffAt = Date.parse(competition?.date || summary?.header?.competitions?.[0]?.date || "");
    const rosters = Array.isArray(summary.rosters) ? summary.rosters.slice(0,2) : [];
    const orderedRosters = ["home","away"].map(side=>{const competitor=competition?.competitors?.find(c=>c.homeAway===side);return rosters.find(r=>String(r.team?.id)===String(competitor?.team?.id))||{team:competitor?.team,roster:[]};});
    const teams = orderedRosters.map(row => ({
      id:String(row.team?.id || ""), name:String(row.team?.displayName || ""),
      formation:String(row.formation || ""),
      starters:(Array.isArray(row.roster) ? row.roster : []).filter(player=>player.starter===true).slice(0,11).map(player=>({name:String(player.athlete?.displayName||""),position:String(player.position?.displayName||"")})),
    }));
    const lineupConfirmed = teams.length===2 && teams.every(team=>team.starters.length===11);
    const lastFive=orderLastFive(Array.isArray(summary.lastFiveGames)?summary.lastFiveGames:[],teams);
    const rest = lastFive.map(row=>{
      const previous=row.games.map(game=>Date.parse(game.date)).filter(at=>Number.isFinite(at)&&Number.isFinite(kickoffAt)&&at<kickoffAt).sort((a,b)=>b-a)[0];
      return {team:row.team,lastMatchAt:Number.isFinite(previous)?previous:null,restDays:Number.isFinite(previous)?Math.max(0,Math.floor((kickoffAt-previous)/86400000)):null,sourceComplete:row.games.length>=3};
    });
    const standingEntries=(summary?.standings?.groups||[]).flatMap(group=>group?.standings?.entries||[]);
    const standing=(teamId:string,teamName:string)=>{
      const teamObject=(row:StandingEntry)=>typeof row.team==='object'?row.team:null;
      const entry=standingEntries.find(row=>String(row.id||teamObject(row)?.id||"")===teamId)||standingEntries.find(row=>String(typeof row.team==='string'?row.team:teamObject(row)?.displayName||"").toLowerCase()===teamName.toLowerCase());
      const value=(name:string)=>Number(entry?.stats?.find(stat=>stat.name===name)?.value);
      return entry?{team:teamName,rank:value("rank"),points:value("points"),goalDifference:value("pointDifferential"),gamesPlayed:value("gamesPlayed"),sourceUrl:String(summary?.standings?.fullViewLink?.href||"")}:null;
    };
    const standings=teams.map(team=>standing(team.id,team.name)).filter(Boolean);
    const news = (Array.isArray(summary.news)?summary.news:[]).flatMap(section=>Array.isArray(section.articles)?section.articles:[]).filter(article=>{
      const text=String(article.headline||"")+" "+String(article.description||"");
      return newsInScope(text,String(article.published||""),teams.map(team=>team.name),league,kickoffAt);
    }).slice(0,5).map(article=>{const text=String(article.headline||"")+" "+String(article.description||"");return {headline:String(article.headline||""),description:String(article.description||"").slice(0,280),published:String(article.published||""),url:String(article.links?.web?.href||""),availabilitySignal:/(injur|doubt|ruled out|miss|suspend|fitness|return|伤|停赛|缺阵)/i.test(text)};});
    const injurySources = teams.map(team=>({team:team.name,url:/^\d{2,20}$/.test(team.id)?`${ESPN}/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/teams/${team.id}/injuries`:""}));
    const injuryChecks = await Promise.allSettled(injurySources.map(async (source:{team:string;url:string})=>({source,rows:await jsonFrom<unknown>(source.url)})));
    const injuries = injuryChecks.map((result,index)=>{
      if(result.status!=="fulfilled")return {team:injurySources[index].team,sourceUrl:injurySources[index].url,reportStatus:"unavailable",reportAvailable:false,reportCount:0,list:[],error:"伤停接口不可用"};
      const {status,entries}=classifyInjuryPayload(result.value.rows||{});
      // Named absences when ESPN actually carries them: player, position,
      // status and the short reason. Empty for many clubs — the frontend
      // must say so instead of inventing names.
      const list=entries.slice(0,8).map(item=>({
        player:String(item.athlete?.displayName||item.athlete?.shortDisplayName||""),
        position:String(item.athlete?.position?.abbreviation||item.athlete?.position?.displayName||""),
        status:String(item.status||item.type?.description||item.details?.type||"状态未标注"),
        detail:String(item.shortComment||item.details?.detail||item.longComment||"").slice(0,120),
      })).filter(row=>row.player);
      return {team:injurySources[index].team,sourceUrl:injurySources[index].url,reportStatus:status,reportAvailable:status==="named"&&list.length>0,reportCount:list.length,list};
    });
    const availabilityNews=news.filter(item=>item.availabilitySignal);
    const dongqiudi=await dongqiudiResearch(teams,league);
    const goalEvidence=teams.length===2?await goalEvidenceForMatches([{id,leagueCode:league,status:"soon",homeId:teams[0].id,awayId:teams[1].id}]).then(rows=>rows.get(id)||null).catch(()=>null):null;
    // Names/statuses are useful research evidence, but no calibrated player-
    // impact coefficients exist. Even confirmed absences must not silently
    // alter goal rates or margins using an arbitrary hand-picked constant.
    const dongqiudiSignals=dongqiudi.reduce((sum,row)=>sum+Number(row.availabilitySignals||0),0);
    const structuredAbsences=verifiedAbsenceCount(injuries);
    const adjustedGoalEvidence=goalEvidence?{...goalEvidence,availabilityInputs:{dongqiudiAvailabilitySignals:dongqiudiSignals,availabilityNews:availabilityNews.length,structuredAbsences,marginBump:0},assumptions:[...goalEvidence.assumptions,`ESPN 结构化名单明确缺阵/停赛 ${structuredAbsences} 人；新闻标题 ${dongqiudiSignals+availabilityNews.length} 条只供核对。尚无球员影响校准，以上均未改变概率或不确定性边际`]}:null;
    const halfTimeModel=adjustedGoalEvidence?{modelVersion:"poisson-first-half-standings-v1",calculatedAt:Date.now(),expectedHome:adjustedGoalEvidence.expectedHome*.45,expectedAway:adjustedGoalEvidence.expectedAway*.45,probabilities:outcomeProbabilities(adjustedGoalEvidence.expectedHome*.45,adjustedGoalEvidence.expectedAway*.45),assumptions:["上半场期望进球暂按全场的 45% 缩放","未纳入已确认首发、伤停、新闻或疲劳","没有公开半场双边赔率，不生成半场模拟单","未做历史回测与概率校准"]}:null;
    // Deep-dive (user 2026-09-19): blogger-style full breakdown per match,
    // generated from the same data the model consumes. No invented facts.
    const deepDive=buildDeepDive({
      home:teams[0]?.name||"主队",away:teams[1]?.name||"客队",
      homeZh:teams[0]?.name,awayZh:teams[1]?.name,
      homeForm:lastFive?.[0]?.form,awayForm:lastFive?.[1]?.form,
      expectedHome:adjustedGoalEvidence?.expectedHome,expectedAway:adjustedGoalEvidence?.expectedAway,
      dqdSignals:[Number(dongqiudi?.[0]?.availabilitySignals||0),Number(dongqiudi?.[1]?.availabilitySignals||0)],homeRest:rest?.[0]?.restDays,awayRest:rest?.[1]?.restDays,
      lineupConfirmed,injuryAvailable:injuries.every(row=>row.reportAvailable),
      newsTop:news?.slice(0,3)?.map(n=>String(n?.headline||"")),odds:[],leagueCode:league,
      lastFive,injuries,teams,standings,goalEvidence:adjustedGoalEvidence,sourceUrl,
    });
    const contextQuality={
      lineup:lineupConfirmed?"confirmed":"unconfirmed",
      injuryEvidence:injuries.length===2&&injuries.every(row=>row.reportStatus==="named")?"named":injuries.length===2&&injuries.every(row=>row.reportStatus==="empty")?"empty":injuries.some(row=>row.reportStatus==="named"||row.reportStatus==="empty")?"partial":"missing",
      restEvidence:rest.every(row=>Number.isFinite(row.restDays))?"available":"partial",
      standingsEvidence:standings.length===2?"available":"partial",
      availabilityNews:availabilityNews.length,
      dongqiudi:womensCompetition(league)?"unsupported-gender":dongqiudi.length===2&&dongqiudi.every(row=>row.teamId&&!row.matchStatus)?"available":"partial",
    };
    return respond({ok:true,provider:"ESPN public match summary + 懂球帝公开球队页（按联赛可用）",sourceUrl,capturedAt:Date.now(),sourceUpdatedAt:null,state,lineupConfirmed,teams,lastFive,rest,standings,competition:{name:String(summary?.header?.league?.name||summary?.header?.league?.abbreviation||league),seasonType:String(summary?.header?.season?.type||"")},news,availabilityNews,injuries,dongqiudi,availabilityHeadlines:dongqiudi.flatMap(row=>row.news.filter(n=>n.availabilitySignal).map(n=>({team:row.team,title:n.title,published:n.published,url:n.url}))).slice(0,10),goalEvidence:adjustedGoalEvidence,halfTimeModel,deepDive,contextQuality,missing:{confirmedLineup:!lineupConfirmed,matchNews:news.length===0,injuryReport:injuries.some(row=>!row.reportAvailable),completeFixtureHistory:rest.some(row=>!row.sourceComplete),halfTimeOdds:true,dongqiudi:dongqiudi.some(row=>!!row.matchStatus)},modelUsage:"积分榜进球分布用于基线；伤停名单和新闻标题展示来源、状态与缺失，但尚无经校准的球员影响系数，不自动改变进球方向、概率或不确定性边际。女足同名男足页面不接入；首发和休息尚未用于概率方向性修正。"});
  } catch(error) {
    console.error("match_research_unavailable",{league,id,error:String(error)});
    // Keep the match page usable when an upstream provider is temporarily
    // unavailable. This is deliberately a degraded response: no guessed
    // lineup, injury, fatigue, or betting edge is presented as fact.
    return respond({
      ok:true,
      degraded:true,
      error:"ESPN/懂球帝公开研究源暂时未返回本场资料",
      provider:"ESPN public match summary + 懂球帝公开球队页",
      sourceUrl,
      capturedAt:Date.now(),
      state:"unknown",
      lineupConfirmed:false,
      teams:[],lastFive:[],rest:[],standings:[],news:[],availabilityNews:[],injuries:[],dongqiudi:[],
      contextQuality:{lineup:"unconfirmed",injuryEvidence:"missing",restEvidence:"missing",standingsEvidence:"missing",availabilityNews:0,dongqiudi:"partial"},
      modelUsage:"上游研究资料暂时不可用；本轮不猜测首发、伤停、疲劳或投注优势。"
    },true);
  }
}
