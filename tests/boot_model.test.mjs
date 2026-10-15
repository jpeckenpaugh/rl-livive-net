/* Unit check for the POST progress mapper (AIA-46 R1). Pure helper, no browser.
 *
 * Run: node --test tests/boot_model.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { postLineModel } from "../src/boot-model.js";

const LABELS = ["EPROM CHECK", "PYTHON CORE", "NEURAL PILOT", "READY"];

test("nothing completed means the first line is active, the rest pending", () => {
  const model = postLineModel(LABELS, 0);
  assert.deepEqual(model.map((l) => l.state), ["active", "pending", "pending", "pending"]);
  assert.equal(model[0].label, "EPROM CHECK");
});

test("the completed count advances the active line and marks prior lines done", () => {
  assert.deepEqual(postLineModel(LABELS, 2).map((l) => l.state), ["done", "done", "active", "pending"]);
});

test("completion is clamped to the label list", () => {
  assert.deepEqual(postLineModel(LABELS, 99).map((l) => l.state), ["done", "done", "done", "done"]);
  assert.deepEqual(postLineModel(LABELS, -5).map((l) => l.state), ["active", "pending", "pending", "pending"]);
  assert.deepEqual(postLineModel([], 3), []);
});
