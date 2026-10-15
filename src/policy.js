/* Pure actor-decision math for the Policy Inspector.
 *
 * DOM-free and dependency-free so it runs under plain Node
 * (see tests/policy.test.mjs). The browser feeds it the raw logits ONNX
 * Runtime Web already returns; nothing here touches the network or the DOM.
 */

/* Softmax action order matches the discrete LunarLander action space:
 * 0 do nothing, 1 left thruster, 2 main engine, 3 right thruster. */
export const ACTION_LABELS = ["COAST", "LEFT", "BURN", "RIGHT"];
export const ACTION_COUNT = ACTION_LABELS.length;

/* Numerically stable softmax over a 4-value action-logit row. */
export function softmax4(logits, offset = 0) {
  let max = -Infinity;
  for (let i = 0; i < ACTION_COUNT; i++) {
    if (logits[offset + i] > max) max = logits[offset + i];
  }
  const probs = [0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < ACTION_COUNT; i++) {
    const e = Math.exp(logits[offset + i] - max);
    probs[i] = e;
    sum += e;
  }
  for (let i = 0; i < ACTION_COUNT; i++) probs[i] /= sum;
  return probs;
}

/* Index of the largest of the four logits (ties resolve to the lower index). */
export function argmax4(values, offset = 0) {
  let best = 0;
  for (let i = 1; i < ACTION_COUNT; i++) {
    if (values[offset + i] > values[offset + best]) best = i;
  }
  return best;
}

/* Convert a flat logit row into the decision the cabinet displays:
 * the chosen action plus the raw logits and softmax probabilities. */
export function decisionFromLogits(logits, offset = 0) {
  const row = [
    logits[offset], logits[offset + 1], logits[offset + 2], logits[offset + 3],
  ];
  return { action: argmax4(row), logits: row, probs: softmax4(row) };
}
