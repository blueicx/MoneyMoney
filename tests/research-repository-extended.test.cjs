
const test = require("node:test");
const assert = require("node:assert/strict");
const { researchRepository, setDbPath } = require("../dist/features/research-repository.js");
const fs = require("fs");
const path = require("path");

test("extended research repository tests", () => {
  const dbPath = path.join(__dirname, "../data/test_extended.db");
  setDbPath(dbPath);

  const snapshot = { id: "snap1", context: { market: "stocks", workspace: "w" }, fromTime: "a", toTime: "b", hash: "hash1" };
  researchRepository.saveDataSnapshot(snapshot);
  const loadedSnap = researchRepository.getDataSnapshot("snap1");
  assert.equal(loadedSnap.hash, "hash1");

  const bundle = { id: "bundle1", context: { market: "stocks", workspace: "w" }, artifacts: ["a.md"], createdAt: "now" };
  researchRepository.saveEvidenceBundle(bundle);
  assert.equal(researchRepository.getEvidenceBundle("bundle1").artifacts[0], "a.md");

  const lineage = { id: "lin1", context: { market: "stocks", workspace: "w" }, sourceId: "s1", derivedId: "d1", operation: "test" };
  researchRepository.saveLineageRef(lineage);
  assert.equal(researchRepository.getLineageRef("lin1").operation, "test");

  const delivery = { id: "del1", context: { market: "stocks", workspace: "w" }, alertId: "a1", status: "sent" };
  researchRepository.saveAlertDelivery(delivery);
  assert.equal(researchRepository.getAlertDelivery("del1").status, "sent");

  researchRepository.close(); if (fs.existsSync(dbPath)) { setTimeout(() => fs.unlinkSync(dbPath), 100); }
});

