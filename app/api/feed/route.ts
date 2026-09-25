import { officialMatches, attachOfficial } from "@/lib/jleague-source";
import { afcResults, attachAfc } from "@/lib/afc-source";
import { requireOk } from "@/lib/http-response";
import {readJsonLimited} from '@/lib/limited-response';
import {createLegacyFeedBudget} from '@/lib/feed-request-budget';
import {feedSourceMode} from '@/lib/feed-source-policy';
import {putBoundedCache} from '@/lib/bounded-cache';
import {createSingleFlight} from '@/lib/single-flight';
import {parseFeedDateWindow,FeedDateWindowError} from '@/lib/feed-date-window';

const LEAGUES = new Set([
  "eng.1","eng.2","esp.1","ita.1","ger.1","fra.1","uefa.champions","uefa.europa","uefa.europa.conf",
  "usa.1","mex.1","bra.1","arg.1","chn.1","fifa.world","ned.1","por.1","bel.1","tur.1","sco.1",
  "jpn.1","ksa.1","conmebol.libertadores","conmebol.sudamericana","usa.nwsl",
  "fifa.friendly","fifa.friendly.w","eng.w.1","esp.w.1","fra.w.1","aus.w.1","uefa.wchampions","uefa.wchampions_qual","uefa.w.europa","uefa.w.nations","concacaf.w.champions_cup",
  "fifa.worldq.uefa","fifa.worldq.afc","fifa.worldq.caf","fifa.worldq.concacaf","fifa.worldq.conmebol","fifa.worldq.ofc","concacaf.nations.league","uefa.euroq","afc.cupq","caf.nations_qual",
  "ger.2","esp.2","fra.2","eng.3","aus.1","sui.1","aut.1","eng.league_cup",
  "eng.fa","ger.dfb_pokal","esp.copa_del_rey","ita.coppa_italia","fra.coupe_de_france","afc.champions","afc.cup","concacaf.champions","uefa.nations","bra.copa_do_brazil","arg.copa",
]);
const EXTENDED_CALENDAR_LEAGUES = new Set([
  "fifa.friendly","fifa.friendly.w","eng.w.1","esp.w.1","fra.w.1","aus.w.1","usa.nwsl","uefa.wchampions","uefa.wchampions_qual","uefa.w.europa","uefa.w.nations","concacaf.w.champions_cup",
  "fifa.worldq.uefa","fifa.worldq.afc","fifa.worldq.caf","fifa.worldq.concacaf","fifa.worldq.conmebol","fifa.worldq.ofc","concacaf.nations.league","uefa.nations","uefa.euroq","afc.cupq","caf.nations_qual",
]);
const allowLegacyFeed=createLegacyFeedBudget();
const allowBoundedFeed=createLegacyFeedBudget(24,32);
const MAX_SOURCE_BYTES=4_000_000;
const RESPONSE_CACHE_ENTRIES=40;
const RESPONSE_CACHE_BYTES=8_000_000;
// Fixture/calendar reads tolerate a minute of reuse; live scores use a much
// shorter window. Fewer repeated upstream parses limit the local Workerd's
// observed resident-memory growth while preserving frequent live updates.
const RESPONSE_CACHE_MAX_AGE_MS=60_000;
const LIVE_RESPONSE_CACHE_MAX_AGE_MS=10_000;
const responseCache=new Map<string,{at:number;text:string;bytes:number}>();
const sharedFeedText=createSingleFlight<string,string>();
type FeedStatus={type?:{state?:string;completed?:boolean};clock?:number};
type FeedCompetitor={homeAway?:string;score?:unknown};
type FeedEvent={id?:string|number;date?:string;competitions?:{competitors?:FeedCompetitor[];status?:FeedStatus;date?:string}[];status?:FeedStatus;_edgeEndpoint?:string;_edgeLeagueLogo?:string;_edgeCapturedAt?:number;_edgeSourceCount?:number;_edgeScoreConflict?:boolean;_edgeClockConflict?:boolean;_edgeProvisionalLead?:boolean;_edgeObservations?:unknown[]};
type FeedPayload={content?:{sbData?:{events?:unknown;leagues?:{logos?:{href?:string}[]}[]}};events?:unknown;data?:{events?:unknown};leagues?:{logos?:{href?:string}[]}[]};

function extractFeed(data:unknown){
  const payload=data as FeedPayload|null;
  const events=payload?.content?.sbData?.events??payload?.events??payload?.data?.events??[];
  if(!Array.isArray(events))throw new Error('malformed feed');
  if(events.length>1000)throw new RangeError('feed has too many events');
  const logo=payload?.content?.sbData?.leagues?.[0]?.logos?.[0]?.href??payload?.leagues?.[0]?.logos?.[0]?.href;
  return {events:events as FeedEvent[],logo};
}

function cachedFeed(key:string,maxAgeMs=RESPONSE_CACHE_MAX_AGE_MS,now=Date.now()){
  const entry=responseCache.get(key);
  if(!entry)return null;
  if(now-entry.at>=maxAgeMs){responseCache.delete(key);return null;}
  return entry.text;
}

function eventFacts(event: FeedEvent) {
  const competition = event?.competitions?.[0] || {};
  const teams = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = teams.find(team => team.homeAway === "home") || teams[0] || {} as FeedCompetitor;
  const away = teams.find(team => team.homeAway === "away") || teams[1] || {} as FeedCompetitor;
  const state = competition.status?.type?.state || event?.status?.type?.state || "pre";
  const clock = Number(competition.status?.clock ?? event?.status?.clock ?? 0);
  const completed = Boolean(competition.status?.type?.completed || event?.status?.type?.completed);
  const score=(value:unknown)=>value!=null&&/^\d+$/.test(String(value))?Number(value):null;
  return { state, clock, completed, home: score(home.score), away: score(away.score) };
}

function progress(event: FeedEvent) {
  const facts = eventFacts(event);
  const statusTie=facts.completed||facts.state==="post"?3:facts.state==="in"?2:1;
  // A premature/stale "final" must not trump a much later live clock.
  return facts.clock * 100 + statusTie * 10 + (facts.home??0) + (facts.away??0);
}

function mergeFeeds(feeds: FeedEvent[][], capturedAt: number) {
  const byId = new Map<string, FeedEvent[]>();
  for (const feed of feeds) for (const event of feed) {
    const id = String(event?.id || "");
    if (!id) continue;
    byId.set(id, [...(byId.get(id) || []), event]);
  }
  return [...byId.values()].map((versions) => {
    const chosen = versions.slice().sort((a, b) => progress(b) - progress(a))[0];
    const facts = versions.map(eventFacts);
    const scoreConflict = facts.some((fact) => fact.home !== facts[0].home || fact.away !== facts[0].away || fact.state !== facts[0].state);
    const clockConflict = facts.some((fact) => fact.state==="in"&&facts[0].state==="in"&&Math.abs(fact.clock-facts[0].clock)>120);
    const leader=eventFacts(chosen);
    const olderCdn=versions.some(event=>{const prior=eventFacts(event);return event._edgeEndpoint==="ESPN CDN"&&prior.home!=null&&prior.away!=null&&leader.home!=null&&leader.away!=null&&leader.clock-prior.clock>=120&&leader.home>=prior.home&&leader.away>=prior.away;});
    chosen._edgeCapturedAt = capturedAt;
    chosen._edgeSourceCount = new Set(versions.map(event => event._edgeEndpoint).filter(Boolean)).size;
    chosen._edgeScoreConflict = scoreConflict;
    chosen._edgeClockConflict = clockConflict;
    chosen._edgeProvisionalLead = (scoreConflict||clockConflict)&&chosen._edgeEndpoint==="ESPN Site API"&&olderCdn;
    chosen._edgeObservations = versions.map(event => ({endpoint:event._edgeEndpoint,...eventFacts(event)}));
    return chosen;
  });
}

async function settledBatches<T,R>(items:T[],limit:number,worker:(item:T,index:number)=>Promise<R>) {
  const results:PromiseSettledResult<R>[]=[];
  for(let offset=0;offset<items.length;offset+=limit){
    const slice=items.slice(offset,offset+limit);
    results.push(...await Promise.allSettled(slice.map((item,index)=>worker(item,offset+index))));
  }
  return results;
}
const isFulfilled=<T,>(result:PromiseSettledResult<T>):result is PromiseFulfilledResult<T>=>result.status==='fulfilled';

// The scanner calls this shared loader directly. Routing a 65-league scan
// through GET produced a full JSON Response and then parsed that JSON again
// for every league, retaining far more V8 allocations than the data needs.
export async function loadMergedFeed(league:string,dates:string,mode='all',sourceMode:'full'|'cdn-only'='full') {
  const extended=mode==="all"&&EXTENDED_CALENDAR_LEAGUES.has(league);
  const {first,last,days}=parseFeedDateWindow(dates,mode,extended);
  const today=Date.parse(new Date().toISOString().slice(0,10)+"T00:00:00Z");
  const requestedDays=days.filter(day=>Math.abs(Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00Z`)-today)<=86400000);
  const officialTask=league==='afc.champions'?Promise.allSettled([officialMatches(requestedDays),afcResults(requestedDays)]):null;
  const siteSkipped=sourceMode==='cdn-only';
  const sources = [
    requestedDays.map(day => `https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${encodeURIComponent(league)}&date=${day}&limit=100`),
    siteSkipped?[]:(mode==="live"?requestedDays:[extended?String(first.getUTCFullYear()):dates]).map(span=>`https://site.web.api.espn.com/apis/site/v2/sports/soccer/${encodeURIComponent(league)}/scoreboard?dates=${span}&limit=${extended?1000:100}`),
  ];
  const responses = await Promise.allSettled(sources.map(async (group,index) => {
    if(siteSkipped&&index===1)return [];
    // A timeout on one calendar day must not discard the other successful
    // calendar days from the same ESPN endpoint.
    const attempts = await settledBatches(group,4,async (source) => {
      const response = await fetch(source, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(index===1?10_000:6_000) });
      await requireOk(response);
      const {events,logo}=extractFeed(await readJsonLimited(response,MAX_SOURCE_BYTES));
      return events.map(event=>({...event,_edgeLeagueLogo:logo,_edgeEndpoint:index===0?"ESPN CDN":"ESPN Site API"}));
    });
    attempts.forEach((result,dayIndex)=>{
      // Avoid flooding the local terminal when an upstream host is blocked;
      // the aggregate health card already reports the failure.
      if(result.status==="rejected"&&dayIndex===0)console.error("feed_endpoint_attempt_failed",{
        league,endpoint:index===0?"ESPN CDN":"ESPN Site API",day:index===0?requestedDays[dayIndex]:mode==="live"?requestedDays[dayIndex]:"range",
        error:String(result.reason).slice(0,240),
      });
    });
    const successful=attempts.filter(isFulfilled).map(result=>result.value);
    if(!successful.length)throw new Error("all dates failed");
    return successful.flat();
  }));
  const feeds = responses.filter(isFulfilled).map((result) => result.value);
  // Some broad Site API ranges return HTTP 400 even though single-day
  // scoreboard requests are healthy. Retry that failed range day by day.
  let siteApiRecovered = false;
  if (mode === "all" && !siteSkipped && responses[1].status === "rejected") {
    const daily = await settledBatches(days,4,async (day) => {
      const source = "https://site.web.api.espn.com/apis/site/v2/sports/soccer/" + encodeURIComponent(league) + "/scoreboard?dates=" + day + "&limit=100";
      const response = await fetch(source, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      await requireOk(response);
      const {events,logo}=extractFeed(await readJsonLimited(response,MAX_SOURCE_BYTES));
      return events.map(event => ({ ...event, _edgeLeagueLogo: logo, _edgeEndpoint: "ESPN Site API" }));
    });
    const recovered = daily.filter(isFulfilled).flatMap(result => result.value);
    if (recovered.length) {
      feeds.push(recovered);
      siteApiRecovered = true;
    }
  }
  responses.forEach((result,index)=>{if(result.status==="rejected" && !(index===1 && siteApiRecovered))console.error("feed_partial_source_failed",{league,endpoint:index===0?"ESPN CDN":"ESPN Site API",error:String(result.reason).slice(0,240)});});
  // ESPN's range endpoint normally supplies the ten-day fixture list.
  // If it fails or returns nothing, recover the remaining calendar days
  // from the CDN rather than silently truncating the advertised window.
  if(mode==="all"&&!siteSkipped&&(responses[1].status!=="fulfilled"||responses[1].value.length===0) && !siteApiRecovered){
    const remaining=days.filter(day=>!requestedDays.includes(day));
    const fallback=await settledBatches(remaining,4,async day=>{
      const source=`https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${encodeURIComponent(league)}&date=${day}&limit=100`;
      const response=await fetch(source,{headers:{accept:"application/json"},signal:AbortSignal.timeout(6_000)});
      await requireOk(response);
      const {events,logo}=extractFeed(await readJsonLimited(response,MAX_SOURCE_BYTES));
      return events.map(event=>({...event,_edgeLeagueLogo:logo,_edgeEndpoint:"ESPN CDN"}));
    });
    const recovered=fallback.filter(isFulfilled).flatMap(result=>result.value);
    if(recovered.length)feeds.push(recovered);
  }
  if ((siteSkipped&&responses[0].status==='rejected')||!feeds.length) {
    responses.forEach((result) => { if (result.status === "rejected") console.error("feed_source_failed", league, result.reason); });
    throw new Error('数据源暂时不可用');
  }
  const capturedAt = Date.now();
  let events = mergeFeeds(feeds, capturedAt);
  if(extended){
    const from=first.getTime(),through=last.getTime()+86400000-1;
    events=events.filter(event=>{const time=Date.parse(event?.date||event?.competitions?.[0]?.date||"");return Number.isFinite(time)&&time>=from&&time<=through;});
  }
  if (league === 'afc.champions') {
    const [jleague,afc]=await officialTask!;
    if(jleague.status==="fulfilled")events=attachOfficial(events,jleague.value);
    else console.error("jleague_feed_unavailable",String(jleague.reason));
    if(afc.status==="fulfilled")events=attachAfc(events,afc.value);
    else console.error("afc_feed_unavailable",String(afc.reason));
  }
  return { events, edgeMeta: { sourceCount: new Set(feeds.flatMap(feed=>feed.map(event=>event._edgeEndpoint))).size, conflicts: events.filter((event) => event._edgeScoreConflict).length,clockConflicts:events.filter((event)=>event._edgeClockConflict).length, capturedAt,endpointHealth:responses.map((result,index)=>({endpoint:index===0?"ESPN CDN":"ESPN Site API",ok:!(index===1&&siteSkipped)&&(result.status==="fulfilled" || (index===1 && siteApiRecovered)),events:result.status==="fulfilled"?result.value.length:(index===1&&siteApiRecovered?feeds.at(-1)?.length||0:0),fallback:index===1&&siteApiRecovered?"daily":undefined,skipped:index===1&&siteSkipped?'browser-supplied':undefined})) } };
}

export async function GET(request: Request) {
  const url = new URL(request.url), league = url.searchParams.get('league') || '',dates=url.searchParams.get('dates')||'',mode=url.searchParams.get('mode')||'all';
  if(!LEAGUES.has(league)||!/^\d{8}-\d{8}$/.test(dates))return Response.json({error:'参数无效'},{status:400});
  const bounded=request.headers.get('x-edge-bounded-feed')==='1';
  if(!(bounded?allowBoundedFeed(mode):allowLegacyFeed(mode)))
    return Response.json({error:'旧页面请求过密；请刷新页面以启用分批更新',source:'local-feed-guard'},{status:429,headers:{'cache-control':'no-store','retry-after':'60'}});
  // A new browser has already fetched the Site API itself. In that case the
  // Worker only needs the independent CDN endpoint for the second observation.
  // Scans, old tabs and real Site API failures retain the full fallback path.
  const sourceMode=feedSourceMode(request.headers);
  const key=`${league}|${dates}|${mode}|${sourceMode}`;
  const cached=cachedFeed(key,mode==='live'?LIVE_RESPONSE_CACHE_MAX_AGE_MS:RESPONSE_CACHE_MAX_AGE_MS);
  if(cached!=null)return new Response(cached,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  try{
    const payload=await sharedFeedText(key,async()=>{
      const text=JSON.stringify(await loadMergedFeed(league,dates,mode,sourceMode));
      const bytes=text.length*2;
      if(bytes<=2_000_000)putBoundedCache(responseCache,key,{at:Date.now(),text,bytes},RESPONSE_CACHE_ENTRIES,RESPONSE_CACHE_MAX_AGE_MS,RESPONSE_CACHE_BYTES,entry=>entry.bytes);
      return text;
    });
    return new Response(payload,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
  }
  catch(error){return Response.json({error:error instanceof FeedDateWindowError?'日期范围无效':'数据源暂时不可用'},{status:error instanceof FeedDateWindowError?400:502});}
}

