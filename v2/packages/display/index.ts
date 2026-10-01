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
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}
export function formatDate(at: number | string) {
  return new Date(at).toLocaleString("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    hour12: false,
  });
}
export function formatTime(at: number | string) {
  return new Date(at).toLocaleTimeString("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
