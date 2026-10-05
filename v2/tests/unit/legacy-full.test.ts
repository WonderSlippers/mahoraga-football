import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { build } from "esbuild";
import {
  legacyEvaluate,
  legacyDefaults,
  legacyRound,
} from "../../packages/domain/legacy-september-engine";
import { selectedVersion, versionPolicy } from "../../packages/domain/versions";
const at = Date.parse("2026-09-20T03:45:42Z");
let original: any;
const normalize = (v: any) => JSON.parse(JSON.stringify(v));
before(async () => {
  const source = fs.readFileSync(
    ".models-local/frozen/20261001-r1/lib/simulation-lab.ts",
    "utf8",
  );
  const result = await build({
    stdin: {
      contents:
        source +
        `\nexport function auditEvaluate(m:any,e:any){currentModelW=e.modelW;currentEvolutionShift=e.marginShift;return {broad:candidate(m),value:candidate(m,true),spread:spreadCandidate(m),total:totalsPoissonCandidate(m)}}\nexport {defaults};export {makeGoalEvidence,makeCurrentOnlyGoalEvidence} from "./goal-model";`,
      loader: "ts",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    plugins: [
      {
        name: "preserved-sources",
        setup(b) {
          b.onResolve({ filter: /goal-model/ }, () => ({
            path: "original-goal",
            namespace: "original",
          }));
          b.onLoad({ filter: /.*/, namespace: "original" }, () => ({
            contents: fs.readFileSync(
              ".models-local/frozen/20261001-r1/lib/goal-model.ts",
              "utf8",
            ),
            loader: "ts",
          }));
          b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
            path: "cloudflare",
            namespace: "shim",
          }));
          b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({
            contents: "export const env={};",
            loader: "js",
          }));
        },
      },
    ],
  });
  const DateFixed = class extends Date {
    constructor(value?: any) {
      super(value === undefined ? at : value);
    }
    static now() {
      return at;
    }
  };
  const context = {
    module: { exports: {} },
    Date: DateFixed,
    Intl,
    Map,
    Set,
    console,
    structuredClone,
    fetch: () => {
      throw Error("NETWORK_FORBIDDEN");
    },
  };
  vm.runInNewContext(result.outputFiles[0].text, context);
  original = context.module.exports;
});
function sample(i: number) {
  return {
    id: "SOFTWARE_TEST_" + i,
    leagueCode: i === 119 ? "jpn.1" : "eng.1",
    home: "TestHome" + i,
    away: "TestAway" + i,
    date: at + (15 + i * 9) * 60000,
    status: "soon",
    detail: "",
    goalModel: null,
    odds: [1.25 + i * 0.031, 3.1 + i * 0.006, 4.2 + i * 0.015],
    providers: ["TEST", "TEST", "TEST"],
    homeForm: i % 2 ? "WWDLW" : "LLDWL",
    awayForm: i % 3 ? "LDLLD" : "WWWDD",
    spreadOffers: [
      {
        homeLine: 0.5,
        awayLine: -0.5,
        home: 1.8 + i * 0.003,
        away: 2.1,
        provider: "TEST",
        phase: "current",
      },
    ],
    totalOffers: [
      { line: 2.5, over: 2.1, under: 1.9, provider: "TEST", phase: "current" },
    ],
  };
}
test("120 complete original candidate outputs including scores, rationale and PP agree with preserved module", () => {
  for (let i = 0; i < 120; i++) {
    const match = sample(i),
      evolution = {
        modelW: 0.2 + (i % 7) * 0.1,
        marginShift: ((i % 5) - 2) * 0.01,
      };
    const actual = legacyEvaluate({ at, match, evolution, goalStats: null });
    assert.deepEqual(
      normalize(actual.candidates),
      normalize(original.auditEvaluate(match, evolution)),
    );
  }
});
test("all original portfolios, daily top10, J1 quota, fills and combinations agree over 120 games", () => {
  const lab: any = legacyDefaults();
  lab.evolution = { modelW: 0.2, marginShift: 0.02, notes: [], computedAt: 0 };
  const matches = Array.from({ length: 120 }, (_, i) => sample(i));
  const expected = structuredClone(lab);
  const result = original.processLab(expected, matches);
  const actual = legacyRound(lab, matches, at);
  assert.deepEqual(normalize(actual.lab), normalize(expected));
  assert.deepEqual(normalize(actual.result), normalize(result));
  assert.equal(actual.lab.portfolios.length, 10);
  assert.ok(actual.proposals.some((p: any) => p.ticket.legs.length === 3));
  const scarce = legacyRound(
    lab,
    [
      {
        ...sample(0),
        odds: [2, 3.2, 4],
        homeForm: "",
        awayForm: "",
        spreadOffers: [],
        totalOffers: [],
      },
    ],
    at,
  );
  assert.ok(scarce.proposals.some((p: any) => p.ticket.id.includes(":fill:")));
  assert.equal(lab.portfolios.flatMap((p: any) => p.tickets).length, 0);
});
test("original PP evolves at its exact sample threshold and does not change frozen original tickets", () => {
  const lab: any = legacyDefaults();
  lab.evolution = { modelW: 0.5, marginShift: 0, notes: [], computedAt: 0 };
  lab.portfolios[0].tickets = Array.from({ length: 8 }, (_, i) => ({
    id: "settled" + i,
    day: "2026-09-19",
    createdAt: at - 86400000,
    settledAt: at - 1000,
    status: "loss",
    stake: 25,
    pnl: -25,
    legs: [
      {
        matchId: "old" + i,
        leagueCode: "eng.1",
        pick: 0,
        odds: 2,
        probability: 0.55,
        status: "loss",
        evidence: {
          adjustedProbabilities: [0.57, 0.2, 0.23],
          uncertaintyMargin: 0.02,
        },
      },
    ],
  }));
  const expected = structuredClone(lab);
  original.processLab(expected, []);
  const actual = legacyRound(lab, [], at);
  assert.deepEqual(normalize(actual.lab), normalize(expected));
  assert.equal(actual.lab.evolution.marginShift, 0.01);
  assert.deepEqual(lab.portfolios[0].tickets, actual.lab.portfolios[0].tickets);
});
test("4.42PP archived-state deduction is retained; changing evolution changes future calculation only", () => {
  const match = sample(0);
  const a = legacyEvaluate({
    at,
    match,
    evolution: { modelW: 0.2, marginShift: 0.02 },
    goalStats: null,
  });
  const b = legacyEvaluate({
    at,
    match,
    evolution: { modelW: 0.5, marginShift: 0 },
    goalStats: null,
  });
  assert.equal(a.candidates.broad.leg.evidence.uncertaintyMargin, 0.0442);
  assert.equal(b.candidates.broad.leg.evidence.uncertaintyMargin, 0.0242);
  assert.equal(a.candidates.broad.leg.evidence.uncertaintyMargin, 0.0442);
});
test("version selection refuses unknown identity and portfolio sets are disjoint", () => {
  assert.equal(
    selectedVersion(new URLSearchParams({ version: "SEPTEMBER20" })).modelId,
    "LEGACY_20260920_FULL_RULES_V1",
  );
  assert.throws(
    () => selectedVersion(new URLSearchParams({ version: "V999" })),
    /INVALID_MODEL_VERSION/,
  );
  for (const id of [
    "general-v2-all-singles",
    "september20:all-singles",
    "v6-native",
  ])
    assert.equal(
      ["GENERAL", "SEPTEMBER20", "V6"].filter((v) => versionPolicy(id, v))
        .length,
      1,
    );
});

test("100 original Poisson and Dixon-Coles evaluations with changing blend weights agree numerically", () => {
  for (let i = 0; i < 100; i++) {
    const evolution = {
      modelW: 0.2 + (i % 7) * 0.1,
      marginShift: ((i % 5) - 2) * 0.01,
    };
    const home = {
      games: 3 + (i % 17),
      for: 5 + (i % 29),
      against: 2 + (i % 19),
    };
    const away = {
      games: 4 + (i % 17),
      for: 4 + (i % 21),
      against: 3 + (i % 17),
    };
    const prevHome = { games: 38, for: 40 + (i % 35), against: 30 + (i % 29) };
    const prevAway = { games: 38, for: 35 + (i % 30), against: 35 + (i % 21) };
    const goalStats = {
      home,
      away,
      homePrev: prevHome,
      awayPrev: prevAway,
      mean: 1.3,
      meanPrev: 1.35,
      season: 2026,
      observedAt: at - 1000,
    };
    const actual = legacyEvaluate({
      at,
      match: sample(i),
      evolution,
      goalStats,
    });
    const expectedGoal = original.makeGoalEvidence(
      home,
      away,
      prevHome,
      prevAway,
      1.3,
      1.35,
      [],
      [2026, 2025],
      at - 1000,
    );
    assert.deepEqual(normalize(actual.goalModel), normalize(expectedGoal));
    assert.deepEqual(
      normalize(actual.candidates),
      normalize(
        original.auditEvaluate(
          { ...sample(i), goalModel: expectedGoal },
          evolution,
        ),
      ),
    );
  }
});
