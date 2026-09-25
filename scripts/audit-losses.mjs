import { DatabaseSync } from "node:sqlite";
import {readLocalLab} from './local-lab-reader.mjs';

const databasePath = process.argv[2];
if (!databasePath) throw new Error("usage: node scripts/audit-losses.mjs <sqlite-path>");

const db = new DatabaseSync(databasePath, { readOnly: true });
const lab = readLocalLab(db).lab;
db.close();
const settled = (ticket) => ["win", "loss", "void"].includes(ticket.status);
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const oddsBand = (odds) => odds < 1.6 ? "<1.60" : odds < 2 ? "1.60–1.99" : odds < 3 ? "2.00–2.99" : odds < 5 ? "3.00–4.99" : "≥5.00";
const scoreBand = (score) => !Number.isFinite(score) ? "missing" : score >= 75 ? "A" : score >= 60 ? "B" : score >= 45 ? "C" : "D";
const marketName = (leg) => leg.market || "1x2";

function summarize(items) {
  const stake = items.filter((item) => item.status !== "void").reduce((sum, item) => sum + Number(item.stake || 0), 0);
  const pnl = items.reduce((sum, item) => sum + Number(item.pnl || 0), 0);
  return {
    settled: items.length,
    wins: items.filter((item) => item.status === "win").length,
    losses: items.filter((item) => item.status === "loss").length,
    stake: round(stake),
    pnl: round(pnl),
    roi: stake ? round(pnl / stake * 100) : null,
  };
}

function grouped(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, ...summarize(rows) }))
    .sort((a, b) => a.pnl - b.pnl || b.settled - a.settled);
}

const tickets = lab.portfolios.flatMap((portfolio) => portfolio.tickets
  .filter(settled)
  .map((ticket) => ({ ...ticket, portfolioId: portfolio.id, portfolioName: portfolio.name })));

const uniqueLegs = new Map();
for (const portfolio of lab.portfolios) for (const ticket of portfolio.tickets) {
  if (!settled(ticket)) continue;
  for (const leg of ticket.legs || []) {
    if (!["win", "loss", "void"].includes(leg.status)) continue;
    const key = [leg.matchId, marketName(leg), leg.side ?? leg.pick, leg.line ?? "", leg.decisionVersion || leg.evidence?.modelVersion || leg.goalEvidence?.modelVersion || "legacy"].join("|");
    if (uniqueLegs.has(key)) continue;
    const factor = Number(leg.returnFactor ?? (leg.status === "win" ? leg.odds : leg.status === "void" ? 1 : 0));
    uniqueLegs.set(key, {
      status: leg.status,
      stake: 1,
      pnl: factor - 1,
      market: marketName(leg),
      league: leg.leagueCode || "missing",
      odds: Number(leg.odds),
      score: Number(leg.score),
      version: leg.decisionVersion || leg.evidence?.modelVersion || leg.goalEvidence?.modelVersion || "legacy",
      fill: String(ticket.id).includes(":fill:"),
      expectedReturn: Number(leg.expectedReturn ?? leg.probability * leg.odds),
    });
  }
}
const legs = [...uniqueLegs.values()];

const output = {
  generatedAt: new Date().toISOString(),
  totals: summarize(tickets),
  portfolios: grouped(tickets, (ticket) => `${ticket.portfolioId} · ${ticket.portfolioName}`),
  marketCombinations: grouped(tickets, (ticket) => [...new Set((ticket.legs || []).map(marketName))].sort().join("+") || "missing"),
  ticketOdds: grouped(tickets, (ticket) => oddsBand(Number(ticket.odds))),
  ticketKinds: grouped(tickets, (ticket) => String(ticket.id).includes(":fill:") ? "fill" : "qualified"),
  legMarkets: grouped(legs, (leg) => leg.market),
  legOdds: grouped(legs, (leg) => oddsBand(leg.odds)),
  legScores: grouped(legs, (leg) => scoreBand(leg.score)),
  legVersions: grouped(legs, (leg) => leg.version),
  legLeagues: grouped(legs, (leg) => leg.league).filter((row) => row.settled >= 3),
  legQualification: grouped(legs, (leg) => leg.fill ? "fill" : "qualified"),
  negativeExpectedValue: grouped(legs, (leg) => leg.expectedReturn < 1 ? "negative-EV" : "nonnegative-EV"),
};

console.log(JSON.stringify(output, null, 2));
