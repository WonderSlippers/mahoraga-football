import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const oddsSnapshots = sqliteTable("odds_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  matchId: text("match_id").notNull(),
  leagueCode: text("league_code").notNull(),
  capturedAt: integer("captured_at").notNull(),
  homeOdds: real("home_odds"),
  drawOdds: real("draw_odds"),
  awayOdds: real("away_odds"),
  provider: text("provider").notNull(),
}, (table) => [
  index("idx_odds_snapshots_match_time").on(table.matchId, table.capturedAt),
]);

export const marketQuotes = sqliteTable("market_quotes", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull(),
  leagueCode: text("league_code").notNull(),
  home: text("home").notNull(),
  away: text("away").notNull(),
  kickoffAt: integer("kickoff_at").notNull(),
  capturedAt: integer("captured_at").notNull(),
  market: text("market").notNull(),
  line: real("line").notNull(),
  overOdds: real("over_odds").notNull(),
  underOdds: real("under_odds").notNull(),
  provider: text("provider").notNull(),
  phase: text("phase").notNull(),
  sourceUrl: text("source_url").notNull(),
},table=>[index("idx_market_quotes_match_time").on(table.leagueCode,table.matchId,table.capturedAt)]);

export const marketResults=sqliteTable('market_results',{
  id:text('id').primaryKey(),matchId:text('match_id').notNull(),leagueCode:text('league_code').notNull(),
  observedAt:integer('observed_at').notNull(),state:text('state').notNull(),homeScore:integer('home_score'),awayScore:integer('away_score'),
  detail:text('detail').notNull(),sourceUrl:text('source_url').notNull(),fingerprint:text('fingerprint').notNull(),
},t=>[index('idx_market_results_match_time').on(t.leagueCode,t.matchId,t.observedAt)]);

// Append-only prospective observations. These are not bets and never mutate
// historical tickets; evaluation joins them to independently observed finals.
export const modelForecasts=sqliteTable('model_forecasts',{
  id:text('id').primaryKey(),leagueCode:text('league_code').notNull(),matchId:text('match_id').notNull(),
  kickoffAt:integer('kickoff_at').notNull(),capturedAt:integer('captured_at').notNull(),sourceObservedAt:integer('source_observed_at').notNull(),
  sourceUrl:text('source_url').notNull(),sourceUpdatedAt:integer('source_updated_at'),
  quoteProvider:text('quote_provider').notNull(),quotePhase:text('quote_phase').notNull(),
  homeOdds:real('home_odds').notNull(),drawOdds:real('draw_odds').notNull(),awayOdds:real('away_odds').notNull(),
  rawProbabilities:text('raw_probabilities').notNull(),pick:integer('pick').notNull(),conservativeProbability:real('conservative_probability').notNull(),
  oldScore:integer('old_score').notNull(),newScore:integer('new_score').notNull(),modelVersion:text('model_version').notNull(),
},t=>[index('idx_model_forecasts_match_time').on(t.leagueCode,t.matchId,t.capturedAt),index('idx_model_forecasts_captured_at').on(t.capturedAt)]);

export const modelOutcomes=sqliteTable('model_outcomes',{
  id:text('id').primaryKey(),leagueCode:text('league_code').notNull(),matchId:text('match_id').notNull(),
  observedAt:integer('observed_at').notNull(),state:text('state').notNull(),homeScore:integer('home_score'),awayScore:integer('away_score'),
  sourceUrl:text('source_url').notNull(),detail:text('detail').notNull(),
},t=>[index('idx_model_outcomes_match_time').on(t.leagueCode,t.matchId,t.observedAt)]);
