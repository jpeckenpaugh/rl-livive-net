/* Pilot catalog and ONNX Runtime Web inference. */
import { ONNX_RUNTIME_VERSION } from "./config.js";
import { state } from "./state.js";
import { data } from "./data.js";
import { argmax4, decisionFromLogits } from "./policy.js";

const modelSessions = new Map();
const modelLoading = new Map();
let onnxRuntimeLoading = null;

export function modelEntry(id) { return state.catalog.find((m) => m.id === id) || null; }
export function modelLabel(id) { const e = modelEntry(id); return e ? e.label : id; }
export function modelRole(id) { const e = modelEntry(id); return e ? (e.algorithm || e.role || "PILOT") : "PILOT"; }

export async function loadCatalog() {
  let manifest = null;
  try {
    const res = await fetch(new URL("models/manifest.json", document.baseURI), { cache: "no-store" });
    if (res.ok) manifest = await res.json();
  } catch (err) { console.warn("manifest unavailable", err); }
  const entries = manifest && Array.isArray(manifest.models) && manifest.models.length ? manifest.models : data.modelFallback;
  // Bundled pilots carry a `url`; custom pilots merged in later carry `bytes`.
  state.catalog = entries.filter((m) => m && m.id && (m.url || m.bytes)).map((m) => ({
    id: String(m.id),
    label: String(m.label || m.id),
    url: m.url ? new URL(m.url, document.baseURI).href : "",
    bytes: m.bytes || null,
    author: m.author ? String(m.author) : "",
    algorithm: m.algorithm ? String(m.algorithm) : "",
    role: m.role ? String(m.role) : "",
    source: m.source ? String(m.source) : (data.modelSources[m.id] || ""),
  }));
}
export async function ensureModelSession(modelId) {
  if (modelSessions.has(modelId)) return modelSessions.get(modelId);
  if (modelLoading.has(modelId)) return modelLoading.get(modelId);
  const entry = modelEntry(modelId);
  if (!entry) throw new Error(`Unknown AI model: ${modelId}`);
  const loading = (async () => {
    const session = await createSession(entry.bytes || entry.url);
    if (!session.inputNames.includes("observation") || !session.outputNames.includes("logits")) {
      session.release();
      throw new Error(`${entry.label}: unexpected ONNX input or output name`);
    }
    modelSessions.set(modelId, session);
    return session;
  })().finally(() => { modelLoading.delete(modelId); });
  modelLoading.set(modelId, loading);
  return loading;
}
/* Create an ONNX session from bytes or a URL, with the cabinet's runtime
 * settings. Used for bundled pilots (url) and in-memory custom pilots (bytes). */
async function createSession(source) {
  await loadOnnxRuntime();
  const ort = globalThis.ort;
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(source, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

/* Validate an uploaded ONNX model in memory. Mirrors ensureModelSession's
 * input/output name check and error message; the caller does shape checks. */
export async function createMemorySession(bytes) {
  const session = await createSession(bytes);
  if (!session.inputNames.includes("observation") || !session.outputNames.includes("logits")) {
    session.release();
    throw new Error("unexpected ONNX input or output name");
  }
  return session;
}

export function loadOnnxRuntime() {
  if (globalThis.ort) return Promise.resolve(globalThis.ort);
  if (onnxRuntimeLoading) return onnxRuntimeLoading;
  onnxRuntimeLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/ort.min.js`;
    script.async = true;
    script.onload = () => globalThis.ort ? resolve(globalThis.ort) : reject(new Error("ONNX Runtime Web missing browser API"));
    script.onerror = () => reject(new Error("Could not load ONNX Runtime Web"));
    document.head.appendChild(script);
  }).catch((err) => { onnxRuntimeLoading = null; throw err; });
  return onnxRuntimeLoading;
}
/* Run the actor network and return the raw action logits for each observation
 * row. Shared by the action-choosing helpers and the Policy Inspector. */
async function runPolicyLogits(modelId, observations) {
  const session = await ensureModelSession(modelId);
  const ort = globalThis.ort;
  const values = new Float32Array(observations.length * 8);
  observations.forEach((obs, i) => values.set(obs, i * 8));
  const input = new ort.Tensor("float32", values, [observations.length, 8]);
  const result = await session.run({ observation: input });
  return result.logits.data;
}

export async function chooseModelActions(modelId, observations) {
  if (observations.length === 0) return [];
  const logits = await runPolicyLogits(modelId, observations);
  const actions = [];
  for (let row = 0; row < observations.length; row++) {
    actions.push(argmax4(logits, row * 4));
  }
  return actions;
}

/* Single-observation decision with the full logit row and softmax action
 * distribution, for the Policy Inspector. */
export async function chooseModelDecision(modelId, observation) {
  const logits = await runPolicyLogits(modelId, [observation]);
  return decisionFromLogits(logits, 0);
}
