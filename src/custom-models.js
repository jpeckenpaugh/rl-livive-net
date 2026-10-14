/* Custom ("Build your own pilot") model support.
 *
 * Users can upload an ONNX pilot from the build overlay; the bytes live only in
 * this browser (IndexedDB), never on a server. This module owns two things:
 *
 *   1. Pure helpers — contract validation, id/slug, the catalog merge, and the
 *      test-flight argmax histogram. No DOM/IndexedDB access, so the helpers run
 *      under plain Node (see tests/custom_models.test.mjs).
 *   2. A thin IndexedDB wrapper for the persisted bytes + metadata.
 *
 * Custom catalog ids are namespaced with the reserved `custom:` prefix so they
 * can never collide with a bundled manifest id.
 */
import { state } from "./state.js";
import { mulberry32 } from "./lib.js";

export const CUSTOM_ID_PREFIX = "custom:";
export const INPUT_NAME = "observation";
export const OUTPUT_NAME = "logits";
export const DB_NAME = "lunar-lander";
export const STORE_NAME = "custom-models";

/* ============================================================================
 * PURE HELPERS
 * ==========================================================================*/

/* Turn a pilot name into a url-safe slug for the reserved id. */
export function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "pilot";
}

/* A collision-free id in the reserved namespace: `custom:<slug>` (then -2, -3…). */
export function customModelId(label, taken = []) {
  const base = `${CUSTOM_ID_PREFIX}${slugify(label)}`;
  const used = new Set(taken);
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}

/* Validate a model's ONNX signature against the pilot contract:
 * observation float32 [batch, 8] -> logits float32 [batch, 4].
 * Shapes are optional; when absent we fall back to the inference probe. */
export function validatePilotContract({ inputNames, outputNames, inputShape, outputShape } = {}) {
  if (!Array.isArray(inputNames) || !inputNames.includes(INPUT_NAME)) {
    return { ok: false, error: `unexpected ONNX input name (expected "${INPUT_NAME}")` };
  }
  if (!Array.isArray(outputNames) || !outputNames.includes(OUTPUT_NAME)) {
    return { ok: false, error: `unexpected ONNX output name (expected "${OUTPUT_NAME}")` };
  }
  if (inputShape && !dimEndsWith(inputShape, 8)) {
    return { ok: false, error: "unexpected ONNX input shape (expected [batch, 8])" };
  }
  if (outputShape && !dimEndsWith(outputShape, 4)) {
    return { ok: false, error: "unexpected ONNX output shape (expected [batch, 4])" };
  }
  return { ok: true, error: "" };
}

function dimEndsWith(shape, size) {
  return Array.isArray(shape) && shape.length >= 1 && Number(shape[shape.length - 1]) === size;
}

/* The cabinet reads raw scores and takes the argmax. */
export function argmax(values, offset = 0) {
  let best = 0;
  for (let i = 1; i < 4; i++) {
    if (values[offset + i] > values[offset + best]) best = i;
  }
  return best;
}

/* Tally the winning action across `count` rows of a flat [count, 4] output. */
export function histogramFromLogits(logits, count) {
  const counts = [0, 0, 0, 0];
  for (let row = 0; row < count; row++) counts[argmax(logits, row * 4)]++;
  return counts;
}

/* A usable output row is four finite scores. */
export function hasFourFiniteOutputs(values) {
  if (!values || values.length < 4) return false;
  for (let i = 0; i < 4; i++) {
    if (!Number.isFinite(Number(values[i]))) return false;
  }
  return true;
}

/* Plausible cockpit readings at random, for the test-flight probe. */
const OBS_RANGES = [
  [-1.0, 1.0],   // x
  [0.0, 1.5],    // y
  [-1.0, 1.0],   // vx
  [-1.5, 0.5],   // vy
  [-3.14, 3.14], // angle
  [-2.0, 2.0],   // angular velocity
  [0, 1],        // left leg contact
  [0, 1],        // right leg contact
];

/* Deterministic pseudo-random observations so the test flight is reproducible. */
export function pseudoObservations(count, seed = 1) {
  const rand = mulberry32(seed >>> 0);
  const rows = [];
  for (let i = 0; i < count; i++) {
    const row = new Float32Array(8);
    for (let j = 0; j < 8; j++) {
      const [lo, hi] = OBS_RANGES[j];
      row[j] = lo + (hi - lo) * rand();
    }
    row[6] = row[6] < 0.5 ? 0 : 1;
    row[7] = row[7] < 0.5 ? 0 : 1;
    rows.push(row);
  }
  return rows;
}

export function flattenObservations(rows) {
  const values = new Float32Array(rows.length * 8);
  rows.forEach((row, i) => values.set(row, i * 8));
  return values;
}

/* Normalize an IndexedDB record into a catalog entry the rest of the cabinet
 * already understands (label/role/algorithm). It carries `bytes`, not `url`. */
export function customCatalogEntry(record) {
  return {
    id: String(record.id),
    label: String(record.label || record.id),
    url: "",
    bytes: record.bytes || null,
    author: record.author ? String(record.author) : "",
    algorithm: record.algorithm ? String(record.algorithm) : "",
    role: "custom",
    source: "",
    filename: record.filename ? String(record.filename) : "",
    addedAt: record.addedAt ? String(record.addedAt) : "",
  };
}

/* Merge persisted custom records into the loaded catalog, skipping ids that are
 * already present so boot-time merging is idempotent. Bundled pilots stay first. */
export function mergeCustomModels(catalog, records) {
  const merged = Array.isArray(catalog) ? catalog.slice() : [];
  const seen = new Set(merged.map((m) => m.id));
  for (const record of records || []) {
    if (!record || !record.id || !record.bytes) continue;
    const entry = customCatalogEntry(record);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  return merged;
}

export function removeCustomFromCatalog(catalog, id) {
  return (catalog || []).filter((m) => m.id !== id);
}

/* ============================================================================
 * INDEXEDDB STORE (browser only)
 * ==========================================================================*/

let dbPromise = null;

function openDb() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB is not available in this browser"));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("could not open IndexedDB"));
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

function withStore(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = run(store);
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  }));
}

export function listCustomModels() {
  return withStore("readonly", (store) => store.getAll()).then((rows) => rows || []);
}

export function putCustomModel(record) {
  return withStore("readwrite", (store) => store.put(record));
}

export function deleteCustomModel(id) {
  return withStore("readwrite", (store) => store.delete(id));
}

/* Load persisted models and merge them into the shared catalog at boot. */
export async function loadCustomModels() {
  let records = [];
  try {
    records = await listCustomModels();
  } catch (err) {
    console.warn("custom models unavailable", err);
    return [];
  }
  state.catalog = mergeCustomModels(state.catalog, records);
  return records;
}
