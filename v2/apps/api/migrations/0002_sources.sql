CREATE TABLE IF NOT EXISTS source_runs(id TEXT PRIMARY KEY,providerId TEXT NOT NULL,competition TEXT NOT NULL,season INTEGER NOT NULL,sourceUrl TEXT NOT NULL,startedAt INTEGER NOT NULL,finishedAt INTEGER,state TEXT NOT NULL,reason TEXT,snapshotId TEXT REFERENCES source_snapshots(id),normalizedCount INTEGER NOT NULL DEFAULT 0,nextAttemptAt INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS source_run_page ON source_runs(startedAt,id);
CREATE TABLE IF NOT EXISTS fixture_sources(fixtureId TEXT PRIMARY KEY REFERENCES fixtures(id),providerId TEXT NOT NULL,competition TEXT NOT NULL,season INTEGER NOT NULL,homeSourceId TEXT NOT NULL,awaySourceId TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS normalization_receipts(snapshotId TEXT PRIMARY KEY REFERENCES source_snapshots(id),fixtureCount INTEGER NOT NULL,normalizedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS source_leases(providerId TEXT PRIMARY KEY,owner TEXT NOT NULL,leaseUntil INTEGER NOT NULL);
