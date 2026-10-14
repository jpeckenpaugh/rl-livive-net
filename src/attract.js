/* Attract demo — the cabinet flying the real physics/AI sim by itself. */
import { STEP_INTERVAL_MS, MAX_CATCH_UP_STEPS, ATTRACT_RESTART_DELAY_MS, ATTRACT_RETRY_DELAY_MS } from "./config.js";
import { state } from "./state.js";
import { $ } from "./lib.js";
import { data } from "./data.js";
import { modelEntry, ensureModelSession, chooseModelActions } from "./models.js";
import { drawScene } from "./render.js";
import { readPythonJson } from "./python.js";
import { isTitleScreen } from "./screens.js";

const attractCanvas = $("attract-canvas");
const attractCtx = attractCanvas ? attractCanvas.getContext("2d") : null;
const attractDemo = {
  running: false, busy: false,
  state: null, prevObservation: null, action: 0, episode: 0,
  accumulator: 0, restartAt: 0, pilotId: "ppo",
};

function attractLanderColor() { return data.pilotColors[0]; }

/* Contenders cycle each episode; the first-party PPO always leads the reel. */
function attractReel() {
  const ids = state.catalog.map((m) => m.id).filter((id) => modelEntry(id));
  const reel = ["ppo", ...ids.filter((id) => id !== "ppo")];
  return reel.filter((id) => modelEntry(id));
}
function attractPilotForEpisode() {
  const reel = attractReel();
  if (!reel.length) return "ppo";
  return reel[attractDemo.episode % reel.length];
}
function updateAttractDemoHud() {
  const el = $("attract-demo-pilot");
  if (!el) return;
  const entry = modelEntry(attractDemo.pilotId);
  const label = entry ? (entry.algorithm || entry.label) : attractDemo.pilotId;
  el.textContent = `ATTRACT MODE · ${label}`;
}
function hideAttractLoading() {
  const el = $("attract-demo-loading");
  if (el) el.hidden = true;
}
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
async function attractStartEpisode(staticOnly = false) {
  if (!state.simReady || attractDemo.busy) return;
  attractDemo.busy = true;
  try {
    attractDemo.pilotId = attractPilotForEpisode();
    attractDemo.episode += 1;
    attractDemo.state = readPythonJson("reset_json()");
    attractDemo.prevObservation = Array.from(attractDemo.state.observation);
    attractDemo.action = 0;
    attractDemo.accumulator = 0;
    attractDemo.restartAt = 0;
    updateAttractDemoHud();
    drawScene(attractCanvas, attractCtx, attractDemo.state, attractDemo.action, attractLanderColor());
    hideAttractLoading();
    // Reduced motion parks one drawn frame instead of flying a live reel.
    if (staticOnly) { attractDemo.running = false; return; }
    // Load the episode's pilot (first-party PPO on the first pass) before it flies.
    await ensureModelSession(attractDemo.pilotId);
    attractDemo.running = true;
  } catch (err) {
    // Attract mode must never surface an error; keep the parked scene and retry later.
    attractDemo.running = false;
    attractDemo.restartAt = performance.now() + ATTRACT_RETRY_DELAY_MS;
    console.warn("attract demo unavailable", err);
  } finally {
    attractDemo.busy = false;
  }
}
export async function attractDemoFrame(elapsedMs) {
  if (!isTitleScreen(state.currentScreenName) || !state.simReady || attractDemo.busy) return;
  if (prefersReducedMotion()) {
    if (attractDemo.state) return;
    await attractStartEpisode(true);
    return;
  }
  if (!attractDemo.running) {
    if (attractDemo.restartAt && performance.now() < attractDemo.restartAt) return;
    await attractStartEpisode();
    return;
  }
  attractDemo.accumulator = Math.min(attractDemo.accumulator + elapsedMs, STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS);
  if (attractDemo.accumulator < STEP_INTERVAL_MS) return;
  attractDemo.busy = true;
  try {
    let steps = 0;
    while (steps < MAX_CATCH_UP_STEPS && attractDemo.running && attractDemo.accumulator >= STEP_INTERVAL_MS) {
      const action = (await chooseModelActions(attractDemo.pilotId, [attractDemo.prevObservation]))[0];
      if (!isTitleScreen(state.currentScreenName)) { attractDemo.running = false; break; }
      const before = Array.from(attractDemo.state.observation);
      attractDemo.action = action;
      const result = readPythonJson(`step_json(${action})`);
      attractDemo.prevObservation = before;
      attractDemo.state = result.state;
      attractDemo.accumulator = Math.max(0, attractDemo.accumulator - STEP_INTERVAL_MS);
      steps += 1;
      if (result.terminated || result.truncated) {
        attractDemo.running = false;
        attractDemo.restartAt = performance.now() + ATTRACT_RESTART_DELAY_MS;
        break;
      }
    }
    drawScene(attractCanvas, attractCtx, attractDemo.state, attractDemo.action, attractLanderColor());
  } catch (err) {
    attractDemo.running = false;
    attractDemo.restartAt = performance.now() + ATTRACT_RETRY_DELAY_MS;
    console.warn("attract demo fault", err);
  } finally {
    attractDemo.busy = false;
  }
}

/* Called by the frame loop while a title screen is showing. */
export function rotateAttractTagline(now) {
  if (state.currentScreenName !== "attract" || now - state.attractTaglineAt <= 3000) return;
  state.attractTaglineAt = now;
  state.attractTaglineIdx = (state.attractTaglineIdx + 1) % data.taglines.attract.length;
  const el = $("attract-tagline"); if (el) el.textContent = data.taglines.attract[state.attractTaglineIdx];
}
/* Called by the cabinet reset / return-to-title buttons. */
export function resetAttractDemo() {
  attractDemo.running = false;
  attractDemo.restartAt = 0;
  state.attractTaglineAt = 0;
}
