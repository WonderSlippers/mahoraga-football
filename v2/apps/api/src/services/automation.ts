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
        status: state === "post" ? "FINISHED" : "SCHEDULED",
        regulation: finished && scores.every((v) => v !== null) ? scores : null,
        sourceEventId: String(e.id),
        requestedDay: day,
        providerOdds: co.odds ?? [],
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
    for (const f of data) {
      const old = await stmt(
        c.db,
        "SELECT f.*,r.id revisionId,r.kickoffAt FROM fixtures f JOIN fixture_revisions r ON r.fixtureId=f.id AND r.revision=f.currentRevision WHERE f.id=?",
        f.id,
      ).first<any>();
      if (old && (old.home !== f.home || old.away !== f.away))
        throw Error("SOURCE_IDENTITY_REVIEW");
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
            "INSERT INTO result_observations VALUES(?,?,?,?,?,?)",
            uid(),
            f.id,
            snapshot,
            f.regulation
              ? canonical({ home: f.regulation[0], away: f.regulation[1] })
              : null,
            f.status,
            observed,
          ),
        );
      await atomic(c.db, queries);
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
    "SELECT f.id,COALESCE((SELECT MAX(revision) FROM result_adjudications a WHERE a.fixtureId=f.id),0) revision FROM fixtures f WHERE EXISTS(SELECT 1 FROM result_observations o WHERE o.fixtureId=f.id) LIMIT 1000",
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
      const a = prior
        ? { id: prior.resultRef }
        : await adjudicate(c, key, {
            fixtureId: f.id,
            expectedRevision: f.revision,
            selectedEvidenceId: null,
            reason: "自动流程：仅在已知90分钟结果无冲突时接受；否则保留review",
          });
      const adjud = await stmt(
        c.db,
        "SELECT * FROM result_adjudications WHERE id=?",
        a.id,
      ).first<any>();
      if (adjud?.state !== "ACCEPTED_REGULATION") {
        reviewed++;
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
    let initialDiscovery = false;

    if (state.cursor % 10 === 0) {
      const year = Number(localDay(c.now).slice(0, 4)),
        season = Number(localDay(c.now).slice(5, 7)) < 7 ? year - 1 : year;
      capture = await captureSource(
        c,
        "auto-openliga:" + Math.floor(c.now / 300000),
        season,
        fetcher,
      );
    } else if (
      state.cursor % 30 === 15 ||
      !(await stmt(
        c.db,
        "SELECT id FROM source_runs WHERE providerId='JFA_OFFICIAL_FIXTURE_V1' LIMIT 1",
      ).first())
    ) {
      capture = await captureESPN(c, "jfa.emperors", localDay(c.now), fetcher);
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
      const league = leagues[(state.cursor - 1) % leagues.length],
        offset = [-1, 0, 1, 2, 3, 4, 5, 6][
          Math.floor(state.cursor / leagues.length) % 8
        ];
      capture = await captureESPN(
        c,
        league.code,
        localDay(c.now + offset * 86400000),
        fetcher,
      );
    }
    if (["FAILED", "NORMALIZATION_FAILED"].includes(capture?.state))
      throw Error(capture.reason || "SOURCE_UNAVAILABLE");
    const settled = await autoSettle(c);
    await stmt(
      c.db,
      "UPDATE automation_state SET cursor=cursor+1,lastSuccessAt=?,nextRunAt=?,stage='IDLE',reason=? WHERE id='LOCAL_PIPELINE'",
      Date.now(),
      Date.now() + (initialDiscovery ? 5000 : 30000),
      canonical({
        capture,
        settled,
        quoteRefresh: "PUBLIC_REFERENCE_ONLY_WHEN_AVAILABLE",
        features: "V6_V7_NECESSARY_INPUTS_BLOCKED",
        predictions: "EXISTING_PULL_JOBS",
        automaticNewTickets: false,
      }),
    ).run();
    return { capture, settled };
  } catch (e) {
    await stmt(
      c.db,
      "UPDATE automation_state SET cursor=cursor+1,nextRunAt=?,stage='FAILED',reason=? WHERE id='LOCAL_PIPELINE'",
      Date.now() + 60000,
      String(e).slice(0, 1000),
    ).run();
    return { state: "FAILED", reason: String(e) };
  }
}
