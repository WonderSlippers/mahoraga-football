// Source identity is provider-scoped. No fuzzy cross-source team matching.
export const leagues = ["eng.1", "ger.1", "ita.1", "esp.1", "fra.1"] as const;
export const capabilities = leagues.map((competition) => ({
  providerId: "OPENLIGADB_V1",
  competition,
  fixtures: competition === "ger.1",
  regulationResults: competition === "ger.1",
  quotes: false,
  xg: false,
  reason:
    competition === "ger.1"
      ? "QUOTE_AND_XG_NOT_PROVIDED"
      : "COMPETITION_NOT_REGISTERED",
}));
export function sourceUrl(
  provider: string,
  competition: string,
  season: number,
) {
  if (provider !== "OPENLIGADB_V1" || competition !== "ger.1")
    throw Error("SOURCE_UNSUPPORTED");
  if (!Number.isInteger(season) || season < 2020 || season > 2099)
    throw Error("INVALID_SEASON");
  return `https://api.openligadb.de/getmatchdata/bl1/${season}`;
}
export function allowedSourceUrl(raw: string) {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      u.host === "api.openligadb.de" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/getmatchdata\/bl1\/20\d{2}$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export type SourceFixture = {
  id: string;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
  kickoffAt: number;
  status: "SCHEDULED" | "FINISHED";
  regulation: [number, number] | null;
  providerUpdatedAt: number | null;
  resultReason: string | null;
};
function score(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 99;
}
export function normalizeOpenLiga(
  payload: unknown,
  season: number,
): SourceFixture[] {
  if (!Array.isArray(payload) || payload.length > 500)
    throw Error("SOURCE_SCHEMA_CHANGED");
  const ids = new Set<string>();
  return payload.map((p: any) => {
    if (
      p.leagueShortcut !== "bl1" ||
      Number(p.leagueSeason) !== season ||
      !Number.isInteger(p.matchID) ||
      typeof p.matchIsFinished !== "boolean" ||
      !Number.isInteger(p.team1?.teamId) ||
      !Number.isInteger(p.team2?.teamId) ||
      typeof p.team1?.teamName !== "string" ||
      typeof p.team2?.teamName !== "string" ||
      p.team1.teamName.length > 200 ||
      p.team2.teamName.length > 200 ||
      p.team1.teamId === p.team2.teamId ||
      typeof p.matchDateTimeUTC !== "string" ||
      !/Z$/.test(p.matchDateTimeUTC) ||
      !Number.isFinite(Date.parse(p.matchDateTimeUTC))
    )
      throw Error("SOURCE_SCHEMA_CHANGED");
    const id = "openliga:" + p.matchID;
    if (ids.has(id)) throw Error("SOURCE_IDENTITY_CONFLICT");
    ids.add(id);
    const finals = (Array.isArray(p.matchResults) ? p.matchResults : []).filter(
      (r: any) => r.resultTypeKind === "After90Minutes",
    );
    const values = new Set(
      finals
        .filter((r: any) => score(r.pointsTeam1) && score(r.pointsTeam2))
        .map((r: any) => `${r.pointsTeam1}:${r.pointsTeam2}`),
    );
    const valid =
      p.matchIsFinished &&
      finals.length > 0 &&
      values.size === 1 &&
      finals.every((r: any) => score(r.pointsTeam1) && score(r.pointsTeam2));
    // lastUpdateDateTime usually has no offset: never infer a timezone from machine locale.
    const updated =
      typeof p.lastUpdateDateTime === "string" &&
      /(?:Z|[+-]\d{2}:\d{2})$/.test(p.lastUpdateDateTime)
        ? Date.parse(p.lastUpdateDateTime)
        : NaN;
    return {
      id,
      home: p.team1.teamName,
      away: p.team2.teamName,
      homeId: "openliga:" + p.team1.teamId,
      awayId: "openliga:" + p.team2.teamId,
      kickoffAt: Date.parse(p.matchDateTimeUTC),
      status: p.matchIsFinished ? "FINISHED" : "SCHEDULED",
      regulation: valid ? [finals[0].pointsTeam1, finals[0].pointsTeam2] : null,
      providerUpdatedAt: Number.isFinite(updated) ? updated : null,
      resultReason: !p.matchIsFinished
        ? null
        : values.size > 1
          ? "RESULT_CONFLICT"
          : valid
            ? null
            : "RESULT_REGULATION_UNKNOWN",
    };
  });
}
export async function boundedBody(
  response: Response,
  limit = 8 * 1024 * 1024,
): Promise<Uint8Array> {
  if (!response.ok) throw Error("SOURCE_HTTP_" + response.status);
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw Error("PAYLOAD_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("SOURCE_EMPTY");
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.byteLength;
      if (length > limit) throw Error("PAYLOAD_LIMIT");
      parts.push(r.value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
export function evidenceChunks(bytes: Uint8Array): string[] {
  // Fatal UTF8 decoding prevents lossy evidence from being published under the original hash.
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const chunks: string[] = [];
  // UTF-8 streaming decoder never splits a character. 64KiB is comfortably below D1 binding limit.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for (let i = 0; i < bytes.length; i += 65536)
    chunks.push(decoder.decode(bytes.subarray(i, i + 65536), { stream: true }));
  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return chunks;
}
export type ResultEvidence = {
  id: string;
  regulation: [number, number] | null;
  status: string;
};
export function adjudicateEvidence(evidence: ResultEvidence[]) {
  const refs = evidence.map((e) => e.id).sort();
  if (!evidence.length)
    return {
      state: "REVIEW",
      regulation: null,
      reason: "RESULT_MISSING",
      refs,
    };
  const scores = new Set(
    evidence
      .filter((e) => e.status === "FINISHED" && e.regulation)
      .map((e) => JSON.stringify(e.regulation)),
  );
  if (scores.size > 1)
    return {
      state: "REVIEW",
      regulation: null,
      reason: "RESULT_CONFLICT",
      refs,
    };
  if (evidence.some((e) => e.status !== "FINISHED" || !e.regulation))
    return {
      state: "REVIEW",
      regulation: null,
      reason: "RESULT_REGULATION_UNKNOWN",
      refs,
    };
  return {
    state: "CONFIRMED",
    regulation: JSON.parse([...scores][0]),
    reason: "SINGLE_SOURCE_REGULATION_V1",
    refs,
  };
}
