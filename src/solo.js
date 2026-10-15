/* Solo Flight: one lander, three controllers (human, policy, override). */
import { STEP_INTERVAL_MS, MAX_CATCH_UP_STEPS } from "./config.js";
import { state } from "./state.js";
import { $, clamp } from "./lib.js";
import { Sound } from "./audio.js";
import { drawScene } from "./render.js";
import { modelLabel, ensureModelSession, chooseModelActions } from "./models.js";
import { readPythonJson } from "./python.js";
import { showScreen } from "./screens.js";
import { recordFlight, cabinetHighScore, renderHighScores } from "./leaderboard.js";
import { pressed } from "./input.js";

export const solo = {
  running: false, busy: false, state: null, action: 0, appliedAction: 0,
  controllerMode: null, request: 0, episode: 0, totalReward: 0,
  prevObservation: null, stepIndex: 0, autoReset: null, speed: 1,
  accumulator: 0, resetRequested: false,
  modelId: null, pendingMode: null,
  session: { flights: 0, bestScore: 0, bestTime: 0 },
};
const soloCanvas = $("solo-canvas");
const soloCtx = soloCanvas ? soloCanvas.getContext("2d") : null;

function soloStatus(msg) { const el = $("solo-status"); if (el) el.textContent = msg; }
function soloOverlay(message, error = false, loading = false) {
  const panel = $("solo-overlay"); if (!panel) return;
  panel.classList.remove("hidden", "error", "loading");
  if (error) panel.classList.add("error");
  if (loading) panel.classList.add("loading");
  const m = $("solo-message"); if (m) m.textContent = message;
}
function soloHideOverlay() { const p = $("solo-overlay"); if (p) p.classList.add("hidden"); }
function updateSoloTelemetry() {
  if (!solo.state) return;
  const obs = solo.state.observation;
  $("altitude").textContent = Math.max(0, obs[1] * 100).toFixed(1);
  $("hspeed").textContent = obs[2].toFixed(2);
  $("vspeed").textContent = obs[3].toFixed(2);
  $("reward").textContent = solo.totalReward.toFixed(1);
  const ft = $("flight-time");
  if (ft) ft.textContent = (solo.stepIndex * STEP_INTERVAL_MS / 1000).toFixed(1);
}
function soloModelId() { return solo.modelId || (state.catalog[0] && state.catalog[0].id) || null; }
function soloModeLabel(mode = solo.controllerMode) {
  if (mode === "human") return "HUMAN PILOT";
  if (mode === "override") return `CO-PILOTING · ${modelLabel(soloModelId()) || "AI"}`;
  if (mode === "policy") return `AI PILOT · ${modelLabel(soloModelId()) || "AI"}`;
  return "SOLO FLIGHT";
}
function updateSoloPilotChip() {
  const chip = $("solo-pilot-chip"); if (chip) chip.textContent = soloModeLabel();
}
function recordSoloSession(score, flightTime) {
  const s = solo.session;
  s.flights += 1;
  if (score > s.bestScore) s.bestScore = score;
  if (flightTime > s.bestTime) s.bestTime = flightTime;
}
function resultStatTiles(terminal, flightTime) {
  const s = solo.session;
  return [
    { label: "THIS FLIGHT", value: Math.round(solo.totalReward), unit: "pts" },
    { label: "FLIGHT TIME", value: flightTime.toFixed(1), unit: "s" },
    { label: "SESSION BEST", value: Math.round(s.bestScore), unit: "pts" },
    { label: "SESSION FLIGHTS", value: s.flights, unit: "" },
    { label: "CABINET HIGH", value: Math.round(cabinetHighScore()), unit: "pts" },
  ];
}
function renderResultStats(terminal, flightTime) {
  const box = $("result-stats"); if (!box) return;
  box.replaceChildren(...resultStatTiles(terminal, flightTime).map((tile) => {
    const el = document.createElement("div");
    el.className = "result-stat";
    const label = document.createElement("span"); label.textContent = tile.label;
    const value = document.createElement("strong"); value.textContent = String(tile.value);
    el.append(label, value);
    if (tile.unit) { const unit = document.createElement("small"); unit.textContent = tile.unit; el.append(unit); }
    return el;
  }));
}
function showSoloResult(terminal, flightTime) {
  const panel = $("solo-result"); if (!panel) return;
  const landed = terminal.terminated && terminal.reward >= 0;
  const outcome = !terminal.terminated ? "TIME'S UP" : (landed ? "TOUCHDOWN" : "CRASHED");
  const outcomeEl = $("result-outcome"); if (outcomeEl) outcomeEl.textContent = outcome;
  const scoreEl = $("result-score");
  if (scoreEl) scoreEl.textContent = `${Math.round(solo.totalReward)} pts · ${flightTime.toFixed(1)}s`;
  renderResultStats(terminal, flightTime);
  const pilotBtn = $("result-change-pilot");
  if (pilotBtn) pilotBtn.hidden = solo.controllerMode === "human";
  soloStatus("FLIGHT OVER");
  panel.hidden = false;
  resultFocusIndex = 0;
  setResultFocus();
  startSoloAutoCountdown();
}
export function hideSoloResult() {
  cancelSoloAutoCountdown();
  const panel = $("solo-result"); if (panel) panel.hidden = true;
}
/* Flight Over auto-advances to the next flight after five seconds. Any move
 * (arrow keys, a click) cancels it. */
let soloAuto = { timer: null, remaining: 0 };
export function cancelSoloAutoCountdown() {
  if (soloAuto.timer) { clearInterval(soloAuto.timer); soloAuto.timer = null; }
}
function updateSoloAutoPrompt() {
  const el = $("solo-result-auto");
  if (el) el.textContent = `NEXT FLIGHT IN ${soloAuto.remaining} · MOVE TO CANCEL`;
}
function startSoloAutoCountdown() {
  cancelSoloAutoCountdown();
  soloAuto.remaining = 5;
  updateSoloAutoPrompt();
  soloAuto.timer = setInterval(() => {
    soloAuto.remaining -= 1;
    if (soloAuto.remaining <= 0) {
      cancelSoloAutoCountdown();
      if (soloResultVisible()) { hideSoloResult(); requestSoloReset(); }
      return;
    }
    updateSoloAutoPrompt();
  }, 1000);
}
export function resultItems() {
  const panel = $("solo-result");
  if (!panel || panel.hidden) return [];
  return Array.from(panel.querySelectorAll("button")).filter((el) => !el.hidden && !el.closest("[hidden]"));
}
let resultFocusIndex = 0;
function setResultFocus() {
  const items = resultItems();
  if (!items.length) return;
  resultFocusIndex = clamp(resultFocusIndex, 0, items.length - 1);
  document.querySelectorAll(".kbd-focus").forEach((el) => el.classList.remove("kbd-focus"));
  const el = items[resultFocusIndex];
  el.classList.add("kbd-focus");
  try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
}
export function moveResultFocus(delta) {
  const items = resultItems();
  if (!items.length) return;
  resultFocusIndex = ((resultFocusIndex + delta) % items.length + items.length) % items.length;
  setResultFocus();
}
export function soloResultVisible() { const p = $("solo-result"); return !!p && !p.hidden; }
export function activateResultFocus() {
  const items = resultItems();
  if (items[resultFocusIndex]) items[resultFocusIndex].click();
}
function humanSoloAction() {
  if (pressed.has("ArrowUp")) return 2;
  if (pressed.has("ArrowLeft")) return 1;
  if (pressed.has("ArrowRight")) return 3;
  return 0;
}
/* Build the Choose Your Pilot grid from the model catalog. The default PPO
 * pilot carries a DEFAULT tag; every card shows its algorithm. */
export function renderPilotCards() {
  const board = $("pilot-cards"); if (!board) return;
  const defaultId = state.catalog[0] && state.catalog[0].id;
  board.replaceChildren(...state.catalog.map((m) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pilot-card";
    card.dataset.model = m.id;
    const name = document.createElement("span");
    name.className = "pilot-card-name";
    name.textContent = m.label;
    const tags = document.createElement("span");
    tags.className = "pilot-card-tags";
    const algo = document.createElement("span");
    algo.className = "pilot-tag";
    algo.textContent = m.algorithm || m.role || "PILOT";
    tags.append(algo);
    if (m.id === defaultId || m.role === "default") {
      const def = document.createElement("span");
      def.className = "pilot-tag default";
      def.textContent = "DEFAULT";
      tags.append(def);
    }
    card.append(name, tags);
    card.addEventListener("click", () => {
      solo.modelId = m.id;
      Sound.sfx("select");
      enterSolo(solo.pendingMode || "policy");
    });
    return card;
  }));
}
export function populateSoloPilots() {
  if (state.catalog.length && !solo.modelId) solo.modelId = state.catalog[0].id;
  renderPilotCards();
}
/* Start Menu → SINGLE PLAYER lands on the solo mode menu. Human Pilot flies
 * at once; the two AI modes ask which pilot first. */
export function openSoloMode(mode) {
  if (mode === "human") { solo.modelId = null; enterSolo("human"); return; }
  solo.pendingMode = mode;
  renderPilotCards();
  showScreen("pilotselect");
}
export async function enterSolo(mode) {
  solo.pendingMode = mode;
  solo.controllerMode = null;
  solo.episode = 0;
  hideSoloResult();
  showScreen("solo");
  updateSoloPilotChip();
  soloStatus(mode === "human" ? "ROLLING OUT THE LANDER" : "LOADING PILOT");
  soloOverlay(mode === "human" ? "ROLLING OUT THE LANDER…" : "LOADING PILOT…", false, true);
  const ok = await chooseController(mode);
  if (ok && solo.controllerMode === mode) await resetSoloEpisode();
}
async function chooseController(mode) {
  const request = ++solo.request;
  if (mode !== "human") {
    try { await ensureModelSession(soloModelId()); }
    catch (err) {
      soloStatus("THIS PILOT WON'T BOOT");
      soloOverlay(String(err && err.message || err).split("\n").slice(-4).join(" "), true);
      console.error(err);
      return false;
    }
    if (request !== solo.request) return false;
  }
  while (solo.busy && request === solo.request) await new Promise((r) => setTimeout(r, 0));
  if (request !== solo.request) return false;
  solo.controllerMode = mode;
  solo.autoReset = null;
  pressed.clear();
  updateSoloPilotChip();
  return true;
}
async function resetSoloEpisode() {
  if (!state.pyodide || solo.busy || !solo.controllerMode) return;
  solo.busy = true; solo.running = false; solo.autoReset = null;
  try {
    solo.state = readPythonJson("reset_json()");
    solo.action = 0; solo.appliedAction = 0;
    solo.prevObservation = Array.from(solo.state.observation);
    solo.stepIndex = 0; solo.accumulator = 0; solo.totalReward = 0; solo.episode += 1;
    updateSoloTelemetry();
    drawScene(soloCanvas, soloCtx, solo.state, solo.appliedAction);
    soloStatus("FLIGHT LIVE"); soloHideOverlay();
    const rb = $("solo-reset"); if (rb) rb.disabled = false;
    solo.running = true;
  } catch (err) { soloFault(err); }
  finally { solo.busy = false; }
}
export function requestSoloReset() {
  hideSoloResult();
  if (solo.busy) { solo.resetRequested = true; solo.running = false; return; }
  resetSoloEpisode();
}
function soloFault(error) {
  solo.running = false; solo.busy = false;
  soloStatus("CABINET FAULT");
  soloOverlay(String(error && error.message || error).split("\n").slice(-4).join(" "), true);
  console.error(error);
}
export async function soloFrame(elapsedMs) {
  if (!solo.running && solo.autoReset === null) { solo.accumulator = 0; return; }
  if (solo.autoReset !== null) {
    solo.autoReset -= (elapsedMs * solo.speed) / 1000;
    if (solo.autoReset <= 0) { solo.autoReset = null; await resetSoloEpisode(); return; }
  }
  if (!solo.running) { solo.accumulator = 0; return; }
  solo.accumulator = Math.min(solo.accumulator + elapsedMs * solo.speed, STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS);
  if (solo.busy || solo.accumulator < STEP_INTERVAL_MS) return;
  solo.busy = true;
  let terminal = null;
  try {
    let steps = 0;
    while (steps < MAX_CATCH_UP_STEPS && solo.running && solo.accumulator >= STEP_INTERVAL_MS) {
      let action = 0;
      if (solo.controllerMode === "human") action = humanSoloAction();
      else if (solo.controllerMode === "policy") action = (await chooseModelActions(soloModelId(), [solo.prevObservation]))[0];
      else if (solo.controllerMode === "override") {
        const ai = (await chooseModelActions(soloModelId(), [solo.prevObservation]))[0];
        const human = (pressed.has("ArrowLeft") ? 1 : pressed.has("ArrowRight") ? 3 : pressed.has("ArrowUp") ? 2 : null);
        action = human === null ? ai : human;
      }
      const before = Array.from(solo.state.observation);
      solo.appliedAction = action;
      const result = readPythonJson(`step_json(${action})`);
      solo.prevObservation = before;
      solo.state = result.state;
      solo.totalReward += result.reward;
      if (action === 2) Sound.sfx("thrust");
      if (result.terminated || result.truncated) { solo.running = false; terminal = result; }
      solo.stepIndex += 1;
      solo.accumulator = Math.max(0, solo.accumulator - STEP_INTERVAL_MS);
      steps++;
    }
    updateSoloTelemetry();
    drawScene(soloCanvas, soloCtx, solo.state, solo.appliedAction);
    if (terminal) {
      solo.accumulator = 0;
      if (terminal.terminated && terminal.reward >= 0) Sound.sfx("land"); else Sound.sfx("crash");
      const flightTime = solo.stepIndex * STEP_INTERVAL_MS / 1000;
      recordFlight(soloModelId(), solo.totalReward);
      renderHighScores();
      recordSoloSession(solo.totalReward, flightTime);
      showSoloResult(terminal, flightTime);
    }
  } catch (err) { soloFault(err); }
  finally {
    solo.busy = false;
    if (solo.resetRequested) { solo.resetRequested = false; resetSoloEpisode(); }
  }
}

/* Called by the screen router when leaving Solo Flight. */
export function stopSolo() {
  if (solo.running) { solo.running = false; solo.autoReset = null; }
}

/* Called once by boot to paint the first parked solo scene. */
export function primeSoloScene() {
  solo.state = readPythonJson("reset_json()");
  solo.totalReward = 0;
  updateSoloTelemetry();
  drawScene(soloCanvas, soloCtx, solo.state, 0);
}

/* Exposed so boot can show a fatal load error on the solo overlay. */
export function soloErrorOverlay(message) {
  soloOverlay(String(message).split("\n").slice(-4).join(" "), true);
}
