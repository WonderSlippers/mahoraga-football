import { inPlayProbabilities, fairOdds } from "@/lib/live-model";
import { goalEvidenceForMatches } from "@/lib/goal-model";
import {discardResponse} from "@/lib/http-response";
import {readJsonLimited} from "@/lib/limited-response";
// In-play paper board — auto mode. Polls the same ESPN boards the app uses,
// finds live matches, computes model fair prices from the pre-match goal
// model (time-decayed) and compares with the live market price when ESPN
// carries one. PAPER ONLY: no bets placed or modified.
const AUTO_LEAGUES = ["esp.1","ita.1","eng.1","ger.1","fra.1","ned.1","por.1","jpn.1","mex.1","fifa.friendly","fifa.friendly.w","eng.w.1","esp.w.1","fra.w.1","usa.nwsl","concacaf.nations.league"];
type BoardTeam={homeAway?:string;score?:number|string;team?:{id?:string;displayName?:string}};
type BoardEvent={id?:string|number;status?:{type?:{state?:string};clock?:number;period?:number};competitions?:{competitors?:BoardTeam[]}[]};
async function board(code: string, day: string) {
  try {
    const r = await fetch(`https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=${encodeURIComponent(code)}&date=${day}&limit=100`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) {await discardResponse(r);return [];}
    const j=await readJsonLimited(r,4_000_000) as {events?:unknown};
    return Array.isArray(j?.events)?j.events.slice(0,100) as BoardEvent[]:[];
  } catch { return []; }
}
const dayStr = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)).replaceAll("-", "");
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  // Manual mode retained: explicit eh/ea/minute/score params.
  const eh = Number(q.get("eh")), ea = Number(q.get("ea"));
  if (q.get("eh") !== null && q.get("ea") !== null && Number.isFinite(eh) && Number.isFinite(ea)) {
    const minute = Number(q.get("minute") || 0), hs = Number(q.get("hs") || 0), as = Number(q.get("as") || 0);
    const p = inPlayProbabilities(eh, ea, minute, hs, as);
    return Response.json({ ok: true, v:"2", paper: true, minute, score: [hs, as], fair: { home: fairOdds(p.home).toFixed(2), draw: fairOdds(p.draw).toFixed(2), away: fairOdds(p.away).toFixed(2), over15: fairOdds(p.over15).toFixed(2), under15: fairOdds(p.under15).toFixed(2) }, probabilities: { home: p.home, draw: p.draw, away: p.away } });
  }
  // Auto mode: live matches across the goal-model leagues, today + yesterday boards.
  const days = [dayStr(), dayStr(Date.now() - 86400000)];
  const live: {code:string;e:BoardEvent}[] = [];
  for(let offset=0;offset<AUTO_LEAGUES.length;offset+=2)await Promise.allSettled(AUTO_LEAGUES.slice(offset,offset+2).map(async code => {
    for (const d of days) for (const e of await board(code, d)) {
      const st = e?.status?.type;
      if (st?.state === "in") live.push({ code, e });
    }
  }));
  const wanted = live.slice(0, 10).map(({ code, e }) => {
    const comp = e.competitions?.[0] || {}, teams = comp.competitors || [];
    const home = teams.find(t => t.homeAway === "home"), away = teams.find(t => t.homeAway === "away");
    const clock = e.status?.clock ? Math.round(Number(e.status.clock) / 60) + 45 * (Math.max(1, Number(e.status.period || 1)) - 1) : 30;
    return { id: String(e.id||''), leagueCode: code, status: "soon", homeId: home?.team?.id, awayId: away?.team?.id, home: home?.team?.displayName || "主队", away: away?.team?.displayName || "客队", hs: Number(home?.score ?? 0), as: Number(away?.score ?? 0), minute: Math.min(110, clock) };
  }).filter(m => m.id&&m.homeId&&m.awayId);
  const evidence = await goalEvidenceForMatches(wanted);
  const rows = wanted.map(m => {
    const g=evidence.get(m.id);
    if (!g) return null;
    const p = inPlayProbabilities(g.expectedHome, g.expectedAway, m.minute, m.hs, m.as);
    return { match: `${m.home} vs ${m.away}`, league: m.leagueCode, minute: m.minute, score: [m.hs, m.as], modelLambdas: { home: +g.expectedHome.toFixed(2), away: +g.expectedAway.toFixed(2) }, fair: { home: +fairOdds(p.home).toFixed(2), draw: +fairOdds(p.draw).toFixed(2), away: +fairOdds(p.away).toFixed(2) } };
  }).filter(Boolean);
  return Response.json({ ok: true, paper: true, auto: true, checked: live.length, signals: rows, note: "滚球纸面模式：模型公允价仅作观察。与实际滚球赔率对比的差值才是潜在优势；不下注、不改单。" });
}
