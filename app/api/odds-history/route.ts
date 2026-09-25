import { readOddsHistory } from "@/db/odds";

export async function GET(request: Request) {
  const matchId = new URL(request.url).searchParams.get("matchId") || "";
  const leagueCode = new URL(request.url).searchParams.get("league") || "";
  if (!/^\d{3,30}$/.test(matchId) || !/^[a-z0-9_.]{3,48}$/.test(leagueCode)) return Response.json({ error: "比赛编号或联赛无效" }, { status: 400 });
  try {
    return Response.json({ ok: true, rows: await readOddsHistory(leagueCode, matchId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("odds_history_failed", error);
    return Response.json({ ok: false, rows: [] }, { status: 503 });
  }
}
