import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
// Typed core projection. Reviewed SQL additionally defines append-only triggers and evidence tables.
export const installations = sqliteTable("installations", {
  id: text().primaryKey(),
  mode: text().notNull(),
  schemaVersion: integer().notNull(),
  appCodeSha: text().notNull(),
  createdAt: integer().notNull(),
});
export const portfolios = sqliteTable(
  "portfolios",
  {
    id: text().primaryKey(),
    mode: text().notNull(),
    revision: integer().notNull().default(0),
    available: integer().notNull(),
    openStake: integer().notNull(),
    realized: integer().notNull(),
    initial: integer().notNull(),
    frozen: integer().notNull().default(0),
  },
  (t) => [
    check(
      "conservation",
      sql`${t.available}+${t.openStake}=${t.initial}+${t.realized}`,
    ),
  ],
);
export const receipts = sqliteTable(
  "command_receipts",
  {
    id: text().primaryKey(),
    scope: text().notNull(),
    idempotencyKey: text().notNull(),
    requestHash: text().notNull(),
    guard: integer().notNull(),
    resultRef: text().notNull(),
    committedAt: integer().notNull(),
  },
  (t) => [
    uniqueIndex("receipt_key").on(t.scope, t.idempotencyKey),
    check("guard", sql`${t.guard}=1`),
  ],
);
export const tickets = sqliteTable(
  "tickets",
  {
    id: text().primaryKey(),
    portfolioId: text()
      .notNull()
      .references(() => portfolios.id),
    decisionId: text().notNull(),
    stakeAtoms: integer().notNull(),
    createdAt: integer().notNull(),
    businessKey: text().notNull(),
    placementDay: text().notNull(),
    origin: text().notNull(),
  },
  (t) => [
    uniqueIndex("ticket_business").on(t.portfolioId, t.businessKey),
    index("ticket_page").on(t.createdAt, t.id),
  ],
);
export const ledger = sqliteTable("ledger_entries", {
  id: text().primaryKey(),
  portfolioId: text()
    .notNull()
    .references(() => portfolios.id),
  commandId: text()
    .notNull()
    .references(() => receipts.id),
  ticketId: text().references(() => tickets.id),
  settlementEventId: text(),
  type: text().notNull(),
  availableDelta: integer().notNull(),
  openDelta: integer().notNull(),
  realizedDelta: integer().notNull(),
});
