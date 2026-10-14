/* Pilot catalog and ONNX Runtime Web inference. */
import { ONNX_RUNTIME_VERSION } from "./config.js";
import { state } from "./state.js";
import { data } from "./data.js";

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
  state.catalog = entries.filter((m) => m && m.id && m.url).map((m) => ({
    id: String(m.id),
    label: String(m.label || m.id),
    url: new URL(m.url, document.baseURI).href,
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
    await loadOnnxRuntime();
    const ort = globalThis.ort;
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(entry.url, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
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
export async function chooseModelActions(modelId, observations) {
  if (observations.length === 0) return [];
  const session = await ensureModelSession(modelId);
  const ort = globalThis.ort;
  const values = new Float32Array(observations.length * 8);
  observations.forEach((obs, i) => values.set(obs, i * 8));
  const input = new ort.Tensor("float32", values, [observations.length, 8]);
  const result = await session.run({ observation: input });
  const logits = result.logits.data;
  const actions = [];
  for (let row = 0; row < observations.length; row++) {
    let best = 0;
    const off = row * 4;
    for (let i = 1; i < 4; i++) if (logits[off + i] > logits[off + best]) best = i;
    actions.push(best);
  }
  return actions;
}
