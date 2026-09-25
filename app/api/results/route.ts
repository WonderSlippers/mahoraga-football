import { readLatestOdds } from "@/db/odds";
import {readJsonLimited} from "@/lib/limited-response";
import {discardResponse} from "@/lib/http-response";

const LEAGUES = new Set([
  "eng.1","eng.2","esp.1","ita.1","ger.1","fra.1","uefa.champions","uefa.europa","uefa.europa.conf",
  "usa.1","mex.1","bra.1","arg.1","chn.1","fifa.world","ned.1","por.1","bel.1","tur.1","sco.1",
  "jpn.1","ksa.1","conmebol.libertadores","conmebol.sudamericana","usa.nwsl",
  "ger.2","esp.2","fra.2","eng.3","aus.1","sui.1","aut.1","eng.league_cup",
  "eng.fa","ger.dfb_pokal","esp.copa_del_rey","ita.coppa_italia","fra.coupe_de_france","afc.champions","afc.cup","concacaf.champions","uefa.nations","bra.copa_do_brazil","arg.copa",
]);

type RequestItem = { id?: string; league?: string; kickoffAt?: number };
type Competitor={homeAway?:string;score?:number|string};
type Competition={id?:string|number;date?:string;competitors?:Competitor[];status?:{type?:{completed?:boolean;state?:string;name?:string;description?:string;detail?:string};period?:number}};
type FeedEvent={id?:string|number;competitions?:Competition[]};
type SourcePayload={header?:{competitions?:Competition[]};competitions?:Competition[];content?:{sbData?:{events?:FeedEvent[]}}};
type SourceCache=Map<string,Promise<SourcePayload|null>>;

async function loadJson(url:string,cache:SourceCache) {
  if(!cache.has(url))cache.set(url,(async()=>{try{
    const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(8_000)});
    if(!response.ok){await discardResponse(response);return null;}
    const payload=await readJsonLimited(response,4_000_000);
    return payload&&typeof payload==='object'?payload as SourcePayload:null;
  }catch{return null;}})());
  return cache.get(url)!;
}

async function fallbackCompetition(item:RequestItem,cache:SourceCache) {
  const kickoff=Number(item.kickoffAt),now=Date.now();
  const dates=Number.isFinite(kickoff)&&kickoff>0&&kickoff<=now+86400000
    ? [kickoff] : [now,now-86400000];
  for(const date of dates) {
    const key=new Date(date).toISOString().slice(0,10).replaceAll('-','');
    const url=`https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${encodeURIComponent(String(item.league))}&date=${key}&limit=100`;
    const data=await loadJson(url,cache),events=data?.content?.sbData?.events;
    const event=Array.isArray(events)?events.find(event=>String(event.id)===String(item.id)):null;
    if(event?.competitions?.[0])return {competition:event.competitions[0],sourceUrl:url};
  }
  return null;
}

async function resultFor(item: RequestItem,cache:SourceCache) {
  const id = String(item.id || ""), league = String(item.league || "");
  if (!/^\d{3,30}$/.test(id) || !LEAGUES.has(league)) return null;
  const url = `https://site.web.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/summary?event=${encodeURIComponent(id)}`;
  const data=await loadJson(url,cache);
  const summary=data?.header?.competitions?.[0] || data?.competitions?.[0];
  const selected=summary&&String(summary.id)===id?{competition:summary,sourceUrl:url}:await fallbackCompetition(item,cache);
  const competition=selected?.competition;
  const teams = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const home = teams.find(team => team.homeAway === "home") || teams[0];
  const away = teams.find(team => team.homeAway === "away") || teams[1];
  const completed = Boolean(competition?.status?.type?.completed || competition?.status?.type?.state === "post");
  const statusName = [competition?.status?.type?.name, competition?.status?.type?.description, competition?.status?.type?.detail].filter(Boolean).join(" ");
  const voided = /(cancel|abandon)/i.test(statusName);
  const scoreKnown = [home?.score,away?.score].every(score => score != null && /^\d+$/.test(String(score)));
  const kickoffAt = Date.parse(competition?.date || "");
  const period=Number(competition?.status?.period||0);
  const needsReview = /(postpon|suspend)/i.test(statusName) || (completed && (!scoreKnown || !Number.isFinite(kickoffAt) || kickoffAt>Date.now() || /(AET|after extra time|penalt|shootout)/i.test(statusName) || period>2 || (period!==2&&!/FULL_TIME|Full Time/i.test(statusName))));
  if (!home || !away) return null;
  const lastOdds = completed ? await readLatestOdds(league, id, kickoffAt).catch(() => null) : null;
  return {
    id, league, completed: completed && !/(postpon|suspend)/i.test(statusName) && (scoreKnown || voided), voided, needsReview, homeScore: scoreKnown?Number(home.score):null, awayScore: scoreKnown?Number(away.score):null,
    sourceUrl:selected?.sourceUrl,observedAt:Date.now(),
    detail: competition?.status?.type?.detail || "",
    closingOdds: lastOdds ? [lastOdds.home_odds, lastOdds.draw_odds, lastOdds.away_odds] : null,
    closingProvider: lastOdds?.provider || null,
    closingCapturedAt: lastOdds?.captured_at || null,
    closingPriceKind: lastOdds ? "开赛前30分钟内最近公开参考价" : null,
  };
}

export async function POST(request: Request) {
  try {
    const body = await readJsonLimited(request,100_000) as { items?: RequestItem[] };
    const items = [...new Map((Array.isArray(body.items) ? body.items : []).map((item) => [`${item.league}:${item.id}`, item])).values()].slice(0, 30);
    const settled: PromiseSettledResult<Awaited<ReturnType<typeof resultFor>>>[] = [];
    const cache:SourceCache=new Map();
    for (let index = 0; index < items.length; index += 6) settled.push(...await Promise.allSettled(items.slice(index, index + 6).map(item=>resultFor(item,cache))));
    return Response.json({ ok: true, results: settled.filter((row): row is PromiseFulfilledResult<Awaited<ReturnType<typeof resultFor>>> => row.status === "fulfilled").map((row) => row.value).filter(Boolean) });
  } catch (error) {
    console.error("result_reconciliation_failed", error);
    return Response.json({ ok: false, results: [] }, { status: 503 });
  }
}
