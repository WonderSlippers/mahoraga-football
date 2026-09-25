import { readLedger } from "@/db/ledger";
import {env} from 'cloudflare:workers';
import { ownerWriteDenied } from "@/lib/site-owner";
import { readLatestOdds, prepareOddsSnapshotStatements } from "@/db/odds";
import { applyFeaturedAnalyses, featuredOpenLegs, pendingFeaturedLegs, pendingLabLegs, prepareSimulationLab, readLab } from "@/lib/simulation-lab";
import {prepareModelObservationStatements} from '@/db/model-observations';
import {prepareSamplingAuditStatement} from '@/db/sampling-audit';
import {prepareMarketQuoteStatements} from '@/db/market-quotes';
import {prepareMarketResultStatements,pendingMarketResults} from '@/db/market-results';
import {officialMatches,attachOfficial} from '@/lib/jleague-source';
import {afcResults,attachAfc} from '@/lib/afc-source';
import {goalEvidenceForMatches,type GoalEvidence} from '@/lib/goal-model';
import {linkedResearchGoalEvidence} from '@/lib/research-evidence';
import { GET as matchResearchGET } from '../match-research/route';
import {loadMergedFeed} from '../feed/route';
import {localScanWritesAllowed} from '@/lib/local-scan-policy';
import {requireOk} from '@/lib/http-response';
import {readJsonLimited} from '@/lib/limited-response';
import {acquireScanLease,releaseScanLease} from '@/db/scan-lock';
import {beginScanProgress,finalizeScanWithLedger,prepareScanFinalizationStatements,readScanProgress,markScanProgress as markScanProgressWithLease} from '@/db/scan-progress';
import {commitAtomicScan} from '@/db/scan-atomic';
import {prepareLabShardCommit} from '@/lib/lab-shards.js';
import {decimalOdds,selectCurrentMoneyline} from '../../../public/odds-policy.js';
import {planScanBatch} from '@/lib/scan-batch';
import {summarizeQuoteCoverage} from '@/lib/odds-coverage.js';

const LEAGUES = [
  "eng.1","eng.2","esp.1","ita.1","ger.1","fra.1","uefa.champions","uefa.europa","uefa.europa.conf",
  "usa.1","mex.1","bra.1","arg.1","chn.1","fifa.world","ned.1","por.1","bel.1","tur.1","sco.1",
  "jpn.1","ksa.1","conmebol.libertadores","conmebol.sudamericana","usa.nwsl",
  "fifa.friendly","fifa.friendly.w","eng.w.1","esp.w.1","fra.w.1","aus.w.1","uefa.wchampions","uefa.wchampions_qual","uefa.w.europa","uefa.w.nations","concacaf.w.champions_cup",
  "fifa.worldq.uefa","fifa.worldq.afc","fifa.worldq.caf","fifa.worldq.concacaf","fifa.worldq.conmebol","fifa.worldq.ofc","concacaf.nations.league","uefa.euroq","afc.cupq","caf.nations_qual",
  "ger.2","esp.2","fra.2","eng.3","aus.1","sui.1","aut.1","eng.league_cup",
  "eng.fa","ger.dfb_pokal","esp.copa_del_rey","ita.coppa_italia","fra.coupe_de_france","afc.champions","afc.cup","concacaf.champions","uefa.nations","bra.copa_do_brazil","arg.copa",
] as const;

type Bet={status?:string;day?:string;ts?:number;matchId?:string;leagueCode?:string;marketPhase?:string;pick?:number;odds?:number;stake?:number;kickoffAt?:number;priceProvider?:string;modelProbability?:number;pnl?:number;settledAt?:number;source?:string;clv?:number;[key:string]:unknown};
type ScanJournal={day:string;scans:number;bets:number;maxEligible:number;lastAt?:number;persistedAt?:number;monitored?:number;live?:number;upcoming?:number;pricedUpcoming?:number;oddsCoverage?:OddsCoverage;scanScope?:{kind:string;slot:number;slots:number;selectedLeagues:string[];totalLeagues:number};failedLeagues?:number;failedLeagueCodes?:string[];labBets?:number;lastLabBets?:number;liveTimeAnomalies?:number;liveTimeAnomalyMatches?:string[];lastSource?:string;lastReason?:string;lastOutageErrors?:Record<string,number>};
type State = { initialBalance: number; balance: number; day: string; dayStartBalance: number; portfolioStartAt?: number; records: Bet[]; scanJournal: ScanJournal[] };
type Settings = { autoEnabled?: boolean; autoRunLiveOnly?: boolean; autoMinEdge?: number; autoMaxBets?: number; dailyStopLossPct?: number; maxExposurePct?: number; mode?: string; autoStake?: number; autoStakePct?: number };
type Verification={provider:string;sourceUrl:string;capturedAt:number;score:[number,number];primarySourceUrl?:string;primaryCapturedAt?:number};
type Match = { id: string; leagueCode: string; date: number; status: "soon" | "live" | "finished" | "unverified"; clock: string; minute: number; period: number; detail: string; hs: number; as: number; home: string; away: string; homeId?:string;awayId?:string;homeForm: string; awayForm: string; odds: number[]; providers: string[]; oddsReason?:string;oddsPhase?:string;scoreConflict?:boolean; sourceCount: number;independentFinalVerified?:boolean;settlementEvidence?:Verification;officialOnlyFinal?:boolean;officialSourceUrl?:string;sourceUrl?:string;observedAt?:number;homeLogo?:string;awayLogo?:string;leagueLogo?:string;totalOffers?:{line:number;over:number;under:number;provider:string;phase:string}[];spreadOffers?:{homeLine:number;awayLine:number;home:number;away:number;provider:string;phase:string}[];goalModel?:GoalEvidence;research?:{dqdSignals:[number,number];homeRest:number|null;awayRest:number|null;injuryAvailable:boolean;lineupConfirmed:boolean;newsMatched?:boolean;capturedAt?:number} };
type Decision = { match: Match; pick: number; odds: number; edge: number; probability: number; evidenceShift: number; confidence: number; provider: string; research: boolean };
type OddsCoverage = ReturnType<typeof summarizeQuoteCoverage>;
type ScanTeam={homeAway?:string;score?:unknown;form?:string;team?:{id?:string|number;displayName?:string;shortDisplayName?:string;logo?:string;logos?:{href?:string}[]}};
type QuoteValue={line?:string|number;odds?:unknown};
type QuotePhases={current?:QuoteValue;close?:QuoteValue;open?:QuoteValue};
type ScanOddsItem={provider?:{displayName?:string;name?:string};total?:{over?:QuotePhases;under?:QuotePhases};pointSpread?:{home?:QuotePhases;away?:QuotePhases}};
type ScanStatus={type?:{completed?:boolean;state?:string;name?:string;detail?:string;description?:string;shortDetail?:string};displayClock?:string;period?:number};
type ScanCompetition={date?:string;competitors?:ScanTeam[];status?:ScanStatus;odds?:(ScanOddsItem|null)[]};
type ScanOfficial={state?:string;score?:number[];sourceUrl?:string;capturedAt?:number;provider?:string};
type ScanEvent={id?:string|number;date?:string;competitions?:ScanCompetition[];status?:ScanStatus;_edgeOfficial?:ScanOfficial;_edgeScoreConflict?:boolean};
type ScanPayload={content?:{sbData?:{events?:unknown;leagues?:{logos?:{href?:string}[]}[]}};events?:unknown;data?:{events?:unknown}};
type ResearchPayload={ok?:boolean;degraded?:boolean;capturedAt?:number;sourceUrl?:string;deepDive?:{summary?:string;sections?:{title?:string;paras?:string[]}[]};dongqiudi?:{availabilitySignals?:number;matchStatus?:string}[];rest?:{restDays?:number|null}[];contextQuality?:{lineup?:string;injuryEvidence?:string;restEvidence?:string};lineupConfirmed?:boolean};
type DeepAnalysis=NonNullable<Awaited<ReturnType<typeof pendingFeaturedLegs>>[number]['deepAnalysis']>;
function researchDeepAnalysis(data:ResearchPayload):DeepAnalysis|undefined {
  const deep=data.deepDive;
  if(!deep?.summary||!Array.isArray(deep.sections))return undefined;
  return {summary:String(deep.summary),sections:deep.sections.slice(0,7).map(section=>({title:String(section?.title||""),paras:Array.isArray(section?.paras)?section.paras.slice(0,8).map(String):[]})),capturedAt:Number(data.capturedAt)||Date.now(),sourceUrl:String(data.sourceUrl||''),coverage:`首发 ${data.contextQuality?.lineup||"未知"} · 伤停 ${data.contextQuality?.injuryEvidence||"未知"} · 赛程 ${data.contextQuality?.restEvidence||"未知"}`};
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const money = (value: unknown) => Math.max(0, number(value));
const dayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateKey = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");
const scanDateKeys = (now = Date.now()) => [dateKey(new Date(now)), dateKey(new Date(now + 86400000))];
const radarDateRange = (now = Date.now()) => `${dateKey(new Date(now))}-${dateKey(new Date(now + 7 * 86400000))}`;
const minuteOf = (clock: string) => { const found = clock.match(/(\d{1,3})(?:\+(\d{1,2}))?/); return found ? Number(found[1]) + Number(found[2] || 0) : 0; };
const normalize = (values: number[]) => { const safe = values.map(value => Math.max(.025, number(value))); const sum = safe.reduce((a, b) => a + b, 0); return safe.map(value => value / sum); };
const formPoints = (form: string) => { const chars = String(form || "").toUpperCase().split(""); return chars.length ? chars.reduce((total, char) => total + (char === "W" ? 3 : char === "D" ? 1 : 0), 0) / chars.length : 1.35; };
const oddsValue = decimalOdds;

function parseOdds(competition:ScanCompetition,allowCloseReference:boolean) {
  const quote=selectCurrentMoneyline(competition,{allowCloseReference});
  return {odds:quote.odds,providers:[quote.provider,quote.provider,quote.provider],oddsReason:quote.reason,oddsPhase:quote.phase};
}

function summarizeOddsCoverage(matches:Match[],capturedAt=Date.now()):OddsCoverage {
  return summarizeQuoteCoverage(matches,capturedAt);
}

async function settledBatches<T,R>(items:T[],limit:number,worker:(item:T,index:number)=>Promise<R>) {
  const results:PromiseSettledResult<R>[]=[];
  for(let offset=0;offset<items.length;offset+=limit){
    const slice=items.slice(offset,offset+limit);
    results.push(...await Promise.allSettled(slice.map((item,index)=>worker(item,offset+index))));
  }
  return results;
}

function parseTotals(competition:ScanCompetition) {
  const items=Array.isArray(competition?.odds)?competition.odds:[];
  return items.flatMap(item=>{
    // ESPN occasionally emits a literal null entry inside odds[] (observed esp.2/tur.1):
    // reading item.total off it crashed the whole league scan.
    if(!item) return [];
    for(const phase of ['current','close','open'] as const) {
      const over=item.total?.over?.[phase],under=item.total?.under?.[phase];
      // Never pair a price with another phase's line or infer quarter-line rules.
      const lineText=String(over?.line??'').replace(/^o/i,''),underText=String(under?.line??'').replace(/^u/i,'');
      const line=Number(lineText),overPrice=oddsValue(over?.odds),underPrice=oddsValue(under?.odds);
      if(lineText&&underText&&Number.isFinite(line)&&line===Number(underText)&&line>0&&overPrice&&underPrice&&overPrice>1&&underPrice>1)
        return [{line,over:overPrice,under:underPrice,provider:String(item.provider?.displayName||item.provider?.name||'公开参考价'),phase}];
    }
    return [];
  });
}

function parseSpreads(competition:ScanCompetition) {
  const items=Array.isArray(competition?.odds)?competition.odds:[];
  return items.flatMap(item=>{
    if(!item) return []; // same null-entry guard as parseTotals
    for(const phase of ['current','close','open'] as const) {
      const home=item.pointSpread?.home?.[phase],away=item.pointSpread?.away?.[phase];
      const homeLine=Number(home?.line),awayLine=Number(away?.line),homePrice=oddsValue(home?.odds),awayPrice=oddsValue(away?.odds);
      // Require exact opposite half-goal lines and both prices from the same provider/phase.
      if(home?.line!=null&&away?.line!=null&&String(home.line).trim()!==''&&String(away.line).trim()!==''&&homeLine===-awayLine&&Number.isFinite(homeLine)&&Number.isInteger(homeLine*4)&&homePrice&&awayPrice&&homePrice>1&&awayPrice>1)
        return [{homeLine,awayLine,home:homePrice,away:awayPrice,provider:String(item.provider?.displayName||item.provider?.name||'公开参考价'),phase}];
    }
    return [];
  });
}

function normalizeEvent(event:ScanEvent, leagueCode: string, pendingIds?: Set<string>, horizonDays = 2.5): Match | null {
  const competition = event?.competitions?.[0] || {};
  const teams = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = teams.find(team => team.homeAway === "home") || teams[0];
  const away = teams.find(team => team.homeAway === "away") || teams[1];
  if (!home || !away || !event?.id) return null;
  const date = Date.parse(event.date || competition.date || "");
  if (!Number.isFinite(date)) return null;
  // Historical lookups may bypass the radar window only for persisted open legs.
  if (pendingIds ? !pendingIds.has(String(event.id)) : date < Date.now() - 2.5 * 86400000 || date > Date.now() + horizonDays * 86400000) return null;
  const rawStatus = competition.status || event.status || {};
  const type = rawStatus.type || {};
  const clock = String(rawStatus.displayClock || type.shortDetail || "");
  const minute = minuteOf(clock);
  const detail = [type.name, type.detail, type.description].filter(Boolean).join(" ");
  let status: Match["status"] = type.completed || type.state === "post" ? "finished" : type.state === "in" ? "live" : "soon";
  const elapsed = (Date.now() - date) / 60000;
  if (status === "live" && (elapsed < -20 || elapsed > Math.max(240, minute + 120))) status = "unverified";
  if (status === "finished" && elapsed < -10) status = "unverified";
  if ((status === "live" || status === "finished") && !/(cancel|abandon)/i.test(detail) && ![home.score, away.score].every(score => score != null && /^\d+$/.test(String(score)))) status = "unverified";
  const { odds, providers, oddsReason, oddsPhase } = parseOdds(competition,status==="soon"&&date>Date.now());
  const official=event._edgeOfficial;
  const officialScore=Array.isArray(official?.score)&&official.score.length===2&&official.score.every(score=>Number.isInteger(score)&&score>=0)?[official.score[0],official.score[1]] as [number,number]:null;
  const officialAt=Number(official?.capturedAt||0);
  const authorizedOfficialUrl=official?.sourceUrl?.startsWith("https://www.jleague.jp/en/match/")||official?.sourceUrl?.startsWith("https://www.the-afc.com/en/club/afc_champions_league_elite.html/news/md");
  const officialRecent=Boolean(officialScore&&authorizedOfficialUrl&&Number.isSafeInteger(officialAt)&&officialAt>0&&Date.now()-officialAt<10*60000);
  const independentlyVerified=Boolean(status==="finished"&&!event._edgeScoreConflict&&official?.state==="finished"&&officialRecent&&officialScore&&officialScore[0]===number(home.score,-1)&&officialScore[1]===number(away.score,-1));
  const officialOnlyFinal=Boolean(!independentlyVerified&&official?.state==="finished"&&officialRecent);
  return {
    id: String(event.id), leagueCode, date, status:officialOnlyFinal?"finished":status, clock, minute, period: officialOnlyFinal?2:number(rawStatus.period), detail:officialOnlyFinal?detail+" "+String(official?.provider||'官方赛果')+" final / ESPN pending":detail,
    hs: officialOnlyFinal&&officialScore?officialScore[0]:number(home.score), as:officialOnlyFinal&&officialScore?officialScore[1]:number(away.score), home: home.team?.shortDisplayName || home.team?.displayName || "主队",
    away: away.team?.shortDisplayName || away.team?.displayName || "客队", homeId:String(home.team?.id||""),awayId:String(away.team?.id||""),homeForm: String(home.form || ""), awayForm: String(away.form || ""),
    odds:officialOnlyFinal?[0,0,0]:odds, providers:officialOnlyFinal?[]:providers, oddsReason:officialOnlyFinal?"已完场，无当前赛前报价":oddsReason,oddsPhase:officialOnlyFinal?"none":oddsPhase,scoreConflict:!!event._edgeScoreConflict, sourceCount: independentlyVerified?2:officialOnlyFinal?2:1,independentFinalVerified:independentlyVerified,officialOnlyFinal,officialSourceUrl:officialOnlyFinal?official?.sourceUrl:undefined,
    settlementEvidence:independentlyVerified&&officialScore?{provider:String(official?.provider||'官方赛果'),sourceUrl:String(official?.sourceUrl||''),capturedAt:officialAt,score:officialScore}:undefined,
    homeLogo:home.team?.logo||home.team?.logos?.[0]?.href,awayLogo:away.team?.logo||away.team?.logos?.[0]?.href,totalOffers:officialOnlyFinal?[]:parseTotals(competition),spreadOffers:officialOnlyFinal?[]:parseSpreads(competition),
  };
}

async function fetchLeague(code: string, range: string, pendingIds?: Set<string>,officialRows:Awaited<ReturnType<typeof officialMatches>>=[],afcRows:Awaited<ReturnType<typeof afcResults>>=[]): Promise<Match[]> {
  const urls = [
    `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${encodeURIComponent(code)}&date=${range}&limit=100`,
    `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(code)}/scoreboard?dates=${range}&limit=100`,
  ];
  let json:ScanPayload|null=null, url=''; let lastError:unknown;
  // A single range request is substantially cheaper and more reliable than
  // fetching every future day independently. Reuse the feed route because it
  // already merges the two public scoreboards and enforces the legal horizon.
  if(range.includes('-')){
    try{
      const payload=await loadMergedFeed(code,range);
      if(Array.isArray(payload?.events)){json={events:payload.events};url=`http://localhost/api/feed?league=${code}&dates=${range}`;}
    }catch(error){lastError=error;}
  }
  for(const candidate of json?[]:urls){
    try{
      const response = await fetch(candidate, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      await requireOk(response,`ESPN ${code}`);
      json = await readJsonLimited(response,4_000_000) as ScanPayload; url=candidate; break;
    }catch(error){lastError=error;}
  }
  if(!json){
    // Reuse the feed route's dual-source recovery (CDN + Site API) before
    // declaring a league failed. This is important for J1: its CDN request
    // can time out while the Site API still returns the full priced slate.
    try{
      const payload=await loadMergedFeed(code,`${range}-${range}`);
      if(Array.isArray(payload?.events)){json={events:payload.events};url=`http://localhost/api/feed?league=${code}&dates=${range}-${range}`;}
    }catch{}
  }
  if(!json)throw lastError instanceof Error?lastError:new Error(`ESPN ${code} unavailable`);
  const events = json?.content?.sbData?.events || json?.events || json?.data?.events || [];
  if (!Array.isArray(events)) throw new Error(`ESPN ${code} malformed`);
  const leagueLogo=json?.content?.sbData?.leagues?.[0]?.logos?.[0]?.href;
  const observedAt=Date.now();
  const jleagueLinked=code==="afc.champions"&&officialRows.length?attachOfficial(events,officialRows):events;
  const linked=code==="afc.champions"&&afcRows.length?attachAfc(jleagueLinked,afcRows):jleagueLinked;
  const horizonDays=/^\d{4}$/.test(range)?22:range.includes('-')?8:2.5;
  const normalized=linked.map((event:ScanEvent):Match|null => {const match=normalizeEvent(event, code, pendingIds,horizonDays);return match?{...match,leagueLogo,sourceUrl:match.officialOnlyFinal?match.officialSourceUrl:url,observedAt,settlementEvidence:match.settlementEvidence?{...match.settlementEvidence,primarySourceUrl:url,primaryCapturedAt:observedAt}:undefined}:null;}).filter((match: Match | null): match is Match => !!match);
  return /^\d{4}$/.test(range)?normalized.filter(match=>match.date>=Date.now()-3*86400000&&match.date<=Date.now()+22*86400000):normalized;
}

function planBackfills(records: Bet[], range: string, now = Date.now()) {
  const groups = new Map<string, {code:string;date:string;ids:Set<string>}>();
  for (const record of records) {
    const kickoff = Number(record.kickoffAt);
    const leagueCode=String(record.leagueCode||'');
    if (record.status !== "open" || !Number.isFinite(kickoff) || kickoff <= 0 || !LEAGUES.some(code=>code===leagueCode)) continue;
    const date = dateKey(new Date(kickoff));
    if (date === range) continue;
    const key = `${record.leagueCode}:${date}`;
    if (!groups.has(key)) groups.set(key,{code:leagueCode,date,ids:new Set()});
    groups.get(key)!.ids.add(String(record.matchId));
  }
  const all = [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,group])=>group);
  // Rotate bounded batches each scheduled five-minute slot; no fixed prefix starvation.
  const pages = Math.ceil(all.length / 3), start = pages ? (Math.floor(now / 300000) % pages) * 3 : 0;
  return {total:all.length,selected:all.slice(start,start+3)};
}

function pregameDecision(match: Match, research = false): Decision | null {
  if (/(cancel|abandon|postpon|suspend)/i.test(match.detail)) return null;
  if (match.status !== "soon" || match.oddsPhase!=="current" || match.odds.some(price => price <= 1)) return null;
  const until = (match.date - Date.now()) / 60000;
  if (until < 10 || until > 24 * 60) return null;
  const market = normalize(match.odds.map(price => 1 / price));
  const formDelta = clamp((formPoints(match.homeForm) - formPoints(match.awayForm)) * .025, -.08, .08);
  const probabilities = normalize([market[0] + formDelta, market[1], market[2] - formDelta]);
  const evidenceShift = Math.max(...probabilities.map((probability, index) => Math.abs(probability - market[index])));
  const confidence = clamp(Math.round(42 + (match.odds.some(Boolean) ? 7 : 0) + (match.homeForm || match.awayForm ? 7 : 0)), 42, 78);
  const margin = (100 - confidence) / 100 * .055;
  const decisionProbs = probabilities.map(probability => clamp(probability - margin, .02, .96));
  const edges = match.odds.map((price, index) => decisionProbs[index] * price - 1);
  const pick = research ? probabilities.indexOf(Math.max(...probabilities)) : edges.indexOf(Math.max(...edges)), edge = edges[pick];
  if (research ? match.odds[pick] < 1.2 || match.odds[pick] > 3 || probabilities[pick] < .45 : edge <= .065 || evidenceShift < .015) return null;
  return { match, pick, odds: match.odds[pick], edge, probability: decisionProbs[pick], evidenceShift, confidence, provider: match.providers[pick], research };
}

function eligibleDecisions(matches: Match[], settings: Settings) {
  if (settings.autoRunLiveOnly !== false) return [];
  const floor = Math.max(0, number(settings.autoMinEdge, .05));
  const value = matches.map(match => pregameDecision(match)).filter((decision): decision is Decision => !!decision && decision.edge >= floor).sort((a, b) => b.edge - a.edge);
  const research = matches.map(match => pregameDecision(match, true)).filter((decision): decision is Decision => !!decision && !value.some(row => row.match.id === decision.match.id)).sort((a, b) => b.probability - a.probability || a.match.date - b.match.date);
  return [...value, ...research];
}

function normalizedState(raw:unknown): State {
  const input=raw&&typeof raw==='object'?raw as Partial<State>:{};
  return {
    ...input, initialBalance: money(input.initialBalance) || 10000, balance: money(input.balance), day: String(input.day || dayKey()),
    dayStartBalance: money(input.dayStartBalance) || money(input.balance), records: Array.isArray(input.records) ? input.records : [],
    scanJournal: Array.isArray(input.scanJournal) ? input.scanJournal : [],
  };
}

function settle(state: State, matches: Match[]) {
  const byId = new Map(matches.map(match => [match.id, match]));
  let settled = 0;
  for (const record of state.records) {
    if (record.status !== "open") continue;
    const match = byId.get(String(record.matchId));
    if (!match || match.leagueCode !== record.leagueCode) continue;
    if(match.status==="unverified")continue;
    // A public full-time score closes the paper ledger immediately. Source
    // agreement is retained as metadata, not used to block settlement.
    if((match.status==="finished"||/(cancel|abandon)/i.test(match.detail))&&!match.independentFinalVerified){record.note="按公开单源完场比分即时结算；后续交叉核验仅用于标记来源质量，不回滚已显示结算";}
    if (/(cancel|abandon)/i.test(match.detail)) { record.status = "void"; record.settledAt = Date.now(); record.finalScore = "作废"; record.pnl = 0; record.note = "模拟规则：赛事取消或终止，本笔作废，盈亏为零"; settled++; continue; }
    if (/(postpon|suspend)/i.test(match.detail)) { record.note = "比赛延期或暂停，等待赛果核验"; continue; }
    if (match.status !== "finished") continue;
    record.settlementEvidence=match.settlementEvidence||{provider:"公开单源完场比分（待后续交叉核验）",sourceUrl:match.sourceUrl||"",capturedAt:Date.now(),score:[match.hs,match.as]};
    if (match.period > 2 || /(AET|after extra time|penalt|shootout)/i.test(match.detail)) { record.status = "review"; record.finalScore = `${match.hs}—${match.as}`; record.note = "加时或点球后的公开比分不能直接结算常规时间 1X2"; settled++; continue; }
    const actual = match.hs > match.as ? 0 : match.hs === match.as ? 1 : 2;
    const won = number(record.pick, -1) === actual;
    record.status = won ? "win" : "loss"; record.settledAt = Date.now(); record.finalScore = `${match.hs}—${match.as}`;
    record.pnl = won ? money(record.stake) * (number(record.odds) - 1) : -money(record.stake);
    record.brier = Math.pow(number(record.modelProbability) - (won ? 1 : 0), 2);
    state.balance += record.pnl; settled++;
  }
  return settled;
}

function applyClosingReference(record: Bet, reference:Awaited<ReturnType<typeof readLatestOdds>>|undefined) {
  if (!reference || record.marketPhase === "滚球" || !["win", "loss"].includes(String(record.status||''))) return false;
  const kickoff = number(record.kickoffAt), captured = number(reference.captured_at);
  const close = number([reference.home_odds, reference.draw_odds, reference.away_odds][number(record.pick, -1)]);
  if (close <= 1 || kickoff <= 0 || captured < kickoff - 30 * 60000 || captured >= kickoff) return false;
  record.closingOdds = close; record.clv = number(record.odds) / close - 1;
  record.closingProvider = reference.provider; record.closingCapturedAt = captured;
  record.closingPriceKind = "开赛前30分钟内最近公开参考价";
  return true;
}

function journal(state: State, matches: Match[], failures: number, eligible: number, placed: number, failedLeagueCodes: string[] = [], labPlaced = 0, scanScope?:{slot:number;slots:number;selected:string[];totalLeagues:number}) {
  const day = dayKey(), now = Date.now();
  const upcoming = matches.filter(match => match.status === "soon" && match.date - now >= 10 * 60000 && match.date - now <= 24 * 60 * 60000);
  const pricedUpcoming = upcoming.filter(match => match.oddsPhase==="current"&&match.odds.every(price => price > 1));
  const previous = state.scanJournal.find(entry => entry.day === day);
  const entry = previous || { day, scans: 0, bets: 0, maxEligible: 0 };
  entry.scans = number(entry.scans) + 1; entry.bets = number(entry.bets) + placed; entry.lastAt = now; entry.persistedAt = now;
  entry.monitored = matches.length; entry.live = matches.filter(match => match.status === "live").length;
  entry.maxEligible = Math.max(number(entry.maxEligible), eligible);
  entry.upcoming = upcoming.length; entry.pricedUpcoming = pricedUpcoming.length;
  const oddsCoverage=summarizeOddsCoverage(matches,now);
  entry.oddsCoverage=oddsCoverage;
  if(scanScope)entry.scanScope={kind:'bounded-rotation',slot:scanScope.slot,slots:scanScope.slots,selectedLeagues:scanScope.selected,totalLeagues:scanScope.totalLeagues};
  // Per-day failure history (user 2026-09-19 diagnosis loop): lab.lastScan only
  // keeps the LATEST scan's failed league codes, so a multi-day upstream
  // throttling trend was invisible. The day journal already survives 30 days —
  // record each scan's failure count/codes here too (latest wins; additively
  // merged below so codes seen at any point during the day stay visible).
  entry.failedLeagues = failures;
  entry.failedLeagueCodes = [...new Set([...(Array.isArray(entry.failedLeagueCodes) ? entry.failedLeagueCodes : []), ...failedLeagueCodes])].sort();
  // Per-day comparison-ledger placement history (same diagnosis loop as the
  // failure codes above): entry.bets only accumulates the legacy ledger's
  // placed count (always 0 since 2026-09-17), so a multi-day placement
  // trend was only readable from lab.lastScan (latest scan only). labBets
  // accumulates each scan's comparison-portfolio placements; lastLabBets
  // keeps the latest scan's count for spot checks.
  entry.labBets = number(entry.labBets || 0) + labPlaced;
  entry.lastLabBets = labPlaced;
  // Per-day live-time anomaly history (same diagnosis loop as the failure
  // codes above): lastReason only keeps the LATEST scan's unverified count,
  // so whether the same matches stay stuck "unverified" across scans (a
  // correctness signal — poisoned or frozen feed rows) was invisible. Persist
  // the count (latest wins) plus an additively merged identity list per day.
  const anomalies = matches.filter(match => match.status === "unverified");
  entry.liveTimeAnomalies = anomalies.length;
  entry.liveTimeAnomalyMatches = [...new Set([...(Array.isArray(entry.liveTimeAnomalyMatches) ? entry.liveTimeAnomalyMatches : []), ...anomalies.map(match => `${match.leagueCode}:${match.home} v ${match.away}`)])].sort();
  entry.lastSource = "server";
  entry.lastReason = `本轮分批 ${scanScope?.selected.length||0}/${scanScope?.totalLeagues||LEAGUES.length} 联赛（轮转 ${scanScope?.slot||0}/${scanScope?.slots||0}）；${failures} 联赛抓取失败；${anomalies.length} 场源头直播时间异常；本批未来 24 小时 ${upcoming.length} 场可观察赛前比赛：当前完整 1X2 ${oddsCoverage.executionComplete} 场、仅 close 参考价 ${oddsCoverage.executionReferenceComplete} 场、部分价格 ${oddsCoverage.executionPartial} 场、明确未开盘 ${oddsCoverage.executionUnopened} 场、源头未返回 ${oddsCoverage.executionSourceMissing} 场；${eligible} 场通过策略门槛；单一 ESPN 供稿商，直播不模拟`;
  if (!previous) state.scanJournal.push(entry);
  state.scanJournal = state.scanJournal.slice(-30);
}

// Total-outage audit trail (user 2026-09-20 diagnosis loop): the full-outage
// early return below used to skip the scan journal entirely, so a day where
// every feed request failed left no trace in the 30-day failure-trend
// history — the same blind spot the failedLeagueCodes fix closed for partial
// failures. Deliberately NOT reusing journal(): with zero matches it would
// zero out the day's monitored/upcoming/pricedUpcoming readings and overwrite
// real observations with empty-scan values. Only scans/lastAt/failedLeagues/
// failedLeagueCodes/lastReason are touched; tickets, settings and settlement
// evidence are untouched.
function journalOutage(state: State, failedLeagueCodes: string[], totalRequests: number, outageErrors: Record<string, number>) {
  const day = dayKey(), now = Date.now();
  const previous = state.scanJournal.find(entry => entry.day === day);
  const entry = previous || { day, scans: 0, bets: 0, maxEligible: 0 };
  entry.scans = number(entry.scans) + 1; entry.lastAt = now; entry.persistedAt = now;
  entry.failedLeagues = Math.max(number(entry.failedLeagues), failedLeagueCodes.length);
  entry.failedLeagueCodes = [...new Set([...(Array.isArray(entry.failedLeagueCodes) ? entry.failedLeagueCodes : []), ...failedLeagueCodes])].sort();
  entry.lastSource = "server";
  entry.lastReason = `全部 ${totalRequests} 个公开赛事源请求失败（总故障），本轮未选赛、未结算、未改任何票据`;
  // Distinct rejection messages with occurrence counts: without this the 502
  // alone cannot tell an 8s concurrent timeout from DNS/HTTP/parse failures —
  // the same attribution gap round 41 closed for partial failures.
  entry.lastOutageErrors = outageErrors;
  if (!previous) state.scanJournal.push(entry);
  state.scanJournal = state.scanJournal.slice(-30);
}

export async function POST(request: Request) {
  const denied = await ownerWriteDenied(request); if (denied) return denied;
  if (!localScanWritesAllowed()) return Response.json({ok:false,paused:true,error:'本地扫描写入因内存稳定性尚未验收而暂停；赛事只读浏览仍可使用'},
    {status:503,headers:{'cache-control':'no-store','retry-after':'300'}});
  // Viewer access is read-only; privileged writes require trusted owner identity
  // or a separately verified maintenance key before this route executes.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ ok: false, error: "跨站请求已拒绝" }, { status: 403 });
  let scanLease: string | null = null;
  let scanBatchId: string | null = null;
  let progressStage = 'prepared';
  const markScanProgress=(id:string,stage:string,error='')=>markScanProgressWithLease(id,stage,scanLease??'',error);
  try {
    scanLease = await acquireScanLease();
    if (!scanLease) return Response.json({ ok: true, skipped: true, activeScan: true, note: "已有扫描正在运行，本页复用该轮结果" }, { status: 202, headers: { "cache-control": "no-store", "retry-after": "30" } });
    const range = dateKey(new Date()), matches: Match[] = [];
    const beforeScan = await readLedger();
    // Every league uses the same validated seven-day range. The feed route
    // internally applies the extended women/national-team calendar recovery;
    // sending only a season year here bypassed that recovery and silently
    // dropped those fixtures from the simulation scanner.
    const scanDates = scanDateKeys(), scanRange=radarDateRange();
    const pendingLegs=await pendingLabLegs();
    const marketPending=await pendingMarketResults().catch(()=>[]);
    const pending=[...((beforeScan?.state as State | null)?.records || []),...pendingLegs,...marketPending]
      .map(record=>record as {status?:string;leagueCode?:string;kickoffAt?:number})
      .filter(record=>record.status==='open')
      .map(record=>({leagueCode:String(record.leagueCode||''),kickoffAt:Number(record.kickoffAt)}));
    const previousLab=await readLab();
    const scanPlan=planScanBatch(LEAGUES,Date.now(),pending,previousLab.radar,previousLab.lastScan?.sweepSlot);
    const tasks=scanPlan.selected.map(code=>({code,date:scanRange}));
    const [jleagueOfficial,afcOfficial]=await Promise.allSettled([officialMatches(scanDates),afcResults(scanDates)]);
    const officialRows=jleagueOfficial.status==="fulfilled"?jleagueOfficial.value:[];
    const afcRows=afcOfficial.status==="fulfilled"?afcOfficial.value:[];
    if(jleagueOfficial.status==="rejected")console.error("official_settlement_unavailable",String(jleagueOfficial.reason));
    if(afcOfficial.status==="rejected")console.error("afc_settlement_unavailable",String(afcOfficial.reason));
    const failedCodes = new Set<string>();
    // Failure-reason observability (user 2026-09-20 diagnosis loop): the codes
    // alone cannot distinguish "8s concurrent timeout" from "upstream HTTP 400
    // / malformed payload". Record each still-failing league's rejection reason
    // so /api/lab lastScan can settle the transient-vs-systematic question.
    const failedLeagueErrors: Record<string,string> = {};
    // Retry observability: codes recovered by the bounded retry vs codes that
    // still failed after retry. If recovered codes keep rotating while retried
    // codes stay empty, failures are transient; a stable retried set means a
    // systematic upstream problem instead.
    const recoveredCodes = new Set<string>();
    let failedRequests = 0;
    // A feed route can open up to four upstream requests. One league at a
    // time stays below Cloudflare's six simultaneous outbound connections.
    for (let index = 0; index < tasks.length; index += 1) {
      const slice = tasks.slice(index,index+1);
      const batch = await Promise.allSettled(slice.map(task => fetchLeague(task.code, task.date,undefined,officialRows,afcRows)));
      // Single bounded retry for transient upstream timeouts: failing league
      // codes rotate every round (arg.1/fra.2/jpn.1/... all return HTTP 200 in
      // isolation), so one retry recovers coverage without hammering the source.
      const retried = await Promise.allSettled(slice.map(async (task,i) => {
        if (batch[i].status === "fulfilled") return null;
        try { return { i, value: await fetchLeague(task.code, task.date, undefined, officialRows, afcRows) }; } catch { return null; }
      }));
      batch.forEach((item,i) => {
        if (item.status === "fulfilled") { matches.push(...item.value); return; }
        const retryResult = retried[i];
        if (retryResult?.status === "fulfilled" && retryResult.value) { matches.push(...retryResult.value.value); recoveredCodes.add(slice[i].code); return; }
        failedRequests++;failedCodes.add(slice[i].code);
        failedLeagueErrors[slice[i].code] = String(item.reason instanceof Error ? item.reason.message : item.reason ?? "unknown").slice(0,140);
      });
    }
    // J1 has a reliable dual-source response through /api/feed even when a
    // direct per-day CDN request is throttled. Recover that league explicitly
    // so a transient ESPN CDN failure cannot erase all Japanese candidates.
    if(failedCodes.has('jpn.1')){
      try{
        const payload=await loadMergedFeed('jpn.1',scanRange);
        const events=Array.isArray(payload?.events)?payload.events:[];
        for(const event of events){const match=normalizeEvent(event,'jpn.1',undefined,8);if(match)matches.push(match);}
        if(events.length){failedCodes.delete('jpn.1');delete failedLeagueErrors['jpn.1'];failedRequests=Math.max(0,failedRequests-1);recoveredCodes.add('jpn.1');}
      }catch(error){console.error('jpn_scan_recovery_failed',String(error));}
    }
    const failures = failedCodes.size;
    if (failedRequests === tasks.length) {
      scanBatchId=crypto.randomUUID();
      if(!await beginScanProgress(scanBatchId,scanPlan.selected,scanLease))return Response.json({ok:false,partial:true,error:'上一轮扫描仍在写入；本轮故障日志未提交'},{status:409});
      // Record the total outage in the day journal (see journalOutage) before
      // returning 502, best-effort: a failed journal write must not mask the
      // upstream error response. No ticket, setting or settlement change.
      let journaled = false;
      // Strip per-request unique reference ids (e.g. "internal error;
      // reference = x") before counting, so identical failure modes collapse
      // into one bucket and the distribution is comparable across rounds.
      const outageErrors: Record<string, number> = {};
      for (const raw of Object.values(failedLeagueErrors)) {
        const msg = String(raw).replace(/;?\s*reference\s*=\s*\S+/gi, "").trim().slice(0, 80) || "unknown";
        outageErrors[msg] = (outageErrors[msg] ?? 0) + 1;
      }
      for (let attempt = 0; attempt < 2 && !journaled; attempt++) {
        const stored = await readLedger();
        if (!stored?.state || !stored.settings) break;
        const state = normalizedState(stored.state);
        journalOutage(state, [...failedCodes].sort(), tasks.length, outageErrors);
        const updatedAt = Math.max(Date.now(), stored.updatedAt + 1);
        try{
          await finalizeScanWithLedger(scanBatchId,scanLease,state,stored.updatedAt,updatedAt,'prepared','所有公开赛事源不可用；仅保存故障日志');
          journaled=true;
        }catch(error){console.error('scan_outage_finalize_retry',String(error));}
      }
      if(!journaled){
        await markScanProgress(scanBatchId,'prepared','所有公开赛事源不可用；故障日志保存失败');
        await markScanProgress(scanBatchId,'complete');
      }
      return Response.json({ ok: false,partial:true,scanBatchId,error: "所有公开赛事源暂时不可用", outageJournaled: journaled, outageErrors }, { status: 502 });
    }
    const backfills = planBackfills([...((beforeScan?.state as State | null)?.records || []),...pendingLegs,...marketPending],range);
    let backfillFailures = 0;
    for (const group of backfills.selected) {
      try { matches.push(...await fetchLeague(group.code, group.date, group.ids,officialRows,afcRows)); } catch { backfillFailures++; }
    }
    const byId = new Map<string,Match>();
    for(const match of matches){const old=byId.get(match.id);if(!old||Number(match.independentFinalVerified)>Number(old.independentFinalVerified)||(match.independentFinalVerified===old.independentFinalVerified&&Number(match.observedAt)>Number(old.observedAt)))byId.set(match.id,match);}
    const rows = [...byId.values()];
    const goalModels=await goalEvidenceForMatches(rows).catch(error=>{console.error("goal_model_unavailable",String(error));return new Map<string,GoalEvidence>();});
    for(const match of rows)match.goalModel=goalModels.get(match.id);
    const capturedAt = Date.now();
    const oddsCoverage=summarizeOddsCoverage(rows,capturedAt);
    // Status research for the tickets about to be placed: the rationale
    // frozen on each leg must answer "为什么是这项" with team state
    // (DQD availability signals, rest days, injury reports, lineup),
    // not just market arithmetic. Bounded to soon+priced matches.
    const researchTargets=rows.filter(m=>m.status==="soon"&&m.date>capturedAt&&m.date-capturedAt<=48*60*60000&&m.odds.every(p=>p>1)).sort((a,b)=>a.date-b.date).slice(0,30);
    const researchResults=await settledBatches(researchTargets,2,async match=>{
      const response=await matchResearchGET(new Request(`http://localhost/api/match-research?league=${encodeURIComponent(match.leagueCode)}&id=${encodeURIComponent(match.id)}`));
      const data=await readJsonLimited(response,4_000_000) as ResearchPayload;
      if(!data?.ok||data?.degraded)return null;
      const dqd=Array.isArray(data.dongqiudi)?data.dongqiudi:[];
      const deepDive=researchDeepAnalysis(data);
      return {id:match.id,researchGoal:linkedResearchGoalEvidence(data,match.homeId,match.awayId),research:{dqdSignals:[Number(dqd[0]?.availabilitySignals||0),Number(dqd[1]?.availabilitySignals||0)] as [number,number],homeRest:data.rest?.[0]?.restDays??null,awayRest:data.rest?.[1]?.restDays??null,injuryAvailable:data.contextQuality?.injuryEvidence==='named',lineupConfirmed:!!data.lineupConfirmed,newsMatched:dqd.length===2&&dqd.every(row=>!row.matchStatus),capturedAt:Number(data.capturedAt)||0,deepAnalysis:deepDive}};
    });
    for(const result of researchResults){if(result.status==="fulfilled"&&result.value){const match=rows.find(m=>m.id===result.value!.id);if(match){match.research=result.value!.research;if(result.value!.researchGoal)match.goalModel=result.value!.researchGoal;}}}
    scanBatchId=crypto.randomUUID();
    if(!await beginScanProgress(scanBatchId,scanPlan.selected,scanLease))return Response.json({ok:false,partial:true,error:'上一轮扫描仍在写入；保留阶段记录并拒绝重叠提交'},{status:409});
    const db=env.DB;if(!db)throw new Error('扫描 D1 不可用');
    // Prepare every output in memory. The only durable mutation so far is the
    // running progress claim; a failed final batch cannot leave partial data.
    const sourceLab=await readLab();
    const labStorage=(await db.prepare("SELECT 1 AS present FROM app_state WHERE key='simulation_lab_v2'").first())?'v2':'v1';
    const preparedLab=prepareSimulationLab(sourceLab,rows,failures>8?'数据源失败过多，本轮暂停新增模拟单；已取得可靠赛果的旧单继续结算':'',false,
      {scanBatchId,scannedLeagues:tasks.length-failures,totalLeagues:LEAGUES.length,selectedLeagues:scanPlan.selected,freshLeagueCodes:scanPlan.selected.filter(code=>!failedCodes.has(code)),sweepSlot:scanPlan.slot,sweepSlots:scanPlan.slots,failedLeagues:failures,failedLeagueCodes:[...failedCodes].sort(),failedLeagueErrors,retryRecoveredCodes:[...recoveredCodes].sort(),oddsCoverage});
    const lab=preparedLab.result;
    // A featured ticket must carry a full, readable research report rather
    // than only the arithmetic rationale. Reuse this scan's report where
    // possible; only fetch the remaining featured matches (max ten).
    const researched=new Map(researchResults.flatMap(row=>row.status==='fulfilled'&&row.value?[[String(row.value.id),row.value.research.deepAnalysis] as const]:[]));
    const featured=featuredOpenLegs(preparedLab.lab);
    const missing=featured.filter(leg=>!leg.deepAnalysis&&!researched.get(String(leg.matchId))).slice(0,10);
    const extra=await settledBatches(missing,2,async leg=>{
      const response=await matchResearchGET(new Request(`http://localhost/api/match-research?league=${encodeURIComponent(leg.leagueCode)}&id=${encodeURIComponent(leg.matchId)}`));
      const data=await readJsonLimited(response,4_000_000) as ResearchPayload;
      const analysis=researchDeepAnalysis(data);
      if(!data?.ok||data?.degraded||!analysis)return null;
      return {matchId:String(leg.matchId),leagueCode:String(leg.leagueCode),analysis};
    });
    const fromCurrent=featured.flatMap(leg=>{const analysis=researched.get(String(leg.matchId));return analysis?[{matchId:String(leg.matchId),leagueCode:String(leg.leagueCode),analysis}]:[]});
    const fromExtra=extra.flatMap(row=>row.status==='fulfilled'&&row.value?[row.value]:[]);
    applyFeaturedAnalyses(preparedLab.lab,[...fromCurrent,...fromExtra]);
    const preparedModel=prepareModelObservationStatements(db,rows,preparedLab.lab.radar);
    // Actual deduplicated insert counts are only known after commit.
    const preparedSampling=prepareSamplingAuditStatement(db,scanBatchId,capturedAt,scanPlan.selected,[...failedCodes],rows,{forecastObserved:preparedModel.forecastObserved,outcomeObserved:preparedModel.outcomeObserved});
    const preparedQuotes=prepareMarketQuoteStatements(db,rows,capturedAt);
    const preparedResults=prepareMarketResultStatements(db,rows);
    const preparedOdds=prepareOddsSnapshotStatements(db,rows.filter(match => match.status === "soon" && match.date > capturedAt && match.oddsPhase === "current" && match.odds.every(price => price > 1)).map(match => ({
      matchId: match.id, leagueCode: match.leagueCode, capturedAt,
      homeOdds: match.odds[0], drawOdds: match.odds[1], awayOdds: match.odds[2], provider: [...new Set(match.providers)].join(", "),
    })));
    const closingReferences = new Map<string, Awaited<ReturnType<typeof readLatestOdds>>>();
    const closingCandidates = ((beforeScan?.state as State | null)?.records || []).filter(record => record.clv == null && number(record.kickoffAt) > 0 && number(record.kickoffAt) < Date.now() && (["win", "loss"].includes(String(record.status||'')) || (record.status === "open" && byId.get(String(record.matchId))?.status === "finished"))).slice(-12);
    for (const record of closingCandidates) {
      const key=`${record.leagueCode}:${record.matchId}`;
      if (typeof record.priceProvider !== 'string' || !record.priceProvider) continue;
      closingReferences.set(key, await readLatestOdds(String(record.leagueCode), String(record.matchId), number(record.kickoffAt), record.priceProvider).catch(() => null));
    }
    const stored=await readLedger();
    if(!stored?.state||!stored.settings)throw new Error('私有模拟账本尚未初始化');
    const state=normalizedState(stored.state),settings=stored.settings as Settings,today=dayKey();
    if(state.day!==today){state.day=today;state.dayStartBalance=state.balance;}
    const settled=settle(state,rows),decisions=eligibleDecisions(rows,settings);
    for(const record of state.records)applyClosingReference(record,closingReferences.get(`${record.leagueCode}:${record.matchId}`));
    const placed=0; // New comparison tickets are in the separate strategy ledger.
    const labPlaced=number(lab.placed||0);
    journal(state,rows,failures,decisions.length,placed,[...failedCodes].sort(),labPlaced,{slot:scanPlan.slot,slots:scanPlan.slots,selected:scanPlan.selected,totalLeagues:scanPlan.totalLeagues});
    const updatedAt=Math.max(Date.now(),stored.updatedAt+1);
    const progressRow=await db.prepare("SELECT payload,updated_at FROM app_state WHERE key='scan_progress_v1'").first<{payload:string;updated_at:number}>();
    if(!progressRow)throw new Error('扫描进度批次缺失');
    const finalization=prepareScanFinalizationStatements(db,progressRow,scanBatchId,scanLease,state,stored.updatedAt,updatedAt,'prepared');
    const labCommit=prepareLabShardCommit(db,preparedLab.lab,preparedLab.expected,labStorage,scanLease);
    const writeSummary=await commitAtomicScan(db,{
      lab:labCommit.statements,forecasts:preparedModel.forecastStatements,outcomes:preparedModel.outcomeStatements,
      quotes:preparedQuotes.statements,results:preparedResults,odds:preparedOdds,
      sampling:preparedSampling.statement,finalize:finalization.statements,
    });
    progressStage='complete';
    const progress=finalization.progress,oddsSnapshotsInserted=writeSummary.oddsInserted;
    const modelObservations={forecastObserved:preparedModel.forecastObserved,forecastInserted:writeSummary.forecastInserted,outcomeObserved:preparedModel.outcomeObserved,outcomeInserted:writeSummary.outcomeInserted};
    const samplingAudit={...preparedSampling.value,recorded:writeSummary.samplingRecorded};
    const marketQuotes={observed:preparedQuotes.observed,inserted:writeSummary.quotesInserted},marketResults=writeSummary.resultsInserted;
    const upcoming=rows.filter(match=>match.status==='soon'&&match.date-updatedAt>=10*60000&&match.date-updatedAt<=24*60*60000);
    return Response.json({ok:progress.status==='complete',partial:progress.status==='partial',scanBatchId,failedPhases:[],scanMode:'bounded-rotation',scannedLeagues:tasks.length-failures,totalLeagues:LEAGUES.length,selectedLeagues:scanPlan.selected,sweepSlot:scanPlan.slot,sweepSlots:scanPlan.slots,failedLeagues:failures,failedLeagueCodes:[...failedCodes].sort(),failedLeagueErrors,retryRecoveredCodes:[...recoveredCodes].sort(),monitored:rows.length,
      verifiedLive:rows.filter(match=>match.status==='live').length,liveTimeAnomalies:rows.filter(match=>match.status==='unverified').length,
      upcoming:upcoming.length,pricedUpcoming:upcoming.filter(match=>match.oddsPhase==='current'&&match.odds.every(price=>price>1)).length,oddsCoverage,
      eligible:decisions.length,placed,labPlaced,settled,oddsSnapshotsInserted,modelObservations,samplingAudit,marketQuotes,marketResults,lab,labHealthy:true,day:today,updatedAt,statementCount:writeSummary.statementCount,
      backfillGroups:backfills.total,backfillAttempted:backfills.selected.length,backfillFailures,officialMatches:officialRows.length,afcReports:afcRows.length,independentlyVerifiedFinals:rows.filter(match=>match.independentFinalVerified).length,
      scanDates,scanRange,sourceRequests:tasks.length,failedRequests,
      note:'仅单一 ESPN 供稿商；没有独立直播赔率时不模拟滚球。赛前仅以公开参考价做虚拟记录。'},
      {status:progress.status==='complete'?200:503,headers:{'cache-control':'no-store'}});
  } catch (error) {
    console.error("server_scan_failed",error instanceof Error?error.message:String(error));
    // A lost D1 response can occur after the transaction committed. Never
    // convert its completed batch to a partial one or blindly replay writes.
    if(scanBatchId)try{
      const current=await readScanProgress();
      if(current?.id===scanBatchId&&current.status==='complete')return Response.json({ok:false,partial:false,scanBatchId,commitStatus:'committed-unverified',error:'扫描事务可能已提交；请按批次核对账本后再确认成功'},
        {status:503,headers:{'cache-control':'no-store'}});
    }catch(readError){console.error('scan_commit_status_read_failed',String(readError));}
    if(scanBatchId)try{await markScanProgress(scanBatchId,progressStage,String(error));await markScanProgress(scanBatchId,'complete');}catch(progressError){console.error('scan_progress_record_failed',progressError);}
    return Response.json({ ok: false,partial:!!scanBatchId,scanBatchId,error: "本轮服务端扫描失败；请核对扫描阶段记录和账本" }, { status: 503 });
  } finally {
    if (scanLease) await releaseScanLease(scanLease).catch(error => console.error("scan_lease_release_failed", String(error)));
  }
}
