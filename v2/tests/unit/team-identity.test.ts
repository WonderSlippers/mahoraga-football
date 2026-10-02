import { test } from "node:test";
import assert from "node:assert/strict";
import { modelTeamName } from "../../packages/sources/team-identity";
test("verified senior country aliases match frozen registry without mapping clubs, women or youth", () => {
  assert.equal(
    modelTeamName("Bosnia-Herzegovina", "uefa.nations"),
    "Bosnia and Herzegovina",
  );
  assert.equal(
    modelTeamName("St. Lucia", "concacaf.nations.league"),
    "Saint Lucia",
  );
  assert.equal(
    modelTeamName("St. Kitts and Nevis", "fifa.friendly"),
    "Saint Kitts and Nevis",
  );
  for (const competition of [
    "fifa.friendly.w",
    "uefa.under21",
    "eng.1",
    "UNKNOWN",
  ])
    assert.equal(
      modelTeamName("Bosnia-Herzegovina", competition),
      "Bosnia-Herzegovina",
    );
  assert.equal(
    modelTeamName("Unknown Republic", "fifa.friendly"),
    "Unknown Republic",
  );
});
