const PYODIDE_VERSION = "0.23.4";
const ONNX_RUNTIME_VERSION = "1.19.2";
const FPS = 50;
const STEP_INTERVAL_MS = 1000 / FPS;
const MAX_CATCH_UP_STEPS = 4;
const MAX_FRAME_ELAPSED_MS = 100;
const AUTO_RESET_DELAY_SECONDS = 2;
const ROUND_BREAK_SECONDS = 2.6;
const TOURNAMENT_BASE_SEED = 20261014;
const SCALE = 30;
const VIEWPORT_HALF_H = 400 / SCALE / 2;
const PANELS = 4;
const SCREEN_NAMES = ["title", "play", "tournament", "options"];
const $ = (id) => document.getElementById(id);
const canvas = $("screen");
const ctx = canvas.getContext("2d");
let pyodide;
let running = false;
let busy = false;
let episode = 0;
let totalReward = 0;
let state = null;
let action = 0;
let appliedAction = 0;
let controllerMode = null;
let controllerRequest = 0;
const MODEL_FALLBACK = [
  { id: "ppo", label: "PPO (Author)", url: "models/ppo-LunarLander-v2.onnx" },
];
let modelCatalog = [];
let activeModelId = null;
const modelSessions = new Map();
const modelLoading = new Map();
let onnxRuntimeLoading = null;
let simulationSpeed = 1;
let autoResetRemaining = null;
let lastFrameTime = 0;
let stepAccumulator = 0;
let resetRequested = false;
const sensorHistory = [];
const pressed = new Set();
const multiSimulations = [];
let tournament = null;

function currentScreen() {
  return SCREEN_NAMES.find((name) => !$(`screen-${name}`).hidden) || "title";
}

function showScreen(name) {
  if (!SCREEN_NAMES.includes(name)) name = "title";
  for (const candidate of SCREEN_NAMES) $(`screen-${candidate}`).hidden = candidate !== name;
  if (name !== "play" && name !== "tournament") {
    running = false;
    stepAccumulator = 0;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function status(message) {
  const target = $("status");
  if (target) target.textContent = message;
  const boot = $("boot-status");
  if (boot) boot.textContent = message;
}
function reportFaultEvent(message) {
  const feedback = $("fault-feedback");
  if (!feedback) return;
  feedback.textContent = `LAST FAULT EVENT · ${message}`;
  feedback.classList.add("fault-active");
}
function clearFaultEvent() {
  const feedback = $("fault-feedback");
  if (!feedback) return;
  feedback.textContent = "LAST FAULT EVENT · NONE";
  feedback.classList.remove("fault-active");
}
function sensorFaultChance() {
  const select = $("sensor-fault");
  return select ? Number(select.value) / 100 : 0;
}
function thrusterFaultChance() {
  const select = $("thruster-fault");
  return select ? Number(select.value) / 100 : 0;
}
function staleSensorObservation(observation, simulationIndex) {
  const chance = sensorFaultChance();
  if (chance > 0 && Math.random() < chance) {
    reportFaultEvent(`SIM ${simulationIndex + 1} · STALE SENSOR SAMPLE`);
    return sensorHistory[simulationIndex] || observation;
  }
  return observation;
}
function applyThrusterFault(requestedAction, simulationIndex) {
  const chance = thrusterFaultChance();
  if (chance === 0 || Math.random() >= chance) return requestedAction;
  if (requestedAction !== 0) {
    const names = ["COAST", "LEFT THRUSTER", "MAIN ENGINE", "RIGHT THRUSTER"];
    reportFaultEvent(`SIM ${simulationIndex + 1} · ${names[requestedAction]} FAILED`);
    return 0;
  }
  const misfireAction = 1 + Math.floor(Math.random() * 3);
  const names = ["", "LEFT THRUSTER", "MAIN ENGINE", "RIGHT THRUSTER"];
  reportFaultEvent(`SIM ${simulationIndex + 1} · UNCOMMANDED ${names[misfireAction]}`);
  return misfireAction;
}
function overlay(message, error = false, loading = false) {
  const panel = $("overlay");
  panel.classList.remove("hidden", "error", "loading");
  if (error) panel.classList.add("error");
  if (loading) panel.classList.add("loading");
  $("message").textContent = message;
}
function hideOverlay() { $("overlay").classList.add("hidden"); }
function screenPoint(point) { return [point[0] * SCALE, canvas.height - point[1] * SCALE]; }

function drawScene(targetCanvas, targetCtx, scene, currentAction) {
  const w = targetCanvas.width, h = targetCanvas.height;
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.fillStyle = "#101821";
  targetCtx.fillRect(0, 0, w, h);
  targetCtx.fillStyle = "#8293a1";
  for (let i = 0; i < 45; i++) {
    const x = (i * 137 + 29) % w, y = (i * 71 + 19) % 275;
    targetCtx.globalAlpha = .22 + ((i * 17) % 6) / 12;
    targetCtx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  targetCtx.globalAlpha = 1;
  if (!scene) return;

  const terrain = scene.terrain;
  if (terrain.length) {
    targetCtx.beginPath();
    let p = screenPoint(terrain[0][0]);
    targetCtx.moveTo(p[0], p[1]);
    for (const segment of terrain) {
      p = screenPoint(segment[1]);
      targetCtx.lineTo(p[0], p[1]);
    }
    targetCtx.lineTo(w, h); targetCtx.lineTo(0, h); targetCtx.closePath();
    targetCtx.fillStyle = "#1b2530"; targetCtx.fill();
    targetCtx.beginPath();
    p = screenPoint(terrain[0][0]); targetCtx.moveTo(p[0], p[1]);
    for (const segment of terrain) { p = screenPoint(segment[1]); targetCtx.lineTo(p[0], p[1]); }
    targetCtx.strokeStyle = "#697784"; targetCtx.lineWidth = 2; targetCtx.stroke();
  }
  const padLeft = screenPoint([scene.pad[0], scene.pad[1]]);
  const padRight = screenPoint([scene.pad[2], scene.pad[1]]);
  targetCtx.strokeStyle = "#c7f36b"; targetCtx.lineWidth = 3;
  targetCtx.beginPath(); targetCtx.moveTo(...padLeft); targetCtx.lineTo(...padRight); targetCtx.stroke();
  targetCtx.fillStyle = "#c7f36b"; targetCtx.font = "10px monospace";
  targetCtx.fillText("LANDING ZONE", padLeft[0] + 7, padLeft[1] + 19);

  for (const body of scene.bodies) {
    if (body.circle) {
      const c = screenPoint(body.circle.center);
      targetCtx.fillStyle = body.particle ? "#ff9d5c" : "#d3dde3";
      targetCtx.beginPath(); targetCtx.arc(c[0], c[1], Math.max(1, body.circle.radius * SCALE), 0, Math.PI * 2); targetCtx.fill();
      continue;
    }
    if (!body.vertices?.length) continue;
    const points = body.vertices.map(screenPoint);
    if (body.particle) {
      targetCtx.fillStyle = "#ff9d5c"; targetCtx.beginPath(); targetCtx.arc(points[0][0], points[0][1], 2, 0, Math.PI * 2); targetCtx.fill();
      continue;
    }
    targetCtx.fillStyle = "#e4ebef"; targetCtx.strokeStyle = "#aab7c0"; targetCtx.lineWidth = 1.5;
    targetCtx.beginPath(); targetCtx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) targetCtx.lineTo(...points[i]);
    targetCtx.closePath(); targetCtx.fill(); targetCtx.stroke();
  }
  const obs = scene.observation;
  const x = w / 2 + obs[0] * (w / 2), y = h - (obs[1] * (VIEWPORT_HALF_H) + 8.1) * SCALE;
  targetCtx.save(); targetCtx.translate(x, y); targetCtx.rotate(obs[4]);
  if (currentAction === 2) {
    targetCtx.fillStyle = "#ff9d5c"; targetCtx.beginPath(); targetCtx.moveTo(-5, 12); targetCtx.lineTo(0, 27 + Math.random() * 7); targetCtx.lineTo(5, 12); targetCtx.fill();
  }
  if (currentAction === 1 || currentAction === 3) {
    const sign = currentAction === 1 ? 1 : -1;
    targetCtx.fillStyle = "#75d8e6"; targetCtx.beginPath(); targetCtx.moveTo(sign * 9, 0); targetCtx.lineTo(sign * (20 + Math.random() * 4), 4); targetCtx.lineTo(sign * 9, 7); targetCtx.fill();
  }
  targetCtx.restore();
}
function draw() { drawScene(canvas, ctx, state, appliedAction); }

/* ---------------------------------------------------------------- panels */
function initializePanels() {
  const board = $("multi-board");
  for (let i = 0; i < PANELS; i++) {
    const card = document.createElement("article");
    card.className = "multi-sim-card";

    const heading = document.createElement("div");
    heading.className = "multi-sim-heading";
    const title = document.createElement("strong");
    title.className = "model-name";
    const place = document.createElement("span");
    place.className = "placement";
    heading.append(title, place);

    const simCanvas = document.createElement("canvas");
    simCanvas.width = 600;
    simCanvas.height = 400;
    simCanvas.setAttribute("aria-label", `Simulation ${i + 1}`);

    const reward = document.createElement("div");
    reward.className = "multi-sim-reward";
    const statusText = document.createElement("span");
    statusText.className = "sim-outcome";
    reward.append(statusText);

    card.append(heading, simCanvas, reward);
    board.append(card);
    const simulation = {
      index: i,
      state: null,
      action: 0,
      reward: 0,
      episode: 0,
      done: false,
      outcome: "FLYING",
      placement: null,
      canvas: simCanvas,
      context: simCanvas.getContext("2d"),
      title,
      place,
      statusText,
      rewardElement: reward,
      modelId: activeModelId,
    };
    multiSimulations.push(simulation);
  }
  drawPanels();
}

const PLACE_LABELS = ["1st", "2nd", "3rd", "4th"];
function placeText(place) { return PLACE_LABELS[place - 1] || `#${place}`; }

function drawPanels() {
  const tournamentMode = controllerMode === "tournament" && tournament;
  for (const simulation of multiSimulations) {
    drawScene(simulation.canvas, simulation.context, simulation.state, simulation.action);
    if (tournamentMode) {
      const st = tournament.stats[simulation.index];
      simulation.title.textContent = modelLabel(simulation.modelId);
      simulation.place.textContent = simulation.placement ? placeText(simulation.placement) : "";
      simulation.place.className = `placement${simulation.placement === 1 ? " gold" : simulation.placement ? " ranked" : ""}`;
      if (simulation.done) {
        const outcome = simulation.outcome;
        simulation.statusText.textContent = `${outcome} · ROUND ${simulation.reward.toFixed(1)} · TOTAL ${(st.reward + simulation.reward).toFixed(1)} pts`;
      } else {
        simulation.statusText.textContent = `FLYING · ROUND ${simulation.reward.toFixed(1)} · TOTAL ${(st.reward + simulation.reward).toFixed(1)} pts`;
      }
      simulation.statusText.classList.toggle("complete", simulation.done);
    }
  }
}

/* --------------------------------------------------------------- screens */
function updateControllerButtons() {
  const choices = [
    ["human-controller", "human"],
    ["policy-controller", "policy"],
    ["override-controller", "override"],
  ];
  for (const [id, mode] of choices) {
    const button = $(id);
    const selected = controllerMode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector(".controller-state");
    stateLabel.textContent = selected ? "ACTIVE" : mode !== "human" && modelSessions.has(activeModelId) ? "READY" : "SELECT";
  }
  const help = $("controller-help");
  help.hidden = controllerMode !== "override";
  help.textContent = "AI flies by default. Hold ←/→ to rotate or ↑ to fire the engine; release to return control to AI.";
}

function controllerButton(mode) {
  const ids = { human: "human-controller", policy: "policy-controller", override: "override-controller" };
  return $(ids[mode]);
}

/* ---------------------------------------------------------------- models */
async function loadModelCatalog() {
  let manifest = null;
  try {
    const response = await fetch(new URL("./models/manifest.json", import.meta.url), { cache: "no-store" });
    if (response.ok) manifest = await response.json();
  } catch (error) {
    console.warn("Model manifest unavailable; falling back to the bundled policy.", error);
  }
  const entries = manifest && Array.isArray(manifest.models) && manifest.models.length
    ? manifest.models
    : MODEL_FALLBACK;
  modelCatalog = entries
    .filter((model) => model && model.id && model.url)
    .map((model) => ({
      id: String(model.id),
      label: String(model.label || model.id),
      url: new URL(model.url, import.meta.url).href,
    }));
  activeModelId = modelCatalog.length ? modelCatalog[0].id : null;
}

function modelEntry(modelId) {
  return modelCatalog.find((model) => model.id === modelId) || null;
}
function modelLabel(modelId) {
  const entry = modelEntry(modelId);
  return entry ? entry.label : modelId;
}

function populateModelSelectors() {
  if (modelCatalog.length === 0) return;
  const options = modelCatalog.map((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    return option;
  });
  const single = $("model-select");
  if (single) {
    single.replaceChildren(...options.map((option) => option.cloneNode(true)));
    single.value = activeModelId;
  }
  const singleField = $("model-select-field");
  if (singleField) singleField.hidden = modelCatalog.length < 2;

  const slots = [...document.querySelectorAll(".tourn-model")];
  slots.forEach((select, index) => {
    select.replaceChildren(...options.map((option) => option.cloneNode(true)));
    select.value = modelCatalog[index % modelCatalog.length].id;
  });
}

async function ensureModelSession(modelId) {
  if (modelSessions.has(modelId)) return modelSessions.get(modelId);
  if (modelLoading.has(modelId)) return modelLoading.get(modelId);
  const entry = modelEntry(modelId);
  if (!entry) throw new Error(`Unknown AI model: ${modelId}`);
  const loading = (async () => {
    await loadOnnxRuntime();
    const ort = globalThis.ort;
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(entry.url, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    if (!session.inputNames.includes("observation") || !session.outputNames.includes("logits")) {
      session.release();
      throw new Error(`${entry.label}: unexpected ONNX input or output name`);
    }
    modelSessions.set(modelId, session);
    return session;
  })().finally(() => {
    modelLoading.delete(modelId);
  });
  modelLoading.set(modelId, loading);
  return loading;
}

function loadOnnxRuntime() {
  if (globalThis.ort) return Promise.resolve(globalThis.ort);
  if (onnxRuntimeLoading) return onnxRuntimeLoading;
  onnxRuntimeLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/ort.min.js`;
    script.async = true;
    script.onload = () => globalThis.ort
      ? resolve(globalThis.ort)
      : reject(new Error("ONNX Runtime Web loaded without its browser API"));
    script.onerror = () => reject(new Error("Could not load ONNX Runtime Web from jsDelivr"));
    document.head.appendChild(script);
  }).catch((error) => {
    onnxRuntimeLoading = null;
    throw error;
  });
  return onnxRuntimeLoading;
}

async function chooseModelActions(modelId, observations, simulationIndices, applyFaults = true) {
  if (observations.length === 0) return [];
  const session = await ensureModelSession(modelId);
  const ort = globalThis.ort;
  const values = new Float32Array(observations.length * 8);
  observations.forEach((observation, index) => {
    const simulationIndex = simulationIndices[index];
    const sample = applyFaults ? staleSensorObservation(observation, simulationIndex) : observation;
    values.set(sample, index * 8);
  });
  const input = new ort.Tensor("float32", values, [observations.length, 8]);
  const result = await session.run({ observation: input });
  const logits = result.logits.data;
  const actions = [];
  for (let row = 0; row < observations.length; row++) {
    let best = 0;
    const offset = row * 4;
    for (let i = 1; i < 4; i++) if (logits[offset + i] > logits[offset + best]) best = i;
    actions.push(best);
  }
  return actions;
}
async function choosePolicyAction(observation, simulationIndex = 0) {
  return (await chooseModelActions(activeModelId, [observation], [simulationIndex]))[0];
}

/* --------------------------------------------------------------- runner */
function readPythonJson(expression) {
  return JSON.parse(pyodide.runPython(expression));
}

async function chooseController(mode) {
  const request = ++controllerRequest;
  if (mode !== "human") {
    const button = controllerButton(mode);
    const stateLabel = button.querySelector(".controller-state");
    button.disabled = true;
    stateLabel.textContent = "LOADING";
    try {
      await ensureModelSession(activeModelId);
    } catch (error) {
      button.disabled = false;
      if (request === controllerRequest) {
        stateLabel.textContent = "RETRY";
        status("POLICY LOAD ERROR");
      } else {
        stateLabel.textContent = modelSessions.has(activeModelId) ? "READY" : "SELECT";
      }
      console.error(error);
      return;
    }
    button.disabled = false;
    if (request !== controllerRequest) {
      stateLabel.textContent = "READY";
      return;
    }
  }
  const previousMode = controllerMode;
  const wasAutoResetting = autoResetRemaining !== null;
  if (mode !== previousMode) autoResetRemaining = null;
  while (busy && request === controllerRequest) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (request !== controllerRequest) return;
  controllerMode = mode;
  pressed.clear();
  updateAction();
  updateControllerButtons();
  setDisplayMode(false);
  if (previousMode === "tournament") tournament = null;
  if (wasAutoResetting && mode !== previousMode && pyodide && state) {
    await resetEpisode();
    return;
  }
  if (episode === 0 && state && !running) await resetEpisode();
}

function setDisplayMode(multi) {
  $("screen-wrap").hidden = multi;
  $("telemetry").hidden = multi;
  $("controls-hint").hidden = multi;
  $("multi-board").hidden = !multi;
  $("reset").innerHTML = multi ? 'RESET ALL <span>↻</span>' : 'RESET <span>↻</span>';
  if (!multi) $("multi-error").hidden = true;
}

function updateTelemetry() {
  if (!state) return;
  const obs = state.observation;
  $("altitude").textContent = Math.max(0, obs[1] * 100).toFixed(1);
  $("hspeed").textContent = obs[2].toFixed(2);
  $("vspeed").textContent = obs[3].toFixed(2);
  $("reward").textContent = totalReward.toFixed(1);
}

async function resetEpisode() {
  if (!pyodide || busy) return;
  if (!controllerMode) {
    status("SELECT A PILOT TO START");
    return;
  }
  if (controllerMode === "tournament") return;
  busy = true; running = false;
  autoResetRemaining = null;
  try {
    state = readPythonJson("reset_json()");
    action = 0;
    appliedAction = 0;
    sensorHistory[0] = Array.from(state.observation);
    clearFaultEvent();
    stepAccumulator = 0;
    totalReward = 0; episode++;
    $("episode").textContent = `EPISODE ${String(episode).padStart(2, "0")}`;
    updateTelemetry(); draw(); status("READY · ENVIRONMENT RUNNING"); hideOverlay();
    $("reset").disabled = false; running = true;
  } catch (error) { showError(error); }
  finally { busy = false; }
}
function requestReset() {
  if (busy) {
    resetRequested = true;
    running = false;
    return;
  }
  resetEpisode();
}

/* ------------------------------------------------------------ tournament */
function newTournament(competitors, rounds) {
  return {
    competitors,
    totalRounds: rounds,
    round: 0,
    running: false,
    phase: "idle",
    pause: 0,
    stats: competitors.map((modelId) => ({
      modelId, reward: 0, lands: 0, wins: 0, episodes: 0, placements: [],
    })),
  };
}

async function resetTournamentEnvs(seed) {
  busy = true;
  try {
    const scenes = readPythonJson(`reset_many_seeded_json(${seed})`);
    for (let i = 0; i < multiSimulations.length; i++) {
      const simulation = multiSimulations[i];
      simulation.state = scenes[i];
      sensorHistory[i] = Array.from(scenes[i].observation);
      simulation.reward = 0;
      simulation.action = 0;
      simulation.done = false;
      simulation.outcome = "FLYING";
      simulation.placement = null;
    }
    stepAccumulator = 0;
    clearFaultEvent();
  } finally { busy = false; }
}

async function startTournament() {
  if (!pyodide) { status("RUNTIME STILL LOADING"); return; }
  const slots = [...document.querySelectorAll(".tourn-model")];
  const competitors = slots.map((select) => select.value);
  const rounds = Number($("tournament-rounds").value) || 10;
  tournament = newTournament(competitors, rounds);
  controllerMode = "tournament";
  for (let i = 0; i < multiSimulations.length; i++) multiSimulations[i].modelId = competitors[i];

  status("LOADING TOURNAMENT PILOTS");
  overlay("Loading tournament pilots…", false, true);
  try {
    await Promise.all(competitors.map((modelId) => ensureModelSession(modelId)));
  } catch (error) { showError(error); return; }

  $("tournament-setup").hidden = true;
  $("tournament-results").hidden = true;
  $("tournament-again").hidden = true;
  $("tournament-status").hidden = false;
  $("tournament-standings").hidden = false;
  setDisplayMode(true);
  populateStandings();
  hideOverlay();
  await beginTournamentRound();
}

async function beginTournamentRound() {
  tournament.round += 1;
  $("tourn-round-num").textContent = tournament.round;
  $("tourn-rounds-total").textContent = tournament.totalRounds;
  $("tourn-phase").textContent = `SEEDED #${TOURNAMENT_BASE_SEED + tournament.round} · IDENTICAL FOR ALL PILOTS`;
  await resetTournamentEnvs(TOURNAMENT_BASE_SEED + tournament.round);
  tournament.phase = "running";
  tournament.pause = 0;
  running = true;
  stepAccumulator = 0;
  status(`TOURNAMENT · ROUND ${tournament.round} OF ${tournament.totalRounds}`);
  drawPanels();
  populateStandings();
}

function tournamentRoundComplete() {
  return multiSimulations.every((simulation) => simulation.done);
}

async function advanceTournamentStep() {
  const activeSimulations = multiSimulations.filter((simulation) => !simulation.done);
  if (activeSimulations.length === 0) return;
  const actions = multiSimulations.map(() => 0);
  const groups = new Map();
  for (const simulation of activeSimulations) {
    const group = groups.get(simulation.modelId) || [];
    group.push(simulation);
    groups.set(simulation.modelId, group);
  }
  for (const [modelId, simulations] of groups) {
    const observations = simulations.map((simulation) => simulation.state.observation);
    const chosen = await chooseModelActions(modelId, observations, simulations.map((s) => s.index), false);
    simulations.forEach((simulation, index) => {
      simulation.action = chosen[index];
      actions[simulation.index] = chosen[index];
    });
  }
  const activeMask = multiSimulations.map((simulation) => !simulation.done);
  pyodide.globals.set("_multi_step_payload", JSON.stringify({ actions, active: activeMask }));
  let results;
  try {
    results = readPythonJson("step_many_json(_multi_step_payload)");
  } finally {
    pyodide.globals.delete("_multi_step_payload");
  }
  for (let i = 0; i < multiSimulations.length; i++) {
    const simulation = multiSimulations[i];
    const result = results[i];
    if (!result) continue;
    simulation.state = result.state;
    simulation.reward += result.reward;
    if (result.terminated || result.truncated) {
      simulation.done = true;
      if (result.truncated) simulation.outcome = "TIME LIMIT";
      else simulation.outcome = result.reward > 0 ? "LANDED" : "CRASHED";
    }
  }
}

function completeTournamentRound() {
  const ranked = [...multiSimulations].sort((a, b) => b.reward - a.reward);
  let lastReward = null;
  let lastRank = 0;
  ranked.forEach((simulation, index) => {
    const rank = lastReward !== null && simulation.reward === lastReward ? lastRank : index + 1;
    lastReward = simulation.reward;
    lastRank = rank;
    simulation.placement = rank;
    const stats = tournament.stats[simulation.index];
    stats.reward += simulation.reward;
    stats.episodes += 1;
    stats.placements.push(rank);
    if (simulation.outcome === "LANDED") stats.lands += 1;
    if (rank === 1) stats.wins += 1;
  });
  drawPanels();
  populateStandings();
  if (tournament.round >= tournament.totalRounds) {
    tournament.phase = "done";
    finishTournament();
  } else {
    tournament.phase = "roundComplete";
    tournament.pause = ROUND_BREAK_SECONDS;
    running = false;
    status(`ROUND ${tournament.round} COMPLETE · NEXT ROUND SOON`);
  }
}

async function tournamentNextRound() {
  if (!tournament || tournament.phase !== "roundComplete") return;
  await beginTournamentRound();
}

function standingsRows() {
  return tournament.stats.map((stats) => {
    const medals = stats.placements.filter((place) => place <= 3).length;
    return { ...stats, medals };
  });
}

function populateStandings() {
  if (!tournament) return;
  const rows = standingsRows().slice().sort((a, b) => b.reward - a.reward || b.wins - a.wins || b.lands - a.lands);
  $("tournament-standings").innerHTML = rows.map((stats, index) => `
    <div class="stand-row">
      <span class="stand-rank">${index + 1}</span>
      <span class="stand-name">${escapeHtml(modelLabel(stats.modelId))}</span>
      <span class="stand-stat"><b>${stats.reward.toFixed(0)}</b> pts</span>
      <span class="stand-stat"><b>${stats.wins}</b> wins</span>
      <span class="stand-stat"><b>${stats.lands}</b> lands</span>
    </div>`).join("");
}

function finishTournament() {
  running = false;
  $("tournament-status").hidden = true;
  const rows = standingsRows().slice().sort((a, b) => b.reward - a.reward || b.wins - a.wins || b.lands - a.lands);
  const top = (key) => rows.slice().sort((a, b) => b[key] - a[key])[0];
  const bestScore = top("reward");
  const bestWins = top("wins");
  const bestLands = top("lands");
  const label = (entry) => escapeHtml(modelLabel(entry.modelId));
  $("tournament-results").innerHTML = `
    <h2 class="results-title">TOURNAMENT COMPLETE</h2>
    <p class="results-sub">${tournament.totalRounds} seeded rounds · 4 pilots · identical episodes</p>
    <div class="result-cards">
      <div class="result-card"><span class="result-tag">HIGHEST SCORE</span><b>${label(bestScore)}</b><small>${bestScore.reward.toFixed(0)} pts cumulative</small></div>
      <div class="result-card"><span class="result-tag">MOST WINS</span><b>${label(bestWins)}</b><small>${bestWins.wins} round wins</small></div>
      <div class="result-card"><span class="result-tag">MOST LANDS</span><b>${label(bestLands)}</b><small>${bestLands.lands} successful landings</small></div>
    </div>
    <table class="results-table">
      <thead><tr><th>#</th><th>Pilot</th><th>Total</th><th>Wins</th><th>Lands</th><th>Rounds (place)</th></tr></thead>
      <tbody>${rows.map((stats, index) => `
        <tr><td>${index + 1}</td><td>${label(stats)}</td><td>${stats.reward.toFixed(0)}</td><td>${stats.wins}</td><td>${stats.lands}</td>
        <td class="place-cells">${stats.placements.map((place) => `<i class="p${place}">${place}</i>`).join("")}</td></tr>`).join("")}
      </tbody>
    </table>`;
  $("tournament-results").hidden = false;
  $("tournament-again").hidden = false;
  status("TOURNAMENT COMPLETE");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

/* --------------------------------------------------------------- errors */
function showError(error) {
  running = false; busy = false; status("RUNTIME ERROR");
  const message = String(error?.message || error).split("\n").slice(-5).join(" ");
  if (controllerMode === "tournament") {
    $("multi-error").textContent = message;
    $("multi-error").hidden = false;
  } else {
    overlay(message, true);
  }
  console.error(error);
}

/* ---------------------------------------------------------------- frame */
async function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = lastFrameTime === 0 ? 0 : Math.min(now - lastFrameTime, MAX_FRAME_ELAPSED_MS);
  lastFrameTime = now;
  const scaledElapsedSeconds = elapsed * simulationSpeed / 1000;

  if (controllerMode === "tournament" && tournament) {
    if (tournament.phase === "roundComplete") {
      tournament.pause -= scaledElapsedSeconds;
      if (tournament.pause <= 0) {
        try { await tournamentNextRound(); } catch (error) { showError(error); }
      }
      return;
    }
    if (!running) { stepAccumulator = 0; return; }
    stepAccumulator = Math.min(
      stepAccumulator + elapsed * simulationSpeed,
      STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS,
    );
    if (busy) return;
    if (stepAccumulator < STEP_INTERVAL_MS) return;
    busy = true;
    try {
      let stepsRun = 0;
      while (stepsRun < MAX_CATCH_UP_STEPS && running && stepAccumulator >= STEP_INTERVAL_MS) {
        await advanceTournamentStep();
        stepAccumulator = Math.max(0, stepAccumulator - STEP_INTERVAL_MS);
        stepsRun++;
        if (tournamentRoundComplete()) break;
      }
      drawPanels();
      if (tournamentRoundComplete()) completeTournamentRound();
    } catch (error) { showError(error); }
    finally { busy = false; }
    return;
  }

  if (controllerMode === "policy" && autoResetRemaining !== null) {
    autoResetRemaining -= scaledElapsedSeconds;
    if (autoResetRemaining <= 0) {
      autoResetRemaining = null;
      await resetEpisode();
      return;
    }
    const seconds = autoResetRemaining.toFixed(1);
    status(`NEXT AI FLIGHT IN ${seconds}s`);
    $("message").textContent = `Episode ended · ${totalReward.toFixed(1)} points · next flight in ${seconds}s`;
  }
  if (!running) {
    stepAccumulator = 0;
    return;
  }
  stepAccumulator = Math.min(
    stepAccumulator + elapsed * simulationSpeed,
    STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS,
  );
  if (busy) return;
  if (stepAccumulator < STEP_INTERVAL_MS) return;
  busy = true;
  let terminalResult = null;
  try {
    let stepsRun = 0;
    while (stepsRun < MAX_CATCH_UP_STEPS && running && stepAccumulator >= STEP_INTERVAL_MS) {
      if (controllerMode === "override") {
        const aiAction = await choosePolicyAction(state.observation);
        const humanAction = humanOverrideAction();
        action = humanAction === null ? aiAction : humanAction;
      } else if (controllerMode === "policy") {
        action = await choosePolicyAction(state.observation);
      }
      const observationBeforeStep = Array.from(state.observation);
      appliedAction = applyThrusterFault(action, 0);
      const result = readPythonJson(`step_json(${appliedAction})`);
      sensorHistory[0] = observationBeforeStep;
      state = result.state;
      totalReward += result.reward;
      if (result.terminated || result.truncated) {
        running = false;
        terminalResult = result;
      }
      stepAccumulator = Math.max(0, stepAccumulator - STEP_INTERVAL_MS);
      stepsRun++;
    }
    updateTelemetry(); draw();
    if (terminalResult) {
      stepAccumulator = 0;
      if (controllerMode === "policy") {
        autoResetRemaining = AUTO_RESET_DELAY_SECONDS;
        status(`NEXT AI FLIGHT IN ${AUTO_RESET_DELAY_SECONDS.toFixed(1)}s`);
        overlay(`Episode ended · ${totalReward.toFixed(1)} points · next flight in ${AUTO_RESET_DELAY_SECONDS.toFixed(1)}s`);
      } else {
        status(terminalResult.terminated ? "EPISODE COMPLETE" : "TIME LIMIT REACHED");
        overlay(`Episode ended · ${totalReward.toFixed(1)} points · reset to fly again`);
      }
      $("reset").disabled = false;
    }
  } catch (error) { showError(error); }
  finally {
    busy = false;
    if (resetRequested) {
      resetRequested = false;
      resetEpisode();
    }
  }
}

/* ----------------------------------------------------------------- input */
function updateAction() {
  if (pressed.has("ArrowUp")) action = 2;
  else if (pressed.has("ArrowLeft")) action = 1;
  else if (pressed.has("ArrowRight")) action = 3;
  else action = 0;
}
function humanOverrideAction() {
  if (pressed.has("ArrowLeft")) return 1;
  if (pressed.has("ArrowRight")) return 3;
  if (pressed.has("ArrowUp")) return 2;
  return null;
}
window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowDown" && !event.repeat) {
    event.preventDefault();
    requestReset();
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.code)) {
    event.preventDefault();
    if (controllerMode === "human" || controllerMode === "override") {
      pressed.add(event.code); updateAction();
    }
  }
});
window.addEventListener("keyup", (event) => { pressed.delete(event.code); updateAction(); });
window.addEventListener("blur", () => { pressed.clear(); updateAction(); });

$("reset").addEventListener("click", requestReset);
$("human-controller").addEventListener("click", () => chooseController("human"));
$("policy-controller").addEventListener("click", () => chooseController("policy"));
$("override-controller").addEventListener("click", () => chooseController("override"));
$("model-select").addEventListener("change", (event) => {
  activeModelId = event.currentTarget.value;
  updateControllerButtons();
  if (pyodide && controllerMode && controllerMode !== "human") {
    ensureModelSession(activeModelId).catch((error) => showError(error));
  }
});
$("time-scale").addEventListener("change", (event) => {
  simulationSpeed = Number(event.currentTarget.value);
  stepAccumulator = 0;
});
$("home-link").addEventListener("click", (event) => { event.preventDefault(); showScreen("title"); });
for (const button of document.querySelectorAll("[data-screen]")) {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
}
$("tournament-start").addEventListener("click", () => startTournament());
$("tournament-again").addEventListener("click", () => {
  $("tournament-results").hidden = true;
  $("tournament-again").hidden = true;
  $("tournament-status").hidden = true;
  $("tournament-setup").hidden = false;
  tournament = null;
  controllerMode = null;
  running = false;
  populateStandings();
});
updateControllerButtons();

/* ----------------------------------------------------------------- boot */
async function start() {
  try {
    showScreen("title");
    status("LOADING AI MODELS"); overlay("Discovering AI models…", false, true);
    await loadModelCatalog();
    populateModelSelectors();
    updateControllerButtons();
    status("LOADING PYTHON RUNTIME"); overlay("Loading Pyodide…", false, true);
    pyodide = await loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` });
    status("LOADING PYTHON PACKAGES"); overlay("Loading NumPy and the physics engine…", false, true);
    await pyodide.loadPackage(["numpy", "micropip"]);
    const wheelBase = new URL("./third_party/wheels/", window.location.href);
    await installWheel(new URL("pypybox2d-2.1.post331-py3-none-any.whl", wheelBase).href);
    status("LOADING LUNAR LANDER"); overlay("Loading the Lunar Lander environment…", false, true);
    const appWheel = new URL("./packages/lunarlander_gym_shim-0.1.0-py3-none-any.whl", window.location.href);
    await installWheel(appWheel.href);
    await pyodide.runPythonAsync(`
import json
from lunar_lander_local import LunarLander
from pypybox2d import Circle

env = LunarLander(render_mode=None)
multi_envs = [LunarLander(render_mode=None) for _ in range(4)]
def scene_data(target_env, observation):
    bodies = []
    for body in target_env.drawlist + target_env.particles:
        for fixture in body.fixtures:
            shape = fixture.shape
            if isinstance(shape, Circle):
                center = body.transform * shape.position
                bodies.append({"circle": {"center": [center.x, center.y], "radius": shape.radius}, "particle": body in target_env.particles})
            elif hasattr(shape, "vertices"):
                vertices = body.transform
                world_vertices = [vertices * point for point in shape.vertices]
                bodies.append({"vertices": [[p.x, p.y] for p in world_vertices], "particle": False})
    return {"observation": observation.tolist(), "terrain": target_env.sky_polys,
            "pad": [target_env.helipad_x1, target_env.helipad_y, target_env.helipad_x2], "bodies": bodies}
def reset_json():
    observation, _ = env.reset()
    return json.dumps(scene_data(env, observation))
def step_json(action):
    observation, reward, terminated, truncated, _ = env.step(int(action))
    return json.dumps({"state": scene_data(env, observation), "reward": reward,
                       "terminated": terminated, "truncated": truncated})
def reset_many_seeded_json(seed):
    scenes = []
    for sim_env in multi_envs:
        observation, _ = sim_env.reset(seed=int(seed))
        scenes.append(scene_data(sim_env, observation))
    return json.dumps(scenes)
def step_many_json(payload_json):
    payload = json.loads(payload_json)
    actions = payload["actions"]
    active = payload["active"]
    results = []
    for sim_env, action, should_step in zip(multi_envs, actions, active):
        if not should_step:
            results.append(None)
            continue
        observation, reward, terminated, truncated, _ = sim_env.step(int(action))
        results.append({"state": scene_data(sim_env, observation), "reward": reward,
                        "terminated": terminated, "truncated": truncated})
    return json.dumps(results)
`);
    await prepareEnvironment(); requestAnimationFrame(frame);
  } catch (error) { showError(error); }
}
async function prepareEnvironment() {
  busy = true;
  try {
    state = readPythonJson("reset_json()");
    totalReward = 0;
    updateTelemetry(); draw(); hideOverlay();
    status("READY · CHOOSE A MODE");
    $("human-controller").disabled = false;
    $("policy-controller").disabled = false;
    $("override-controller").disabled = false;
    $("tournament-start").disabled = false;
    $("reset").disabled = true;
  } catch (error) { showError(error); }
  finally {
    busy = false;
    if (resetRequested) {
      resetRequested = false;
      resetEpisode();
    }
  }
}
async function installWheel(url) {
  pyodide.globals.set("_wheel_url", url);
  try {
    await pyodide.runPythonAsync("import micropip\nawait micropip.install(_wheel_url, deps=False)");
  } finally {
    pyodide.globals.delete("_wheel_url");
  }
}
initializePanels();
draw(); start();
