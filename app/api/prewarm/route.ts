import { GET as matchResearchGET } from "../match-research/route";
import {readJsonLimited} from '@/lib/limited-response';
// Pre-match research warmup (user directive 2026-09-18): one hour before
// kickoff the detail research (lineup/injuries/rest/news + DQD) must
// already be fetched and cached, so the analysis cards render instantly
// and the next scan prices candidates with fresh status data. The
// frontend auto-refresh calls this every minute; the route is cheap when
// nothing is due (cache hit = no upstream calls).
const warmed = new Map<string, number>();
export async function GET() {
  return Response.json({ ok: true, note: "POST {matches:[{league,id,kickoffAt}]} warms research for matches starting within 75 min" });
}
export async function POST(request: Request) {
  const origin=request.headers.get('origin');
  if(origin!==new URL(request.url).origin) return Response.json({ok:false,error:'仅允许同源预热'},{status:403});
  try {
    const body = await readJsonLimited(request,4096) as { matches?: { league: string; id: string; kickoffAt: number }[] };
    const list = Array.isArray(body?.matches) ? body.matches.slice(0, 12) : [];
    const now = Date.now();
    let warmedCount = 0, skipped = 0;
    for(let offset=0;offset<list.length;offset+=2)await Promise.allSettled(list.slice(offset,offset+2).map(async (m) => {
      const league = String(m.league || ""), id = String(m.id || "");
      if (!/^[a-z0-9_.]{3,48}$/.test(league) || !/^\d{5,30}$/.test(id)) return;
      const untilKickoff = Number(m.kickoffAt) - now;
      if (!(untilKickoff > 0 && untilKickoff <= 75 * 60000)) { skipped++; return; }
      const key = `${league}:${id}`;
      if (warmed.get(key) && now - warmed.get(key)! < 8 * 60000) { skipped++; return; }
      warmed.set(key, now);
      if (warmed.size > 200) { const oldest = [...warmed.entries()].sort((a, b) => a[1] - b[1])[0]; if (oldest) warmed.delete(oldest[0]); }
      const res = await matchResearchGET(new Request(`http://localhost/api/match-research?league=${encodeURIComponent(league)}&id=${encodeURIComponent(id)}`));
      if (res.ok) warmedCount++;
    }));
    return Response.json({ ok: true, warmed: warmedCount, skipped, due: list.filter(m => { const u = Number(m.kickoffAt) - now; return u > 0 && u <= 75 * 60000; }).length });
  } catch(error) { return Response.json({ ok: false }, { status:error instanceof RangeError?413:400 }); }
}
