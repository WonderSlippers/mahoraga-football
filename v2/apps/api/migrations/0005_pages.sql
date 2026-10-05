CREATE INDEX IF NOT EXISTS prediction_fixture ON predictions(fixtureRevisionId,modelId);
CREATE INDEX IF NOT EXISTS result_fixture ON result_observations(fixtureId,observedAt,id);
CREATE INDEX IF NOT EXISTS receipt_result ON command_receipts(resultRef,committedAt);
CREATE INDEX IF NOT EXISTS reported_page ON reported_trade_events(at,id);
CREATE INDEX IF NOT EXISTS evaluation_page ON evaluation_runs(createdAt,id);
