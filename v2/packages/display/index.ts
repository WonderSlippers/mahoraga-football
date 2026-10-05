import names from "./team-names.json";

export const DISPLAY_TIME_ZONE = "Europe/Berlin";
const dictionary: Record<string, string> = names;
const alias = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
// Exact aliases retain club identity: Manchester City and United must never merge.
const aliases = new Map(
  Object.entries(dictionary).map(([name, zh]) => [alias(name), zh]),
);
const namesByChinese = new Map<string, string[]>();
for (const [original, chinese] of Object.entries(dictionary)) {
  const group = namesByChinese.get(chinese) ?? [];
  group.push(original);
  namesByChinese.set(chinese, group);
}
export function teamOriginalName(name: unknown) {
  const raw = String(name ?? "").trim();
  return (
    namesByChinese
      .get(raw)
      ?.reduce(
        (best, value) => (value.length > best.length ? value : best),
        "",
      ) || raw
  );
}
const searchKey = (text: unknown) =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function matchesTeamSearch(
  query: string,
  teams: unknown[],
  competition = "",
) {
  const needle = searchKey(query);
  return (
    !needle ||
    teams.some((name) => {
      const raw = String(name ?? "").trim();
      const chinese = dictionary[raw] ?? aliases.get(alias(raw)) ?? raw;
      return [
        raw,
        teamName(raw, competition),
        ...(namesByChinese.get(chinese) ?? []),
      ].some((value) => searchKey(value).includes(needle));
    })
  );
}
export function researchScoreBand(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  )
    return { score: null, grade: "UNKNOWN", label: "原模型未提供评分" };
  return {
    score: value,
    grade: value >= 75 ? "A" : value >= 60 ? "B" : value >= 45 ? "C" : "D",
    label:
      value >= 75
        ? "优先比较"
        : value >= 60
          ? "备选观察"
          : value >= 45
            ? "观望"
            : "低分对照",
  };
}
// Group display copies, retaining every frozen strategy/time/price observation.
// Never select the highest score or merge different lines/model identities.
export function researchBetKey(p: any) {
  return JSON.stringify([
    p.modelId ?? null,
    p.market ?? "1X2",
    p.selection,
    p.lineQ ?? null,
  ]);
}
export function groupResearchDirections(plans: any[] = []) {
  const groups = new Map<
    string,
    { primary: any; records: any[]; policies: string[] }
  >();
  for (const p of plans) {
    const key = researchBetKey(p);
    let group = groups.get(key);
    if (!group) {
      group = { primary: p, records: [], policies: [] };
      groups.set(key, group);
    }
    group.records.push(p);
    if (p.policyLabel && !group.policies.includes(p.policyLabel))
      group.policies.push(p.policyLabel);
  }
  return [...groups.values()];
}
export function compareResearchScores(a: unknown, b: unknown) {
  const first = researchScoreBand(a).score;
  const second = researchScoreBand(b).score;
  if (first == null) return second == null ? 0 : 1;
  if (second == null) return -1;
  return second - first;
}
// Rank the scores actually displayed, without replacing a group's first snapshot.
export function fixtureResearchScore(fixture: any, modelId?: string) {
  const current = fixture.state === "CANDIDATE" ? fixture.research : null;
  const currentKey = current
    ? researchBetKey({ ...current, modelId: current.modelId ?? modelId })
    : null;
  const scores = [
    ...(current ? [current.rankScore] : []),
    ...groupResearchDirections(fixture.generalDirections)
      .filter((group) => researchBetKey(group.primary) !== currentKey)
      .map((group) => group.primary.rank),
  ]
    .map((value) => researchScoreBand(value).score)
    .filter((value): value is number => value != null);
  return scores.length ? Math.max(...scores) : null;
}
export function teamName(name: unknown, competition = "") {
  const raw = String(name ?? "").trim();
  const base = dictionary[raw] ?? aliases.get(alias(raw)) ?? raw;
  return /(?:^|\.)w(?:\.|$)|wchampions|nwsl|women/i.test(competition) &&
    base &&
    !base.endsWith("女足")
    ? base + "女足"
    : base;
}
export function calendarDay(at: number | string, zone = DISPLAY_TIME_ZONE) {
  let formatter = dayFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(zone, formatter);
  }
  return formatter.format(new Date(at));
}
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DISPLAY_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});
const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: DISPLAY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function formatDate(at: number | string) {
  return dateFormatter.format(new Date(at));
}
export function formatTime(at: number | string) {
  return timeFormatter.format(new Date(at));
}
