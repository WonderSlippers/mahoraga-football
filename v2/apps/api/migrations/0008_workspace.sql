CREATE TABLE IF NOT EXISTS workspace_imports(id TEXT PRIMARY KEY,sourceHash TEXT NOT NULL UNIQUE,sourceCutoffAt INTEGER NOT NULL,importedAt INTEGER NOT NULL,metadataJson TEXT NOT NULL,studyJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fixture_catalog(fixtureId TEXT PRIMARY KEY REFERENCES fixtures(id),competition TEXT NOT NULL,season INTEGER NOT NULL,lastCapturedAt INTEGER NOT NULL,sourceUrl TEXT NOT NULL,dataJson TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS automation_state(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,cursor INTEGER NOT NULL DEFAULT 0,lastAttemptAt INTEGER,lastSuccessAt INTEGER,nextRunAt INTEGER NOT NULL DEFAULT 0,stage TEXT NOT NULL,reason TEXT);
CREATE INDEX IF NOT EXISTS fixture_catalog_competition ON fixture_catalog(competition,fixtureId);
