import { rows, stmt, uid, atomic } from "../repositories/db";
import type { Context } from "./commands";
import { captureSource } from "./sources";
import { normalizeJFA, EMPERORS_CUP_SOURCE } from "./official";
import { adjudicate } from "./adjudications";
import { settle } from "./commands";
import { workspaceMetadata, localDay } from "./workspace";
import {
  boundedBody,
  evidenceChunks,
} from "../../../../packages/sources/index";
import { canonical, sha } from "../../../../packages/contracts/index";
import {
  captureSummary,
  freezePublicResearch,
  publicMarkets,
} from "./public-research";
import { autoPaper } from "./universal";

export function espnUrl(league: string, day: string) {
  if (!/^[a-z0-9_.]{3,50}$/.test(league) || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw Error("SOURCE_UNSUPPORTED");
  const parsed = new Date(day + "T00:00:00Z");
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  )
    throw Error("INVALID_CALENDAR_DATE");
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${day.replaceAll("-", "")}&limit=100`;
}
export function normalizeESPN(j: any, league: string, day: string) {
  const events = j?.events ?? j?.content?.sbData?.events;
  if (!Array.isArray(events) || events.length > 1000)
    throw Error("SOURCE_SCHEMA_CHANGED");
  return events
    .map((e: any) => {
      const co = e.competitions?.[0],
        home = co?.competitors?.find((t: any) => t.homeAway === "home"),
        away = co?.competitors?.find((t: any) => t.homeAway === "away");
      if (
        !/^\d{3,30}$/.test(String(e.id)) ||
        typeof home?.team?.displayName !== "string" ||
        typeof away?.team?.displayName !== "string" ||
        !/(Z|[+-]\d\d:\d\d)$/.test(e.date) ||
        !Number.isFinite(Date.parse(e.date))
      )
        throw Error("SOURCE_IDENTITY_REVIEW");
      const kickoffAt = Date.parse(e.date),
        st = co.status ?? e.status,
        state = st?.type?.state,
        name = st?.type?.name ?? "";
      const finished =
        state === "post" &&
        name === "STATUS_FULL_TIME" &&
        (st.period === undefined || st.period === 2);
      const scores = [home.score, away.score].map((v: any) =>
        typeof v === "string" && /^\d{1,2}$/.test(v)
          ? Number(v)
          : typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99
            ? v
            : null,
      );
      return {
        id: `espn:${league}:${e.id}`,
        competition: league,
        season: new Date(kickoffAt).getUTCFullYear(),
        home: home.team.displayName,
        away: away.team.displayName,
        homeId: String(home.team.id),
        awayId: String(away.team.id),
        kickoffAt,
        status: /POSTPONED|DELAYED/.test(name)
          ? "POSTPONED"
          : /CANCEL/.test(name)
            ? "CANCELLED"
            : /SUSPEND|ABANDON/.test(name)
              ? "SUSPENDED"
              : state === "post"
                ? "FINISHED"
                : state === "in"
                  ? "LIVE"
                  : "SCHEDULED",
        regulation: finished && scores.every((v) => v !== null) ? scores : null,
        score: ["in", "post"].includes(state) ? scores : null,
        clock:
          state === "in" &&
          typeof st.displayClock === "string" &&
          st.displayClock.trim()
            ? st.displayClock
            : null,
        sourceEventId: String(e.id),
        requestedDay: day,
        providerOdds: Array.isArray(co.odds)
          ? co.odds.filter((o: any) => o && typeof o === "object")
          : [],
        providerStatus: st ?? null,
        venue: co.venue ?? null,
        statistics: {
          home: home.statistics ?? [],
          away: away.statistics ?? [],
        },
        statusDetail: st?.type?.detail ?? name,
        homeLogo: home.team.logo ?? null,
        awayLogo: away.team.logo ?? null,
      };
    })
    .filter(
      (f: any) =>
        localDay(f.kickoffAt) >= day &&
        localDay(f.kickoffAt) <=
          localDay(Date.parse(day + "T00:00:00Z") + 86400000),
    );
}
export async function captureESPN(
  c: Context,
  league: string,
  day: string,
  fetcher: typeof fetch = fetch,
) {
  const installation = await stmt(
    c.db,
    "SELECT mode FROM installations WHERE id=?",
    c.installationId,
  ).first<any>();
  if (installation?.mode !== "LOCAL_RESEARCH") throw Error("MODE_MISMATCH");
  const known = (await workspaceMetadata(c.db)).leagues;
  if (league !== "jfa.emperors" && !known.some((l: any) => l.code === league))
    throw Error("SOURCE_UNSUPPORTED");
  const official = league === "jfa.emperors",
    provider = official ? "JFA_OFFICIAL_FIXTURE_V1" : "ESPN_PUBLIC_V1";
  const source = official ? EMPERORS_CUP_SOURCE : espnUrl(league, day),
    run = uid();
  const retry = await stmt(
    c.db,
    "SELECT state,reason,nextAttemptAt FROM source_runs WHERE providerId=? AND (sourceUrl=? OR reason LIKE '%SOURCE_HTTP_429%') ORDER BY startedAt DESC LIMIT 1",
    provider,
    source,
  ).first<any>();
  if (retry?.state === "FAILED" && retry.nextAttemptAt > c.now)
    return { state: "BACKOFF", reason: retry.reason, count: 0 };
  await stmt(
    c.db,
    "INSERT INTO source_runs VALUES(?,?,?,?,?,?,NULL,'CAPTURING',NULL,NULL,0,?)",
    run,
    provider,
    league,
    Number(day.slice(0, 4)),
    source,
    c.now,
    c.now + 300000,
  ).run();
  try {
    const response = await fetcher(source, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json" },
    });
    const bytes = await boundedBody(response),
      chunks = evidenceChunks(bytes),
      text = chunks.join(""),
      snapshot = uid(),
      observed = Date.now();
    await atomic(c.db, [
      stmt(
        c.db,
        "INSERT INTO source_snapshots VALUES(?,?,?,?,?,NULL,?,'LOCAL_RESEARCH','COMPLETE')",
        snapshot,
        provider,
        source,
        observed,
        observed,
        await sha(text),
      ),
      ...chunks.map((v, i) =>
        stmt(c.db, "INSERT INTO source_chunks VALUES(?,?,?)", snapshot, i, v),
      ),
    ]);
    const data = official
      ? normalizeJFA(text)
      : normalizeESPN(JSON.parse(text.replace(/^\uFEFF/, "")), league, day);
    let detailBudget = 4;
    for (const f of data) {
      if (
        publicMarkets((f as any).providerOdds).some((q) =>
          q.prices.every(Boolean),
        )
      )
        (f as any).quoteEvidence = {
          snapshotId: snapshot,
          observedAt: observed,
        };
      if ((f as any).score) (f as any).scoreObservedAt = observed;
      const old = await stmt(
        c.db,
        "SELECT f.*,r.id revisionId,r.kickoffAt FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision WHERE f.id=?",
        f.id,
      ).first<any>();
      if (old && (old.home !== f.home || old.away !== f.away))
        throw Error("SOURCE_IDENTITY_REVIEW");
      const previousCatalog = await stmt(
        c.db,
        "SELECT dataJson,lastCapturedAt FROM fixture_catalog WHERE fixtureId=?",
        f.id,
      ).first<any>();
      const previousData = previousCatalog
        ? JSON.parse(previousCatalog.dataJson)
        : null;
      const previousDetail = previousData?.detail ?? null;
      (f as any).progressObservedAt =
        f.status === "LIVE" && (f as any).clock
          ? previousData?.status === "LIVE" &&
            previousData.clock === (f as any).clock &&
            canonical(previousData.score ?? null) ===
              canonical((f as any).score ?? null) &&
            previousData.providerStatus?.type?.name ===
              (f as any).providerStatus?.type?.name
            ? (previousData.progressObservedAt ??
              previousCatalog.lastCapturedAt)
            : observed
          : null;
      if (previousDetail) (f as any).detail = previousDetail;
      if (
        !official &&
        f.status === "SCHEDULED" &&
        f.kickoffAt > observed &&
        f.kickoffAt - observed < 7 * 86400000 &&
        detailBudget > 0 &&
        (!previousDetail ||
          observed - previousDetail.observedAt >
            (f.kickoffAt - observed <= 86400000 ? 300000 : 1800000))
      ) {
        detailBudget--;
        try {
          (f as any).detail = await captureSummary(c, f, fetcher);
          if (
            !publicMarkets((f as any).providerOdds).some((q) =>
              q.prices.every(Boolean),
            )
          ) {
            (f as any).providerOdds = (f as any).detail.summaryOdds;
            (f as any).quoteEvidence = {
              snapshotId: (f as any).detail.snapshotId,
              observedAt: (f as any).detail.observedAt,
            };
          }
        } catch (e) {
          (f as any).detailError = String(e).slice(0, 160);
        }
      }
      const queries: D1PreparedStatement[] = [];
      if (!old) {
        queries.push(
          stmt(
            c.db,
            "INSERT INTO fixtures VALUES(?,?,?,1,?)",
            f.id,
            f.home,
            f.away,
            f.status,
          ),
          stmt(
            c.db,
            "INSERT INTO fixture_revisions VALUES(?,?,1,?,?,?)",
            uid(),
            f.id,
            f.kickoffAt,
            observed,
            snapshot,
          ),
        );
      } else if (old.kickoffAt !== f.kickoffAt) {
        queries.push(
          stmt(
            c.db,
            "INSERT INTO fixture_revisions VALUES(?,?,?,?,?,?)",
            uid(),
            f.id,
            old.currentRevision + 1,
            f.kickoffAt,
            observed,
            snapshot,
          ),
          stmt(
            c.db,
            "UPDATE fixtures SET currentRevision=currentRevision+1,status=? WHERE id=? AND currentRevision=?",
            f.status,
            f.id,
            old.currentRevision,
          ),
          stmt(
            c.db,
            "UPDATE observation_slots SET state='SUPERSEDED',reason='KICKOFF_CHANGED' WHERE fixtureRevisionId=? AND state NOT IN('COMPLETE','MISSED','SUPERSEDED')",
            old.revisionId,
          ),
        );
      } else
        queries.push(
          stmt(c.db, "UPDATE fixtures SET status=? WHERE id=?", f.status, f.id),
        );
      queries.push(
        stmt(
          c.db,
          "INSERT INTO fixture_catalog VALUES(?,?,?,?,?,?) ON CONFLICT(fixtureId) DO UPDATE SET lastCapturedAt=excluded.lastCapturedAt,sourceUrl=excluded.sourceUrl,dataJson=excluded.dataJson",
          f.id,
          f.competition,
          f.season,
          observed,
          source,
          canonical(f),
        ),
      );
      if (f.status === "FINISHED")
        queries.push(
          stmt(
            c.db,
            "INSERT INTO result_observations SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM (SELECT o.status,o.regulationJson FROM result_observations o JOIN source_snapshots s ON s.id=o.sourceSnapshotId WHERE o.fixtureId=? AND s.providerId=? ORDER BY o.observedAt DESC,o.rowid DESC LIMIT 1) WHERE status=? AND regulationJson IS ?)",
            uid(),
            f.id,
            snapshot,
            f.regulation
              ? canonical({ home: f.regulation[0], away: f.regulation[1] })
              : null,
            f.status,
            observed,
            f.id,
            provider,
            f.status,
            f.regulation
              ? canonical({ home: f.regulation[0], away: f.regulation[1] })
              : null,
          ),
        );
      await atomic(c.db, queries);
      if (!official)
        await freezePublicResearch(c, f, snapshot, observed, fetcher);
    }
    await stmt(
      c.db,
      "UPDATE source_runs SET state=?,finishedAt=?,snapshotId=?,normalizedCount=?,reason=? WHERE id=?",
      data.length ? "DEGRADED" : "EMPTY",
      observed,
      snapshot,
      data.length,
      data.length
        ? official
          ? "OFFICIAL_FIXTURES_ONLY_SCORE_QUOTE_UNAVAILABLE"
          : "PUBLIC_REFERENCE_QUOTES_NOT_VERIFIED_CURRENT"
        : "SOURCE_RETURNED_EMPTY_FOR_REQUESTED_DATE",
      run,
    ).run();
    return {
      runId: run,
      count: data.length,
      state: data.length ? "DEGRADED" : "EMPTY",
    };
  } catch (e) {
    await stmt(
      c.db,
      "UPDATE source_runs SET state='FAILED',finishedAt=?,reason=? WHERE id=?",
      Date.now(),
      String(e).slice(0, 500),
      run,
    ).run();
    throw e;
  }
}
export async function autoSettle(c: Context) {
  const fixtures = await rows(
    c.db,
    "SELECT f.id,a.id adjudicationId,json_array_length(a.evidenceRefs) evidenceCount,COALESCE(a.revision,0) revision FROM fixtures f LEFT JOIN result_adjudications a ON a.fixtureId=f.id AND a.revision=(SELECT MAX(b.revision) FROM result_adjudications b WHERE b.fixtureId=f.id) WHERE EXISTS(SELECT 1 FROM result_observations o WHERE o.fixtureId=f.id) AND (a.id IS NULL OR json_array_length(a.evidenceRefs)<>(SELECT COUNT(*) FROM result_observations o WHERE o.fixtureId=f.id) OR a.state IN('ACCEPTED_REGULATION','REVIEW','VOID_BY_RULE') AND EXISTS(SELECT 1 FROM ticket_legs l JOIN fixture_revisions r ON r.id=l.fixtureRevisionId WHERE r.fixtureId=f.id AND NOT EXISTS(SELECT 1 FROM settlement_events e WHERE e.ticketId=l.ticketId AND e.adjudicationId=a.id))) ORDER BY f.id LIMIT 1000",
  );
  let reviewed = 0,
    settled = 0;
  for (const f of fixtures) {
    const obs = await rows(
        c.db,
        "SELECT id FROM result_observations WHERE fixtureId=? ORDER BY id",
        f.id,
      ),
      key =
        "auto-result:" + f.id + ":" + (await sha(canonical(obs))).slice(0, 24);
    try {
      const prior = await stmt(
        c.db,
        "SELECT resultRef FROM command_receipts WHERE scope=? AND idempotencyKey=?",
        c.installationId + ":source-adjudication",
        key,
      ).first<any>();
      const a =
        f.adjudicationId && f.evidenceCount === obs.length
          ? { id: f.adjudicationId }
          : prior
            ? { id: prior.resultRef }
            : await adjudicate(c, key, {
                fixtureId: f.id,
                expectedRevision: f.revision,
                selectedEvidenceId: null,
                reason:
                  "自动流程：仅在已知90分钟结果无冲突时接受；否则保留review",
              });
      const adjud = await stmt(
        c.db,
        "SELECT * FROM result_adjudications WHERE id=?",
        a.id,
      ).first<any>();
      if (adjud?.state !== "ACCEPTED_REGULATION") {
        reviewed++;
        if (!adjud || !["REVIEW", "VOID_BY_RULE"].includes(adjud.state))
          continue;
      }
      const tickets = await rows(
        c.db,
        "SELECT t.id,t.portfolioId FROM tickets t JOIN ticket_state s ON s.ticketId=t.id JOIN ticket_legs l ON l.ticketId=t.id JOIN fixture_revisions r ON r.id=l.fixtureRevisionId WHERE r.fixtureId=? AND NOT EXISTS(SELECT 1 FROM settlement_events e WHERE e.ticketId=t.id AND e.adjudicationId=?)",
        f.id,
        adjud.id,
      );
      for (const t of tickets) {
        const account = await stmt(
          c.db,
          "SELECT revision FROM portfolios WHERE id=?",
          t.portfolioId,
        ).first<any>();
        await settle(c, "auto-settle:" + t.id + ":" + adjud.id, {
          ticketId: t.id,
          adjudicationId: adjud.id,
          expectedRevision: account.revision,
        });
        settled++;
      }
    } catch (e) {
      if (!/REVISION_CONFLICT/.test(String(e))) throw e;
    }
  }
  return { reviewed, settled };
}
export async function automationTick(
  c: Context,
  mode: string,
  force = false,
  fetcher: typeof fetch = fetch,
) {
  if (mode !== "LOCAL_RESEARCH")
    return {
      state: "DEMO_OFFLINE",
      reason: "DEMO does not access real sources",
    };
  await stmt(
    c.db,
    "INSERT OR IGNORE INTO automation_state VALUES('LOCAL_PIPELINE',1,0,NULL,NULL,0,'IDLE',NULL)",
  ).run();
  const state = await stmt(
    c.db,
    "SELECT * FROM automation_state WHERE id='LOCAL_PIPELINE'",
  ).first<any>();
  if (
    !state.enabled ||
    (state.stage === "RUNNING" && c.now - state.lastAttemptAt < 60000) ||
    (!force && state.nextRunAt > c.now)
  )
    return state;
  const lock = await stmt(
    c.db,
    "UPDATE automation_state SET nextRunAt=?,lastAttemptAt=?,stage='RUNNING' WHERE id='LOCAL_PIPELINE' AND nextRunAt=? AND enabled=1",
    c.now + 60000,
    c.now,
    state.nextRunAt,
  ).run();
  if (lock.meta.changes !== 1) return { state: "BUSY" };
  try {
    const meta = await workspaceMetadata(c.db),
      leagues = meta.leagues ?? [];
    let capture: any;
    const today = localDay(c.now);
    const attempted = await rows(
      c.db,
      "SELECT DISTINCT competition FROM source_runs WHERE providerId='ESPN_PUBLIC_V1' AND sourceUrl LIKE ?",
      `%?dates=${today.replaceAll("-", "")}&limit=100`,
    );
    const checked = new Set(attempted.map((r) => r.competition));
    const missing = leagues.filter((l: any) => !checked.has(l.code));
    const wideCalendar = Array.from({ length: 22 }, (_, i) =>
      localDay(c.now + (i + 7) * 86400000),
    )
      .filter((d) => [0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay()))
      .flatMap((day) =>
        leagues.map((league: any) => ({
          league,
          day,
          url: espnUrl(league.code, day),
        })),
      );
    const wideSeen = await rows(
      c.db,
      "SELECT sourceUrl FROM source_runs WHERE providerId='ESPN_PUBLIC_V1' AND startedAt>?",
      c.now - 3600000,
    );
    const seenUrls = new Set(wideSeen.map((r) => r.sourceUrl));
    const wideMissing = wideCalendar.filter((r) => !seenUrls.has(r.url));
    const urgent = await stmt(
      c.db,
      "SELECT c.competition,c.sourceUrl,r.kickoffAt FROM fixture_catalog c JOIN fixtures f ON f.id=c.fixtureId JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision WHERE f.status='SCHEDULED' AND r.kickoffAt>? AND r.kickoffAt<? AND c.lastCapturedAt<? AND c.sourceUrl LIKE 'https://site.api.espn.com/%' AND NOT EXISTS(SELECT 1 FROM source_runs sr WHERE sr.providerId='ESPN_PUBLIC_V1' AND sr.sourceUrl=c.sourceUrl AND sr.startedAt>?) ORDER BY c.lastCapturedAt,r.kickoffAt LIMIT 1",
      c.now,
      c.now + 36 * 3600000,
      c.now - 180000,
      c.now - 180000,
    ).first<any>();
    const liveRefresh = await stmt(
      c.db,
      "SELECT cat.competition,cat.sourceUrl,r.kickoffAt FROM fixture_catalog cat JOIN fixtures f ON f.id=cat.fixtureId JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision WHERE (f.status='LIVE' OR f.status='SCHEDULED' AND r.kickoffAt<=?) AND r.kickoffAt>? AND cat.lastCapturedAt<? AND cat.sourceUrl LIKE 'https://site.api.espn.com/%' AND NOT EXISTS(SELECT 1 FROM source_runs sr WHERE sr.sourceUrl=cat.sourceUrl AND sr.startedAt>?) ORDER BY COALESCE((SELECT MAX(sr.startedAt) FROM source_runs sr WHERE sr.sourceUrl=cat.sourceUrl),cat.lastCapturedAt),r.kickoffAt LIMIT 1",
      c.now,
      c.now - 2 * 86400000,
      c.now - 60000,
      c.now - 60000,
    ).first<any>();
    let initialDiscovery = false;

    let advanceCursor = 0;
    const lastOpenLiga = await stmt(
      c.db,
      "SELECT MAX(startedAt) at FROM source_runs WHERE providerId='OPENLIGADB_V1'",
    ).first<any>();
    let wasUrgent = false;
    let wasWide = false;
    let wasLive = false;
    try {
      wasUrgent = JSON.parse(state.reason)?.capture?.priority === "URGENT";
      wasWide =
        JSON.parse(state.reason)?.capture?.state === "WIDE_MODEL_DISCOVERY";
      wasLive = JSON.parse(state.reason)?.capture?.priority === "LIVE";
    } catch {}
    if (liveRefresh && !wasLive) {
      initialDiscovery = true;
      const providerDay = new URL(liveRefresh.sourceUrl).searchParams.get(
        "dates",
      );
      try {
        if (!providerDay || !/^\d{8}$/.test(providerDay))
          throw Error("SOURCE_DAY_UNKNOWN");
        capture = {
          ...(await captureESPN(
            c,
            liveRefresh.competition,
            `${providerDay.slice(0, 4)}-${providerDay.slice(4, 6)}-${providerDay.slice(6, 8)}`,
            fetcher,
          )),
          priority: "LIVE",
        };
      } catch (e) {
        capture = {
          state: "SOURCE_FAILED",
          reason: String(e),
          priority: "LIVE",
        };
      }
    } else if (urgent && checked.has(urgent.competition) && !wasUrgent) {
      initialDiscovery = true;
      try {
        capture = {
          ...(await captureESPN(
            c,
            urgent.competition,
            // Reuse the date that actually contained this event: ESPN's
            // provider-day need not equal the kickoff's UTC calendar date.
            (() => {
              const date = new URL(urgent.sourceUrl).searchParams.get("dates");
              return date && /^\d{8}$/.test(date)
                ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
                : new Date(urgent.kickoffAt).toISOString().slice(0, 10);
            })(),
            fetcher,
          )),
          priority: "URGENT",
        };
      } catch (e) {
        capture = {
          state: "SOURCE_FAILED",
          reason: String(e),
          priority: "URGENT",
        };
      }
    } else if (!missing.length && wideMissing.length && !wasWide) {
      initialDiscovery = true;
      const results = await Promise.allSettled(
        wideMissing
          .slice(0, 4)
          .map((r) => captureESPN(c, r.league.code, r.day, fetcher)),
      );
      capture = {
        state: "WIDE_MODEL_DISCOVERY",
        results: results.map((r: any) =>
          r.status === "fulfilled"
            ? r.value
            : { state: "FAILED", reason: String(r.reason) },
        ),
      };
    } else if (
      !missing.length &&
      (!lastOpenLiga?.at || c.now - lastOpenLiga.at >= 3600000)
    ) {
      const year = Number(localDay(c.now).slice(0, 4)),
        season = Number(localDay(c.now).slice(5, 7)) < 7 ? year - 1 : year;
      try {
        capture = await captureSource(
          c,
          "auto-openliga-" + Math.floor(c.now / 300000),
          season,
          fetcher,
        );
      } catch (e) {
        capture = {
          state: "SOURCE_FAILED",
          reason: String(e),
          priority: "OPENLIGA",
        };
      }
    } else if (missing.length) {
      initialDiscovery = true;
      const batch = missing.slice(0, 2);
      const results = await Promise.allSettled(
        batch.map((l: any) => captureESPN(c, l.code, today, fetcher)),
      );
      capture = {
        state: "DISCOVERY_BATCH",
        attempted: checked.size + batch.length,
        totalConfigured: leagues.length,
        results: results.map((r: any, i: number) => ({
          league: batch[i].code,
          ...(r.status === "fulfilled"
            ? r.value
            : { state: "FAILED", reason: String(r.reason) }),
        })),
      };
    } else if (leagues.length) {
      const calendar = [-1, 0, 1, 2, 3, 4, 5, 6].flatMap((offset) =>
        leagues.map((league: any) => ({ league, offset })),
      );
      for (let offset = 7; offset < 29; offset++)
        for (const league of leagues) calendar.push({ league, offset });
      advanceCursor = Math.min(4, leagues.length);
      initialDiscovery = true;
      const result = await Promise.allSettled(
        Array.from({ length: advanceCursor }, (_, i) => {
          const { league, offset } =
            calendar[(state.cursor + i) % calendar.length];
          return captureESPN(
            c,
            league.code,
            localDay(c.now + offset * 86400000),
            fetcher,
          );
        }),
      );
      capture = {
        state: "ROTATION_BATCH",
        results: result.map((r) =>
          r.status === "fulfilled"
            ? r.value
            : { state: "FAILED", reason: String(r.reason) },
        ),
      };
    }
    const sourceSuccess =
      ["EMPTY", "DEGRADED", "CAPTURED"].includes(capture?.state) ||
      capture?.results?.some((r: any) =>
        ["EMPTY", "DEGRADED", "CAPTURED"].includes(r.state),
      );
    const paper = await autoPaper({ ...c, now: Date.now() });
    const settled = await autoSettle({ ...c, now: Date.now() });
    const prepared = await stmt(
      c.db,
      "SELECT DISTINCT cat.competition,cat.sourceUrl FROM fixture_catalog cat JOIN fixtures f ON f.id=cat.fixtureId JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision WHERE f.status='SCHEDULED' AND r.kickoffAt>? AND cat.lastCapturedAt<? AND EXISTS(SELECT 1 FROM comparison_features cf WHERE cf.fixtureId=f.id) AND EXISTS(SELECT 1 FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions fr ON fr.id=s.fixtureRevisionId WHERE fr.fixtureId=f.id) AND COALESCE((SELECT json_extract(b.canonical,'$.comparisonFeatures.featureHash') FROM input_bundles b JOIN observation_slots s ON s.id=b.slotId JOIN fixture_revisions fr ON fr.id=s.fixtureRevisionId WHERE fr.fixtureId=f.id ORDER BY b.cutoffAt DESC LIMIT 1),'')<>(SELECT cf.featureHash FROM comparison_features cf WHERE cf.fixtureId=f.id ORDER BY cf.observedAt DESC LIMIT 1) ORDER BY r.kickoffAt LIMIT 1",
      c.now,
      c.now - 30000,
    ).first<any>();
    let featureRefresh: any = null;
    if (prepared) {
      const day = new URL(prepared.sourceUrl).searchParams.get("dates");
      if (day && /^\d{8}$/.test(day)) {
        try {
          featureRefresh = await captureESPN(
            c,
            prepared.competition,
            `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
            fetcher,
          );
        } catch (e) {
          featureRefresh = { state: "FAILED", reason: String(e) };
        }
      }
    }
    await stmt(
      c.db,
      "UPDATE automation_state SET cursor=cursor+?,lastSuccessAt=CASE WHEN ?=1 THEN ? ELSE lastSuccessAt END,nextRunAt=?,stage='IDLE',reason=? WHERE id='LOCAL_PIPELINE'",
      advanceCursor,
      sourceSuccess ? 1 : 0,
      Date.now(),
      Date.now() + (initialDiscovery ? 5000 : 30000),
      canonical({
        capture,
        settled,
        featureRefresh,
        quoteRefresh: "PUBLIC_REFERENCE_ONLY_WHEN_AVAILABLE",
        features: "FROZEN_V6_RAW_HISTORY_AND_LEGACY_V2_SHADOW",
        predictions: "EXISTING_PULL_JOBS",
        automaticNewTickets: "REFERENCE_PRICE_PAPER_ONLY",
        paper,
      }),
    ).run();
    return { capture, settled, paper };
  } catch (e) {
    await stmt(
      c.db,
      "UPDATE automation_state SET nextRunAt=?,stage='FAILED',reason=? WHERE id='LOCAL_PIPELINE'",
      Date.now() + 60000,
      String(e).slice(0, 1000),
    ).run();
    return { state: "FAILED", reason: String(e) };
  }
}
