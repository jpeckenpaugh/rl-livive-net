/* Unit check for the Policy Inspector's pure decision math.
 *
 * Run: node --test tests/policy.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_LABELS, ACTION_COUNT, softmax4, argmax4, decisionFromLogits,
} from "../src/policy.js";

test("the action space is the four discrete LunarLander actions", () => {
  assert.equal(ACTION_COUNT, 4);
  assert.deepEqual(ACTION_LABELS, ["COAST", "LEFT", "BURN", "RIGHT"]);
});

test("softmax returns a normalized distribution over the four logits", () => {
  const probs = softmax4([1, 2, 3, 4]);
  assert.equal(probs.length, 4);
  assert.equal(Number(probs.reduce((a, b) => a + b, 0).toFixed(9)), 1);
  assert.ok(probs[3] > probs[2] && probs[2] > probs[1] && probs[1] > probs[0]);
});

test("softmax is stable for large and equal logits", () => {
  const flat = softmax4([5, 5, 5, 5]);
  flat.forEach((p) => assert.ok(Math.abs(p - 0.25) < 1e-9));
  const big = softmax4([1000, 1000, -1000, -1000]);
  assert.equal(Number(big.reduce((a, b) => a + b, 0).toFixed(9)), 1);
  assert.ok(Number.isFinite(big[0]) && Number.isFinite(big[3]));
});

test("argmax4 picks the highest logit and resolves ties to the lower index", () => {
  assert.equal(argmax4([0.1, 0.2, 0.9, 0.3]), 2);
  assert.equal(argmax4([0, 0, 0, 0]), 0);
});

test("decisionFromLogits agrees with argmax and the softmax distribution", () => {
  const decision = decisionFromLogits([0.5, -1.2, 3.1, 0.4]);
  assert.equal(decision.action, 2);
  assert.deepEqual(decision.logits, [0.5, -1.2, 3.1, 0.4]);
  assert.equal(decision.probs.length, 4);
  assert.equal(Number(decision.probs.reduce((a, b) => a + b, 0).toFixed(9)), 1);
  assert.ok(decision.probs[2] > 0.5);
  assert.equal(argmax4(decision.probs), 2);
});

test("decisionFromLogits reads a single row out of a flat batch buffer", () => {
  const flat = new Float32Array([9, 9, 9, 9, 0.1, 0.2, 0.3, 0.7]);
  const decision = decisionFromLogits(flat, 4);
  assert.equal(decision.action, 3);
  const expected = [0.1, 0.2, 0.3, 0.7];
  decision.logits.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6));
});
