import { test } from "node:test";
import assert from "node:assert/strict";
import { modelAsset } from "../../packages/contracts/model";
test("A07 A58 model asset names/hash/training time and retrospective gate", () => {
  const manifest = {
    modelId: "V7_RAW",
    trainCutoffAt: "2025-01-01T00:00:00Z",
    artifactSha256: "a".repeat(64),
  };
  for (const name of [
    "../model.json",
    "C:/model.json",
    "model.pkl",
    "model.joblib",
  ])
    assert.throws(() => modelAsset(manifest, { name, hash: "a".repeat(64) }));
  assert.throws(() =>
    modelAsset(
      { ...manifest, trainCutoffAt: null },
      { name: "model.json", hash: "a".repeat(64) },
    ),
  );
  assert.throws(() =>
    modelAsset(manifest, { name: "model.json", hash: "b".repeat(64) }),
  );
  assert.throws(() =>
    modelAsset(
      { ...manifest, modelId: "RETROSPECTIVE_fit" },
      { name: "model.json", hash: "a".repeat(64) },
    ),
  );
  assert.equal(
    modelAsset(manifest, { name: "model.json", hash: "a".repeat(64) }).status,
    "BLOCKED",
  );
});
