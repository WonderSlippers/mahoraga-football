import { test } from "node:test";
import assert from "node:assert/strict";
import { previewFiles } from "../../packages/imports/index";
const ticket = {
  id: "t1",
  stake: 20,
  pnl: 30,
  status: "win",
  legs: [{ odds: 2.5 }, { odds: 1.2 }],
  note: "<script>alert(1)</script>",
};
test("A63 A64 A66 legacy JSON preserves missing fields/multileg and separates portfolios", async () => {
  const p = await previewFiles("old", [
    {
      name: "state.json",
      content: JSON.stringify({
        portfolios: [
          { id: "a", tickets: [ticket], balance: 900 },
          { id: "b", tickets: [ticket] },
        ],
      }),
    },
  ]);
  assert.equal(p.rows.length, 2);
  assert.notEqual(p.rows[0].businessKey, p.rows[1].businessKey);
  assert.equal(p.rows[0].stakeAtoms, "20000000");
  assert.equal(p.rows[0].legCount, 2);
  assert.equal(p.rows[0].currency, null);
  assert.ok(p.rows[0].warnings.includes("ORIGINAL_PREDICTION_MISSING"));
  assert.equal(JSON.parse(p.rows[0].raw).note, ticket.note);
  assert.equal(p.claims[0].legacyBalanceClaim, 900);
});
test("A65 CSV BOM escaped quotes newlines and commas are parsed by RFC parser", async () => {
  const p = await previewFiles("old", [
    {
      name: "tickets.csv",
      content:
        '\uFEFFid,stake,pnl,note\r\nt1,20,0,"hello, ""friend""\nnext line"\r\n',
    },
  ]);
  assert.equal(p.rows.length, 1);
  assert.equal(JSON.parse(p.rows[0].raw).note, 'hello, "friend"\nnext line');
  assert.equal(p.rows[0].pnlAtoms, "0");
  assert.equal(p.rows[0].legCount, null);
});
test("A67 duplicates retained as references; changed same key quarantined; null not zero", async () => {
  const p = await previewFiles("old", [
    {
      name: "a.txt",
      content: JSON.stringify([
        ticket,
        ticket,
        { ...ticket, pnl: 0 },
        { id: "missing", stake: null, pnl: null },
      ]),
    },
  ]);
  assert.deepEqual(
    p.rows.map((r) => r.disposition),
    ["ACCEPTED", "DUPLICATE", "QUARANTINE", "ACCEPTED"],
  );
  assert.equal(p.rows[3].stakeAtoms, null);
  assert.equal(p.report.portfolios["legacy-default"].missingStake, 1);
});
test("A65 actual v2 shard format requires complete same-revision parts", async () => {
  const portfolio = { id: "p", tickets: [ticket] },
    text = JSON.stringify(portfolio),
    revision = 123;
  const root = {
    format: "simulation-lab-shards-v1",
    revision,
    meta: { updatedAt: revision },
    manifest: [{ id: "p", parts: 2 }],
  };
  const rows = [
    {
      key: "simulation_lab_v2",
      updated_at: revision,
      payload: JSON.stringify(root),
    },
    ...["0", "1"].map((n, i) => ({
      key: "simulation_lab_v2:p:" + n,
      updated_at: revision,
      payload: JSON.stringify({
        revision,
        portfolioId: "p",
        index: i,
        chunk: i === 0 ? text.slice(0, 30) : text.slice(30),
      }),
    })),
  ];
  const p = await previewFiles("old", [
    { name: "app_state.json", content: JSON.stringify(rows) },
  ]);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].originalId, "t1");
  const bad = await previewFiles("old", [
    { name: "app_state.json", content: JSON.stringify(rows.slice(0, 2)) },
  ]);
  assert.equal(bad.rows.length, 0);
  assert.match(bad.warnings[0], /IMPORT_SHARD_MISSING/);
});

test("A74 imported prototype-like portfolio and status names remain plain data", async () => {
  const report = await previewFiles("safe", [
    {
      name: "old.json",
      content: JSON.stringify({
        portfolios: [
          {
            id: "__proto__",
            tickets: [
              { id: "a", stake: 1, pnl: 0, legs: [], status: "constructor" },
            ],
          },
          {
            id: "constructor",
            tickets: [
              { id: "b", stake: 2, pnl: null, legs: [], status: "__proto__" },
            ],
          },
        ],
      }),
    },
  ]);
  assert.equal(report.report.portfolios["__proto__"].stakeAtoms, "1000000");
  assert.equal(
    report.report.portfolios["constructor"].statuses["__proto__"],
    1,
  );
  assert.equal(Object.prototype.hasOwnProperty("records"), false);
  assert.equal(Object.prototype.hasOwnProperty("statuses"), false);
});
