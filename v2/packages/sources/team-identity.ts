// Exact source-name aliases, verified against ESPN senior fixtures and the
// frozen national data registry. Preserve provider names/IDs in evidence.
const seniorCompetitions = new Set([
  "fifa.friendly",
  "fifa.world",
  "uefa.nations",
  "uefa.euro",
  "uefa.euroq",
  "afc.cupq",
  "caf.nations_qual",
  "concacaf.nations.league",
  "fifa.worldq.uefa",
  "fifa.worldq.afc",
  "fifa.worldq.caf",
  "fifa.worldq.concacaf",
  "fifa.worldq.conmebol",
  "fifa.worldq.ofc",
]);
const aliases: Record<string, string> = {
  "Bosnia-Herzegovina": "Bosnia and Herzegovina",
  "St. Lucia": "Saint Lucia",
  "St. Kitts and Nevis": "Saint Kitts and Nevis",
};
export function modelTeamName(sourceName: string, competition: string) {
  return seniorCompetitions.has(competition)
    ? (aliases[sourceName] ?? sourceName)
    : sourceName;
}
