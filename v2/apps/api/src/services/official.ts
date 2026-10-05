export const EMPERORS_CUP_SOURCE = "https://www.jfa.jp/match/news/00036688/";

function textOf(html: string) {
  return String(html)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// The JFA's published round-three table is a fixture source, not a live
// scoreboard or an odds source. No score/status/market is inferred from it.
export function parseEmperorsCupFixtures(html: string) {
  if (
    typeof html !== "string" ||
    html.length > 300_000 ||
    !html.includes("天皇杯")
  )
    throw Error("JFA page invalid");
  if (!html.includes("emperorscup_2026") || !html.includes("第106回"))
    throw Error("SOURCE_SEASON_MISMATCH");
  const byNumber = new Map<number, any>();
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => textOf(match[1]),
    );
    if (cells.length < 5) continue;
    const matchNo = Number(cells[0].replace(/[【】\[\]]/g, ""));
    const date = cells[1].match(/(\d{1,2})月(\d{1,2})日/);
    const time = cells[2].match(/^(\d{1,2}):(\d{2})$/);
    const teams = cells[3].split(/\s+vs\s+/i);
    if (
      !Number.isInteger(matchNo) ||
      matchNo < 57 ||
      matchNo > 72 ||
      !date ||
      !time ||
      teams.length !== 2
    )
      continue;
    const month = Number(date[1]),
      day = Number(date[2]),
      hour = Number(time[1]),
      minute = Number(time[2]);
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59
    )
      continue;
    const kickoffAt = Date.UTC(2026, month - 1, day, hour - 9, minute);
    const dateCheck = new Date(kickoffAt + 9 * 3600000);
    if (
      !Number.isFinite(kickoffAt) ||
      dateCheck.getUTCMonth() !== month - 1 ||
      dateCheck.getUTCDate() !== day ||
      !teams[0] ||
      !teams[1]
    )
      continue;
    byNumber.set(matchNo, {
      id: `jfa-emperors-2026-${matchNo}`,
      matchNo,
      kickoffAt,
      home: teams[0],
      away: teams[1],
      venue: cells[4],
      sourceUrl: EMPERORS_CUP_SOURCE,
    });
  }
  return [...byNumber.values()].sort(
    (a, b) => a.kickoffAt - b.kickoffAt || a.matchNo - b.matchNo,
  );
}

export function normalizeJFA(html: string) {
  return parseEmperorsCupFixtures(html).map((f) => ({
    ...f,
    id: `jfa:2026:${f.matchNo}`,
    competition: "jfa.emperors",
    season: 2026,
    sourceEventId: String(f.matchNo),
    status: "SCHEDULED",
    regulation: null,
    providerOdds: [],
    statistics: { home: [], away: [] },
    validation: "OFFICIAL_FIXTURE_ONLY_NO_LIVE_SCORE",
    limitations: "官方第三轮公告仅确认赛程；不推断比分、赔率或模型",
  }));
}
