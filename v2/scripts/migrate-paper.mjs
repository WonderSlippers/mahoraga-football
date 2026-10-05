// D1 cannot safely rebuild populated referenced parents with DROP TABLE.
// Upgrades are prepared in a separate offline copy; never weaken active FKs.
export async function migratePaper(db) {
  for (const table of [
    "market_definitions",
    "quote_selections",
    "portfolios",
    "tickets",
  ]) {
    const definition = await db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
      .bind(table)
      .first();
    const wanted =
      table === "market_definitions"
        ? "ASIAN_HANDICAP"
        : table === "quote_selections"
          ? "OVER"
          : "PAPER_RESEARCH";
    if (!definition?.sql.includes(wanted))
      throw Error("ISOLATED_PAPER_UPGRADE_REQUIRED");
  }
}
