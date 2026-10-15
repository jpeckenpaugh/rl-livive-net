/* Pure helpers for the boot POST screen. Kept DOM-free so they can be unit
 * tested in Node (see docs/TESTING_AND_DEPLOYMENT.md). */

/* Map a list of POST line labels and a completed count to per-line states.
 * Lines before `completed` are done, the line at `completed` is active, and the
 * rest are pending. `completed` is clamped to [0, labels.length]. */
export function postLineModel(labels, completed) {
  const list = Array.isArray(labels) ? labels : [];
  const done = Math.max(0, Math.min(Number(completed) || 0, list.length));
  return list.map((label, i) => ({
    label: String(label),
    state: i < done ? "done" : i === done ? "active" : "pending",
  }));
}
