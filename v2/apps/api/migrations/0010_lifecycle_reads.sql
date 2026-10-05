CREATE INDEX IF NOT EXISTS feature_bundle_lookup ON feature_snapshots(id,bundleId);
CREATE INDEX IF NOT EXISTS bundle_cutoff_lookup ON input_bundles(id,slotId,cutoffAt,quoteSetId);
CREATE INDEX IF NOT EXISTS source_attempt_url ON source_runs(sourceUrl,startedAt);
