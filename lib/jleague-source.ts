// Parses public page data as JSON only; never executes third-party scripts.
import {requireOk} from "@/lib/http-response";
type JTeam={teamId?:string|number;teamName?:string;name?:string;score?:number;players?:{name?:string;position?:string}[]};
type PageObject={variant?:string;homeTeam?:JTeam;awayTeam?:JTeam;date?:string;liveMatchInfo?:{passedMinutes?:number;periodOfTime?:string};type?:string};
type FeedTeam={homeAway?:string;score?:unknown;team?:{displayName?:string;shortDisplayName?:string}};
type JEvent={date?:string;competitions?:{competitors?:FeedTeam[];status?:{type?:{state?:string};displayClock?:string}}[];status?:{type?:{state?:string};displayClock?:string};_edgeScoreConflict?:boolean};

function objectsFromPage(html: string){
 if(typeof html!=='string'||html.length>3_000_000)throw Error('page size invalid');
 const streams=[];
 for(const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)){
  try{const a=JSON.parse(m[1]);if(typeof a[1]==='string')streams.push(a[1]);}catch{}
 }
 const objects:PageObject[]=[];
 const walk=(o:unknown,depth:number)=>{if(!o||typeof o!=='object'||depth>70)return;objects.push(o as PageObject);for(const v of Object.values(o))if(v&&typeof v==='object')walk(v,depth+1)};
 for(const line of streams.join('').split('\n')){try{walk(JSON.parse(line.slice(line.indexOf(':')+1)),0)}catch{}}
 return objects;
}
export function parseMatch(html: string,sourceUrl: string,capturedAt: number){
 const url=new URL(sourceUrl);
 if(url.origin!=='https://www.jleague.jp'||!/^\/en\/match\/(acle|acl2|j1|j2|j3)\/\d{4}\/\d{6}\/$/.test(url.pathname))throw Error('unexpected match URL');
 const objects=objectsFromPage(html);
 const headers=objects.filter(o=>o.variant==='game-details'&&o.homeTeam?.teamId&&o.awayTeam?.teamId&&o.date);
 if(headers.length!==1)throw Error('ambiguous or missing match header');
 const row=headers[0],homeTeam=row.homeTeam!,awayTeam=row.awayTeam!,date=new Date(String(row.date).replace(/^\$D/,''));
 const homeName=homeTeam.name,awayName=awayTeam.name;
 if(!homeName||!awayName)throw Error('match team name missing');
 const pathDate=url.pathname.match(/\/(\d{4})\/(\d{2})(\d{2})\d{2}\/$/)!;
 const localDay=new Date(date.getTime()+9*3600000).toISOString().slice(0,10);
 const pathDay=`${pathDate[1]}-${pathDate[2]}-${pathDate[3]}`;
 const jstHour=Number(new Date(date.getTime()+9*3600000).toISOString().slice(11,13));
 // Overnight ACL fixtures can be keyed to the previous calendar day on the site.
 const overnight=jstHour<6&&Date.parse(localDay+'T00:00:00Z')-Date.parse(pathDay+'T00:00:00Z')===86400000;
 if(localDay!==pathDay&&!overnight)throw Error('fixture date mismatch');
 const pair=[homeTeam.score,awayTeam.score];
 const scoreKnown=pair.every(x=>typeof x==='number'&&Number.isInteger(x)&&x>=0&&x<100);
 const minute=row.liveMatchInfo?.passedMinutes,period=row.liveMatchInfo?.periodOfTime;
 // Only observed, explicit live types are recognized. Unknown states remain unknown.
 const live=row.type==='in-game'&&['first-half','second-half'].includes(period||'')&&Number.isInteger(minute)&&minute!=null&&minute>=0&&minute<=150&&scoreKnown;
 const finished=row.type==='post-game'&&scoreKnown;
 const starters=objects.filter(o=>o.homeTeam?.teamName===homeName&&o.awayTeam?.teamName===awayName&&o.homeTeam?.players?.length===11&&o.awayTeam?.players?.length===11);
 const lineup=starters.length===1?{home:starters[0].homeTeam!.players!.map(p=>({name:p.name,position:p.position})),away:starters[0].awayTeam!.players!.map(p=>({name:p.name,position:p.position}))}:null;
 return{provider:'J.LEAGUE official',sourceUrl,capturedAt,sourceUpdatedAt:null,fixtureDate:date.toISOString(),home:{id:homeTeam.teamId,name:homeName},away:{id:awayTeam.teamId,name:awayName},rawState:row.type,state:live?'live':finished?'finished':'unverified',period:period||null,minute:live?minute:null,score:live||finished?pair:null,lineup};
}
export function matchLinks(html: string){return [...new Set([...html.matchAll(/href="(\/en\/match\/(?:acle|acl2|j1|j2|j3)\/\d{4}\/\d{6}\/)"/g)].map(m=>'https://www.jleague.jp'+m[1]))]}



type OfficialMatch=ReturnType<typeof parseMatch>;
const cached=new Map<string,{at:number;rows:OfficialMatch[]}>();
const pending=new Map<string,Promise<OfficialMatch[]>>();
async function page(url:string){
 const r=await fetch(url,{signal:AbortSignal.timeout(6000),headers:{accept:'text/html'}});
 await requireOk(r,'JLeague');
 return r.text();
}
export async function officialMatches(days:string[]){
 const key=days.join(',');
 const existing=cached.get(key);
 if(existing&&Date.now()-existing.at<30000)return existing.rows;
 if(pending.has(key))return pending.get(key)!;
 const task=(async()=>{
  const index=await page('https://www.jleague.jp/en/acle/match/');
  const previous=days.map(day=>new Date(Date.parse(`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}T00:00:00Z`)-86400000).toISOString().slice(0,10).replaceAll('-',''));
  const exact=(url:string)=>days.some(day=>url.includes('/'+day.slice(0,4)+'/'+day.slice(4,8)));
  const links=matchLinks(index).filter(url=>exact(url)||previous.some(day=>url.includes('/'+day.slice(0,4)+'/'+day.slice(4,8)))).sort((a,b)=>Number(exact(b))-Number(exact(a))).slice(0,12);
  const result:PromiseSettledResult<OfficialMatch>[]=[];
  for(let offset=0;offset<links.length;offset+=3)result.push(...await Promise.allSettled(links.slice(offset,offset+3).map(async url=>parseMatch(await page(url),url,Date.now()))));
  const rows=result.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
  if(links.length&&!rows.length)throw Error('JLeague match pages unavailable');
  if(cached.size>=4)cached.delete(cached.keys().next().value!);
  cached.set(key,{at:Date.now(),rows});return rows;
 })();
 pending.set(key,task);
 try{return await task}finally{pending.delete(key)}
}
// The J.LEAGUE archive URL is deterministic by local date and fixture slot.
// Its index can lag or omit a finished J1 match, so reconciliation may query
// the small set of slots for a day directly.
export async function officialJ1DayMatches(day:string){
 const year=String(day).slice(0,4),monthDay=String(day).slice(4,8);
 if(!/^\d{4}$/.test(year)||!/^\d{4}$/.test(monthDay))throw Error('invalid J1 match day');
 const urls=Array.from({length:12},(_,index)=>`https://www.jleague.jp/en/match/j1/${year}/${monthDay}${String(index+1).padStart(2,'0')}/`);
 const results:PromiseSettledResult<OfficialMatch>[]=[];
 for(let offset=0;offset<urls.length;offset+=3)results.push(...await Promise.allSettled(urls.slice(offset,offset+3).map(async url=>parseMatch(await page(url),url,Date.now()))));
 return results.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
}
function canonicalName(name:string){return name.toLowerCase().replace(/\bfc\b|\bf\.c\./g,'').replace(/[^a-z0-9]/g,'')}
export function attachOfficial<T extends JEvent>(events:T[],rows:OfficialMatch[]){
 return events.map(event=>{
  const comp=event.competitions?.[0],home=comp?.competitors?.find(x=>x.homeAway==='home'),away=comp?.competitors?.find(x=>x.homeAway==='away');
  if(!home||!away)return event;
  const nameMatches=(team:FeedTeam,name:string)=>[team.team?.displayName,team.team?.shortDisplayName].some(n=>typeof n==='string'&&canonicalName(n)===canonicalName(name));
  const matches=rows.filter(r=>nameMatches(home,r.home.name)&&nameMatches(away,r.away.name)&&Math.abs(Date.parse(r.fixtureDate)-Date.parse(event.date||''))<=5*60000);
  if(matches.length!==1)return event;
  const official=matches[0],state=comp?.status?.type?.state||event.status?.type?.state;
  const primaryMinute=Number(String(comp?.status?.displayClock||event.status?.displayClock||'').match(/\d{1,3}/)?.[0]);
  const minuteConflict=Number.isFinite(primaryMinute)&&primaryMinute>0&&official.minute!=null&&Math.abs(primaryMinute-official.minute)>8;
  const conflict=(official.state==='live'||official.state==='finished')&&((official.state==='live'?state!=='in':state!=='post')||!official.score||String(home.score)!==String(official.score[0])||String(away.score)!==String(official.score[1])||(official.state==='live'&&minuteConflict));
  return {...event,_edgeOfficial:official,_edgeScoreConflict:!!event._edgeScoreConflict||conflict};
 });
}
