/* The "Build your own pilot" overlay: a Cabinet Manual-styled document plus a
 * "Test it here" upload panel. An uploaded ONNX model is validated in memory
 * against the pilot contract, test-flown on pseudo-random observations, and can
 * then be added to *this browser's* cabinet (IndexedDB). Nothing is uploaded to
 * a server.
 *
 * Mirrors src/manual.js: `isBuildOpen` / `openBuild` / `closeBuild` / `initBuild`.
 */
import { $, escapeHtml } from "./lib.js";
import { state } from "./state.js";
import { Sound } from "./audio.js";
import { createMemorySession } from "./models.js";
import { renderPlayers } from "./ui.js";
import {
  customModelId, validatePilotContract, histogramFromLogits, hasFourFiniteOutputs,
  pseudoObservations, flattenObservations, mergeCustomModels, removeCustomFromCatalog,
  listCustomModels, putCustomModel, deleteCustomModel,
} from "./custom-models.js";

const SAMPLE_COUNT = 100;
const ACTION_LABELS = ["DO NOTHING", "FIRE LEFT", "FIRE MAIN", "FIRE RIGHT"];

/* The model currently loaded in the panel, plus a browser-only byte copy so the
 * "Add to cabinet" step can persist it without re-reading the file. */
let pending = null;
let installed = [];

export function isBuildOpen() {
  const overlay = $("build-overlay");
  return !!overlay && !overlay.hidden;
}

export function openBuild() {
  const overlay = $("build-overlay");
  if (!overlay || !overlay.hidden) return;
  refreshInstalled();
  overlay.hidden = false;
  Sound.sfx("select");
  const close = $("build-close");
  if (close) close.focus({ preventScroll: true });
}

export function closeBuild() {
  const overlay = $("build-overlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  Sound.sfx("menu");
  const build = $("cabinet-build");
  if (build) build.focus({ preventScroll: true });
}

/* ---------------------------------------------------------------- status UI */
function setStatus(message) {
  const el = $("build-status");
  if (el) { el.textContent = message; el.hidden = !message; }
}
function clearError() {
  const el = $("build-error");
  if (el) { el.textContent = ""; el.hidden = true; }
}
function showError(message) {
  const el = $("build-error");
  if (el) { el.textContent = message; el.hidden = false; }
  setStatus("");
}
function hideResult() {
  const el = $("build-result");
  if (el) el.hidden = true;
}
function showResult() {
  const el = $("build-result");
  if (el) el.hidden = false;
}

/* ----------------------------------------------------------- file handling */
async function handleFile(file) {
  if (!file) return;
  clearError();
  hideResult();
  pending = null;
  if (!/\.onnx$/i.test(file.name)) {
    showError("that is not an .onnx file — export your pilot to ONNX first");
    return;
  }
  setStatus("LOADING THE MODEL INTO THIS BROWSER…");
  let session = null;
  try {
    const bytes = await file.arrayBuffer();
    const keep = bytes.slice(0);
    session = await createMemorySession(bytes);

    const spec = validatePilotContract({
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      inputShape: safeShape(session, "inputMetadata", "observation"),
      outputShape: safeShape(session, "outputMetadata", "logits"),
    });
    if (!spec.ok) {
      session.release();
      showError(spec.error);
      return;
    }

    const ort = globalThis.ort;
    const probe = new ort.Tensor("float32", new Float32Array(8), [1, 8]);
    let probeOut;
    try {
      const res = await session.run({ observation: probe });
      probeOut = res.logits.data;
    } catch (err) {
      session.release();
      showError(`the model failed to run: ${err && err.message ? err.message : err}`);
      return;
    }
    if (!hasFourFiniteOutputs(probeOut)) {
      session.release();
      showError("the model did not return four finite scores");
      return;
    }

    // Test flight: ~100 pseudo-random cockpit readings, tally the argmax.
    setStatus("RUNNING A TEST FLIGHT…");
    const rows = pseudoObservations(SAMPLE_COUNT, 1337);
    const flightInput = new ort.Tensor("float32", flattenObservations(rows), [rows.length, 8]);
    const flight = await session.run({ observation: flightInput });
    const logits = flight.logits.data;
    let finite = logits.length >= rows.length * 4;
    for (let i = 0; finite && i < rows.length * 4; i++) finite = Number.isFinite(Number(logits[i]));
    const counts = histogramFromLogits(logits, rows.length);
    pending = { label: file.name.replace(/\.onnx$/i, ""), filename: file.name, keep, counts, passed: finite };
    renderResult();
    session.release();
    session = null;
    setStatus(finite ? "PASS — THIS PILOT CAN FLY HERE" : "FAIL — SEE THE STICKY NOTE BELOW");
  } catch (err) {
    if (session) session.release();
    showError(String(err && err.message ? err.message : err));
  }
}

function safeShape(session, key, name) {
  let list;
  try { list = session[key]; } catch (err) { return null; }
  if (!Array.isArray(list)) return null;
  const entry = list.find((m) => m && m.name === name);
  return entry && Array.isArray(entry.shape) ? entry.shape : null;
}

function renderResult() {
  if (!pending) return;
  const banner = $("build-banner");
  if (banner) {
    banner.className = `build-banner ${pending.passed ? "pass" : "fail"}`;
    banner.textContent = pending.passed ? "PASS · READY TO ADD" : "FAIL · NOT USABLE";
  }
  const summary = $("build-summary");
  if (summary) {
    summary.textContent = `${pending.filename} · observation[batch,8] → logits[batch,4] · ${SAMPLE_COUNT} test-flight readings`;
  }
  const hist = $("build-hist");
  if (hist) {
    const total = Math.max(1, pending.counts.reduce((a, b) => a + b, 0));
    hist.innerHTML = pending.counts.map((count, i) => {
      const pct = Math.round((count / total) * 100);
      return `<div class="build-hist-row">
        <span class="build-hist-label">${ACTION_LABELS[i]}</span>
        <span class="build-hist-bar"><i style="width:${pct}%"></i></span>
        <span class="build-hist-count">${count}</span>
      </div>`;
    }).join("") + `<p class="build-hist-note">${
      pending.counts.filter((c) => c > 0).length > 1
        ? "The pilot picks more than one move across the test flight."
        : "The pilot picks a single move for every reading — deterministic, still valid."
    }</p>`;
  }
  const name = $("build-name");
  if (name && !name.value) name.value = pending.label;
  const add = $("build-add");
  if (add) add.disabled = !pending.passed;
  showResult();
}

/* ------------------------------------------------------- cabinet persistence */
async function refreshInstalled() {
  try {
    installed = await listCustomModels();
  } catch (err) {
    console.warn("could not list custom models", err);
    installed = [];
  }
  renderInstalled();
}

function renderInstalled() {
  const el = $("build-installed-list");
  if (!el) return;
  if (!installed.length) {
    el.innerHTML = `<li class="build-installed-empty">No custom pilots installed in this browser yet.</li>`;
    return;
  }
  el.innerHTML = installed.map((m) => `<li class="build-installed-item" data-id="${escapeHtml(m.id)}">
      <span class="build-installed-name">${escapeHtml(m.label)}</span>
      <span class="build-installed-meta">${escapeHtml(m.algorithm || "custom")}${m.author ? " · " + escapeHtml(m.author) : ""}</span>
      <button class="build-remove" type="button" data-remove="${escapeHtml(m.id)}">REMOVE</button>
    </li>`).join("");
}

async function addToCabinet() {
  if (!pending || !pending.passed) return;
  const nameEl = $("build-name");
  const authorEl = $("build-author");
  const algorithmEl = $("build-algorithm");
  const label = ((nameEl && nameEl.value) || "").trim() || pending.label;
  const author = ((authorEl && authorEl.value) || "").trim();
  const algorithm = ((algorithmEl && algorithmEl.value) || "").trim() || "custom";
  const id = customModelId(label, state.catalog.map((m) => m.id));
  const record = {
    id, label, author, algorithm, role: "custom",
    filename: pending.filename, addedAt: new Date().toISOString(), bytes: pending.keep,
  };
  try {
    await putCustomModel(record);
  } catch (err) {
    showError(`could not save to this browser: ${err && err.message ? err.message : err}`);
    return;
  }
  state.catalog = mergeCustomModels(state.catalog, [record]);
  if (state.currentScreenName === "players") renderPlayers();
  await refreshInstalled();
  Sound.sfx("select");
  clearError();
  hideResult();
  setStatus(`ADDED "${label}" TO THIS BROWSER'S CABINET`);
  pending = null;
  if (nameEl) nameEl.value = "";
}

async function removeModel(id) {
  try {
    await deleteCustomModel(id);
  } catch (err) {
    showError(`could not remove the pilot: ${err && err.message ? err.message : err}`);
    return;
  }
  state.catalog = removeCustomFromCatalog(state.catalog, id);
  if (state.currentScreenName === "players") renderPlayers();
  await refreshInstalled();
  Sound.sfx("menu");
}

/* ------------------------------------------------------------------- wiring */
export function initBuild() {
  const button = $("cabinet-build");
  if (button) button.addEventListener("click", () => { Sound.unlock(); openBuild(); });

  const overlay = $("build-overlay");
  if (overlay) overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.classList.contains("manual-dimmer")) closeBuild();
  });

  for (const id of ["build-close", "build-close-foot"]) {
    const btn = $(id);
    if (btn) btn.addEventListener("click", closeBuild);
  }

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !isBuildOpen()) return;
    event.preventDefault();
    closeBuild();
  });

  const drop = $("build-drop");
  const fileInput = $("build-file");
  const browse = $("build-browse");
  if (drop && fileInput) {
    drop.addEventListener("click", (event) => {
      if (event.target.closest("button")) return; // the browse button opens it directly
      fileInput.click();
    });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("dragover");
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
      fileInput.value = "";
    });
  }
  if (browse && fileInput) browse.addEventListener("click", () => fileInput.click());

  const add = $("build-add");
  if (add) add.addEventListener("click", addToCabinet);

  const list = $("build-installed-list");
  if (list) list.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove]");
    if (btn) removeModel(btn.dataset.remove);
  });
}
