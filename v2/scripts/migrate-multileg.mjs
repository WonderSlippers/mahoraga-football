// Direct blocker for the retained two-leg simulation workflow. Own D1 only.
export async function migrateMultiLeg(db) {
  const prior = await db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='ticket_legs'",
    )
    .first();
  if (!/ticketId TEXT NOT NULL UNIQUE/i.test(prior.sql)) return;
  const before = await db.prepare("SELECT COUNT(*) n FROM ticket_legs").first();
  await db.batch([
    db.prepare(
      "CREATE TABLE ticket_legs_multi(id TEXT PRIMARY KEY,ticketId TEXT NOT NULL REFERENCES tickets(id),fixtureRevisionId TEXT NOT NULL REFERENCES fixture_revisions(id),quoteSelectionId TEXT NOT NULL REFERENCES quote_selections(id),predictionId TEXT NOT NULL REFERENCES predictions(id),frozenOdds TEXT NOT NULL,selection TEXT NOT NULL,marketSpecJson TEXT NOT NULL,UNIQUE(ticketId,fixtureRevisionId))",
    ),
    db.prepare(
      "INSERT INTO ticket_legs_multi SELECT * FROM ticket_legs ORDER BY rowid",
    ),
    db.prepare("DROP TABLE ticket_legs"),
    db.prepare("ALTER TABLE ticket_legs_multi RENAME TO ticket_legs"),
  ]);
  const after = await db.prepare("SELECT COUNT(*) n FROM ticket_legs").first();
  if (before.n !== after.n) throw Error("LEG_PRESERVATION_FAILED");
  const check = await db.prepare("PRAGMA foreign_key_check").all();
  if (check.results.length) throw Error("LEG_FOREIGN_KEY_FAILED");
}
