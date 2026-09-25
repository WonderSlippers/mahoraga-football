// Public AFC match reports are read as text only. No third-party scripts run.
import {requireOk} from "@/lib/http-response";

type AfcResult={provider:string;sourceUrl:string;capturedAt:number;publishedDate:string;home:{name:string};away:{name:string};state:"finished";score:[number,number]};
type AfcTeam={homeAway?:string;score?:unknown;team?:{displayName?:string;shortDisplayName?:string}};
type AfcEvent={date?:string;competitions?:{competitors?:AfcTeam[];status?:{type?:{state?:string}}}[];status?:{type?:{state?:string}};_edgeOfficial?:{state?:string;score?:number[]};_edgeScoreConflict?:boolean};
const ROOT="https://www.the-afc.com";
const INDEX=ROOT+"/en/club/afc_champions_league_elite.html";
const SITEMAP_INDEX="https://assets.the-afc.com/sitemap/sitemap_index.xml";
const cached=new Map<string,{at:number;rows:AfcResult[]}>();
const pending=new Map<string,Promise<AfcResult[]>>();
function decode(value:string){
  return value.replace(/\\u2019/g,"’").replace(/&amp;/g,"&").replace(/&#(?:39|x27);/gi,"'").replace(/&quot;/g,'"');
}
async function page(url:string){
  const response=await fetch(url,{headers:{accept:"text/html"},signal:AbortSignal.timeout(9_000)});
  await requireOk(response,"AFC");
  const html=await response.text();
  if(html.length>1_000_000)throw new Error("AFC page too large");
  return html;
}
async function sitemap(url:string,limit:number){
  const parsed=new URL(url);
  if(parsed.protocol!=="https:"||parsed.hostname!=="assets.the-afc.com"||!parsed.pathname.startsWith("/sitemap/"))throw new Error("unexpected AFC sitemap URL");
  const response=await fetch(url,{headers:{accept:"application/xml,text/xml"},signal:AbortSignal.timeout(12_000)});
  await requireOk(response,"AFC sitemap");
  const xml=await response.text();
  if(xml.length>limit)throw new Error("AFC sitemap too large");
  return xml;
}
export function sitemapReportLinks(xml:string,days:string[]){
  const allowed=new Set(days.map(day=>day.slice(0,4)+"-"+day.slice(4,6)+"-"+day.slice(6,8)));
  const found=new Set<string>();
  for(const match of xml.matchAll(/<url>\s*<loc>(https:\/\/www\.the-afc\.com\/en\/club\/afc_champions_league_elite\.html\/news\/md[^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})T/gi)){
    if(!allowed.has(match[2]))continue;
    try{const url=new URL(decode(match[1]));if(url.origin===ROOT&&url.pathname.startsWith("/en/club/afc_champions_league_elite.html/news/md"))found.add(url.href);}catch{}
  }
  return [...found];
}
async function sitemapReports(days:string[]){
  const index=await sitemap(SITEMAP_INDEX,100_000);
  const maps=[...index.matchAll(/<loc>(https:\/\/assets\.the-afc\.com\/sitemap\/sitemap\d+\.xml)<\/loc>/gi)].map(match=>match[1]);
  const latest=maps.at(-1);if(!latest)return [];
  return sitemapReportLinks(await sitemap(latest,4_000_000),days);
}
async function report(link:string){
  try{return parseAfcReport(await page(link),link,Date.now());}
  catch(firstError){
    try{return parseAfcReport(await page(link+(link.includes("?")?"&":"?")+"edge_retry=1"),link,Date.now());}
    catch(secondError){throw new Error("AFC report retry failed: "+String(firstError)+"; "+String(secondError));}
  }
}
export function reportLinks(html:string){
  const found=new Set<string>();
  for(const match of html.matchAll(/href="(https:\/\/www\.the-afc\.com\/en\/club\/afc_champions_league_elite\.html\/news\/md\d+-[^"]+)"/g)){
    const link=decode(match[1]);
    try{
      const url=new URL(link);
      if(url.origin===ROOT&&url.pathname.startsWith("/en/club/afc_champions_league_elite.html/news/md")&&url.pathname.length<240)found.add(url.href);
    }catch{}
  }
  return [...found];
}
export function parseAfcReport(html:string,sourceUrl:string,capturedAt:number):AfcResult{
  const url=new URL(sourceUrl);
  if(url.origin!==ROOT||!/^\/en\/club\/afc_champions_league_elite\.html\/news\/md\d+-[a-z0-9\u2019-]+$/.test(decodeURIComponent(url.pathname)))throw new Error("unexpected AFC report URL");
  const heading=decode(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]||"").replace(/\s+/g," ").trim();
  const match=heading.match(/^AFC Champions League Elite - MD\d+: (.+?) \([A-Z]{3}\) (\d{1,2})-(\d{1,2}) (.+?) \([A-Z]{3}\)$/);
  const publishedDate=html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})"/)?.[1];
  if(!match||!publishedDate||!Number.isFinite(Date.parse(publishedDate+"T00:00:00Z")))throw new Error("AFC report has no final-score heading/date");
  const titleInBody=decode(html.match(/<h1 class="seo-footer"><a[^>]+>([^<]+)<\/a><\/h1>/)?.[1]||"").replace(/\s+/g," ").trim();
  if(titleInBody!==heading.replace(/^AFC Champions League Elite - /,""))throw new Error("AFC report heading conflict");
  const homeScore=Number(match[2]),awayScore=Number(match[3]);
  if(homeScore>30||awayScore>30)throw new Error("AFC report score implausible");
  return{provider:"AFC official match report",sourceUrl,capturedAt,publishedDate,home:{name:match[1]},away:{name:match[4]},state:"finished",score:[homeScore,awayScore]};
}
export async function afcResults(days:string[]){
  const key=days.join(",");
  const existing=cached.get(key);
  if(existing&&Date.now()-existing.at<30_000)return existing.rows;
  if(pending.has(key))return pending.get(key)!;
  const task=(async()=>{
    const [indexResult,sitemapResult]=await Promise.allSettled([page(INDEX),sitemapReports(days)]);
    const links=[...new Set([...(indexResult.status==="fulfilled"?reportLinks(indexResult.value):[]),...(sitemapResult.status==="fulfilled"?sitemapResult.value:[])])].slice(0,24);
    if(indexResult.status==="rejected"&&sitemapResult.status==="rejected")throw new Error("AFC report discovery unavailable");
    const reports:PromiseSettledResult<AfcResult>[]=[];
    for(let offset=0;offset<links.length;offset+=3)reports.push(...await Promise.allSettled(links.slice(offset,offset+3).map(report)));
    const allowed=new Set(days.map(day=>day.slice(0,4)+"-"+day.slice(4,6)+"-"+day.slice(6,8)));
    const rows=reports.flatMap(item=>item.status==="fulfilled"&&allowed.has(item.value.publishedDate)?[item.value]:[]);
    const failures=reports.filter(item=>item.status==="rejected").length;
    if(failures)console.warn("afc_report_partial_failure",{links:links.length,failures});
    if(links.length&&!reports.some(item=>item.status==="fulfilled"))throw new Error("AFC report pages unavailable");
    if(cached.size>=4)cached.delete(cached.keys().next().value!);
    cached.set(key,{at:Date.now(),rows});return rows;
  })();
  pending.set(key,task);
  try{return await task}finally{pending.delete(key)}
}
// Official AFC reports often append legal/branding suffixes (FC, Club, SFC,
// SC) that ESPN omits. Remove only standalone suffix tokens before comparing;
// the fixture date and both home/away names must still agree.
const canonical=(name:string)=>name.toLowerCase().replace(/\b(?:f\.?c\.?|s\.?f\.?c\.?|s\.?c\.?|club)\b/g,"").replace(/[^a-z0-9]/g,"");
const aliases=new Map([["beijing","beijingguoan"]]);
const teamKey=(name:string)=>aliases.get(canonical(name))||canonical(name);
export function attachAfc<T extends AfcEvent>(events:T[],rows:AfcResult[]){
  return events.map(event=>{
    const comp=event?.competitions?.[0],home=comp?.competitors?.find(team=>team.homeAway==="home"),away=comp?.competitors?.find(team=>team.homeAway==="away");
    const kickoff=Date.parse(event?.date||"");
    if(!home||!away||!Number.isFinite(kickoff)||kickoff>Date.now())return event;
    const nameMatches=(team:AfcTeam,name:string)=>[team.team?.displayName,team.team?.shortDisplayName].some(value=>typeof value==='string'&&teamKey(value)===teamKey(name));
    const matches=rows.filter(row=>nameMatches(home,row.home.name)&&nameMatches(away,row.away.name)&&Math.abs(Date.parse(row.publishedDate+"T00:00:00Z")-kickoff)<48*3600000);
    if(matches.length!==1)return event;
    const official=matches[0],primaryState=comp?.status?.type?.state||event.status?.type?.state;
    const primaryConflict=primaryState!=="post"||String(home.score)!==String(official.score[0])||String(away.score)!==String(official.score[1]);
    const existing=event._edgeOfficial;
    const officialConflict=existing?.state==="finished"&&Array.isArray(existing.score)&&(existing.score[0]!==official.score[0]||existing.score[1]!==official.score[1]);
    return{...event,_edgeOfficial:existing||official,_edgeAfcOfficial:official,_edgeScoreConflict:!!event._edgeScoreConflict||primaryConflict||officialConflict};
  });
}
