import fs from "node:fs";
import { makeGoalEvidence, makeCurrentOnlyGoalEvidence, dcScoreGrid } from "../.models-local/frozen/20261001-r1/legacy-arithmetic.mjs";
const { goalStats: g, neutral, at } = JSON.parse(fs.readFileSync(0, "utf8"));
const clock = Date.now;
Date.now = () => at;
try {
  const evidence = g.homePrev && g.awayPrev && g.homePrev.games >= 15 && g.awayPrev.games >= 15
    ? makeGoalEvidence(g.home, g.away, g.homePrev, g.awayPrev, g.mean, g.meanPrev, [], [g.season, g.season - 1], g.observedAt)
    : makeCurrentOnlyGoalEvidence(g.home, g.away, g.mean, "", g.season, g.observedAt);
  if (evidence && neutral) {
    evidence.expectedHome /= 1.15;
    evidence.expectedAway /= .85;
  }
  process.stdout.write(JSON.stringify(evidence ? { evidence, grid: dcScoreGrid(evidence.expectedHome, evidence.expectedAway, evidence.rho) } : null));
} finally { Date.now = clock; }
