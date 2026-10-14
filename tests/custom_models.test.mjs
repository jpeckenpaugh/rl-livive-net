/* Unit check for the custom-pilot helpers (see docs/TESTING_AND_DEPLOYMENT.md:
 * smallest check that proves the change, pure helpers only, no browser).
 *
 * Run: node --test tests/custom_models.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CUSTOM_ID_PREFIX, slugify, customModelId, validatePilotContract,
  argmax, histogramFromLogits, hasFourFiniteOutputs, pseudoObservations,
  flattenObservations, customCatalogEntry, mergeCustomModels, removeCustomFromCatalog,
} from "../src/custom-models.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/custom_models.json", import.meta.url), "utf8"));

const bytes = () => new Uint8Array([1, 2, 3, 4]);

test("ids are namespaced under the reserved prefix and never collide", () => {
  assert.equal(slugify("My Fancy Pilot!"), "my-fancy-pilot");
  assert.equal(slugify(""), "pilot");
  const first = customModelId("My Pilot", []);
  assert.equal(first, `${CUSTOM_ID_PREFIX}my-pilot`);
  assert.ok(first.startsWith(CUSTOM_ID_PREFIX));
  const second = customModelId("My Pilot", [first]);
  assert.equal(second, `${CUSTOM_ID_PREFIX}my-pilot-2`);
});

test("contract accepts the pilot signature and rejects wrong names/shapes", () => {
  assert.equal(validatePilotContract(fixture.valid).ok, true);
  const wrongInput = validatePilotContract(fixture.wrongInput);
  assert.equal(wrongInput.ok, false);
  assert.match(wrongInput.error, /input name/);
  const wrongOutput = validatePilotContract(fixture.wrongOutput);
  assert.equal(wrongOutput.ok, false);
  assert.match(wrongOutput.error, /output name/);
  assert.match(validatePilotContract(fixture.wrongInputShape).error, /input shape/);
  assert.match(validatePilotContract(fixture.wrongOutputShape).error, /output shape/);
  // Missing shape metadata is tolerated; the name check still applies.
  assert.equal(validatePilotContract({ inputNames: ["observation"], outputNames: ["logits"] }).ok, true);
});

test("argmax and the test-flight histogram pick the cabinet's action", () => {
  const { logits, count, expected } = fixture.histogram;
  assert.equal(argmax([0.1, 0.2, 0.9, 0.3]), 2);
  assert.equal(argmax([0, 0, 0, 0]), 0);
  assert.deepEqual(histogramFromLogits(logits, count), expected);
});

test("outputs must be four finite scores", () => {
  assert.equal(hasFourFiniteOutputs([1, 2, 3, 4]), true);
  assert.equal(hasFourFiniteOutputs([1, 2, 3]), false);
  assert.equal(hasFourFiniteOutputs([1, 2, 3, NaN]), false);
  assert.equal(hasFourFiniteOutputs([1, 2, 3, Infinity]), false);
});

test("pseudo observations are deterministic 8-value rows", () => {
  const a = pseudoObservations(5, 42);
  const b = pseudoObservations(5, 42);
  assert.equal(a.length, 5);
  assert.equal(a[0].length, 8);
  assert.deepEqual(Array.from(a[0]), Array.from(b[0]));
  assert.deepEqual(Array.from(a[4]), Array.from(b[4]));
  assert.ok(a[0][6] === 0 || a[0][6] === 1);
  const flat = flattenObservations(a);
  assert.equal(flat.length, 40);
});

test("merge is idempotent, keeps bundled pilots first, and skips byte-less records", () => {
  const catalog = [{ id: "ppo", label: "PPO", url: "models/ppo.onnx" }];
  const record = { id: "custom:mine", label: "Mine", algorithm: "PPO", bytes: bytes(), filename: "mine.onnx" };
  const merged = mergeCustomModels(catalog, [record]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "ppo");
  assert.equal(merged[1].id, "custom:mine");
  assert.equal(merged[1].role, "custom");
  assert.equal(merged[1].url, "");
  assert.equal(merged[1].bytes, record.bytes);

  assert.equal(mergeCustomModels(merged, [record]).length, 2, "re-merging must not duplicate");
  assert.equal(mergeCustomModels(catalog, [{ id: "custom:x", label: "no bytes" }]).length, 1);
});

test("custom catalog entries normalize and can be removed", () => {
  const entry = customCatalogEntry({ id: "custom:a", label: "A", bytes: bytes() });
  assert.equal(entry.role, "custom");
  assert.equal(entry.url, "");
  assert.equal(entry.label, "A");
  const remaining = removeCustomFromCatalog([{ id: "ppo" }, { id: "custom:a" }], "custom:a");
  assert.deepEqual(remaining.map((m) => m.id), ["ppo"]);
});
