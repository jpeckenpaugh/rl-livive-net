const PYODIDE_VERSION = "0.23.4";
const ONNX_RUNTIME_VERSION = "1.19.2";
const POLICY_MODEL_URL = new URL("./models/ppo-LunarLander-v2.onnx", import.meta.url);
const FPS = 50;
const STEP_INTERVAL_MS = 1000 / FPS;
const MAX_CATCH_UP_STEPS = 4;
const MAX_FRAME_ELAPSED_MS = 100;
const AUTO_RESET_DELAY_SECONDS = 2;
const SCALE = 30;
const VIEWPORT_HALF_H = 400 / SCALE / 2;
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
let controllerMode = null;
let controllerRequest = 0;
let policySession = null;
let policyLoading = null;
let onnxRuntimeLoading = null;
let simulationSpeed = 1;
let autoResetRemaining = null;
let lastFrameTime = 0;
let stepAccumulator = 0;
let resetRequested = false;
const pressed = new Set();
const multiSimulations = [];

function status(message) { $("status").textContent = message; }
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

  // Draw the generated terrain from the same world coordinates used by physics.
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
  // Engine flame follows the current input state.
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
function draw() { drawScene(canvas, ctx, state, action); }

function initializeMultiBoard() {
  const board = $("multi-board");
  for (let i = 0; i < 4; i++) {
    const card = document.createElement("article");
    card.className = "multi-sim-card";

    const heading = document.createElement("div");
    heading.className = "multi-sim-heading";
    const title = document.createElement("strong");
    const statusText = document.createElement("span");
    heading.append(title, statusText);

    const simCanvas = document.createElement("canvas");
    simCanvas.width = 600;
    simCanvas.height = 400;
    simCanvas.setAttribute("aria-label", `AI simulation ${i + 1}`);

    const reward = document.createElement("div");
    reward.className = "multi-sim-reward";
    card.append(heading, simCanvas, reward);
    board.append(card);
    multiSimulations.push({
      index: i,
      state: null,
      action: 0,
      reward: 0,
      episode: 0,
      done: false,
      restartRemaining: null,
      canvas: simCanvas,
      context: simCanvas.getContext("2d"),
      title,
      statusText,
      rewardElement: reward,
    });
  }
  drawMulti();
}

function drawMulti() {
  for (const simulation of multiSimulations) {
    drawScene(simulation.canvas, simulation.context, simulation.state, simulation.action);
    simulation.title.textContent = `SIM ${String(simulation.index + 1).padStart(2, "0")} · EPISODE ${String(simulation.episode).padStart(2, "0")}`;
    simulation.statusText.textContent = simulation.done
      ? `RESET IN ${Math.max(0, simulation.restartRemaining || 0).toFixed(1)}s`
      : simulation.state ? "FLYING" : "READY";
    simulation.rewardElement.textContent = `REWARD ${simulation.reward.toFixed(1)} pts`;
    simulation.statusText.classList.toggle("complete", simulation.done);
  }
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

function updateControllerButtons() {
  const choices = [
    ["human-controller", "human"],
    ["policy-controller", "policy"],
    ["override-controller", "override"],
    ["multi-controller", "multi"],
  ];
  for (const [id, mode] of choices) {
    const button = $(id);
    const selected = controllerMode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector(".controller-state");
    stateLabel.textContent = selected ? "ACTIVE" : mode !== "human" && policySession ? "READY" : "SELECT";
  }
  const help = $("controller-help");
  help.hidden = controllerMode !== "override" && controllerMode !== "multi";
  help.textContent = controllerMode === "multi"
    ? "Four independent AI flights run together. Each simulation has its own episode and reward; reset restarts all four."
    : "AI flies by default. Hold ←/→ to rotate or ↑ to fire the engine; release to return control to AI.";
}

function controllerButton(mode) {
  const ids = {
    human: "human-controller",
    policy: "policy-controller",
    override: "override-controller",
    multi: "multi-controller",
  };
  return $(ids[mode]);
}

async function ensurePolicySession() {
  if (policySession) return policySession;
  if (policyLoading) return policyLoading;
  policyLoading = (async () => {
    await loadOnnxRuntime();
    const ort = globalThis.ort;
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(POLICY_MODEL_URL.href, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    if (!session.inputNames.includes("observation") || !session.outputNames.includes("logits")) {
      session.release();
      throw new Error("The ONNX policy has an unexpected input or output name");
    }
    policySession = session;
    return session;
  })().finally(() => {
    policyLoading = null;
  });
  return policyLoading;
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

async function chooseController(mode) {
  const request = ++controllerRequest;
  if (mode !== "human") {
    const button = controllerButton(mode);
    const stateLabel = button.querySelector(".controller-state");
    button.disabled = true;
    stateLabel.textContent = "LOADING";
    try {
      await ensurePolicySession();
    } catch (error) {
      button.disabled = false;
      if (request === controllerRequest) {
        stateLabel.textContent = "RETRY";
        status("POLICY LOAD ERROR");
      } else {
        stateLabel.textContent = policySession ? "READY" : "SELECT";
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
  if (mode === "multi" || previousMode === "multi") {
    running = false;
    stepAccumulator = 0;
  }
  while (busy && request === controllerRequest) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (request !== controllerRequest) return;
  controllerMode = mode;
  pressed.clear();
  updateAction();
  updateControllerButtons();
  setDisplayMode(mode === "multi");
  if (mode === "multi") {
    if (pyodide && state) await resetMultiEpisode();
    return;
  }
  if (previousMode === "multi") {
    running = false;
    stepAccumulator = 0;
    if (pyodide && state) await resetEpisode();
    return;
  }
  if (wasAutoResetting && mode !== previousMode && pyodide && state) {
    await resetEpisode();
    return;
  }
  if (episode === 0 && state && !running) await resetEpisode();
}

async function choosePolicyActions(observations) {
  if (observations.length === 0) return [];
  const ort = globalThis.ort;
  const values = new Float32Array(observations.length * 8);
  observations.forEach((observation, index) => values.set(observation, index * 8));
  const input = new ort.Tensor("float32", values, [observations.length, 8]);
  const result = await policySession.run({ observation: input });
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
async function choosePolicyAction(observation) {
  return (await choosePolicyActions([observation]))[0];
}

function readPythonJson(expression) {
  return JSON.parse(pyodide.runPython(expression));
}
async function resetEpisode() {
  if (!pyodide || busy) return;
  if (!controllerMode) {
    status("SELECT A PILOT TO START");
    return;
  }
  if (controllerMode === "multi") return resetMultiEpisode();
  busy = true; running = false;
  autoResetRemaining = null;
  try {
    state = readPythonJson("reset_json()");
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
async function resetMultiEpisode() {
  if (!pyodide || busy) return;
  busy = true;
  running = false;
  try {
    const scenes = readPythonJson("reset_many_json()");
    for (let i = 0; i < multiSimulations.length; i++) {
      const simulation = multiSimulations[i];
      simulation.state = scenes[i];
      simulation.reward = 0;
      simulation.action = 0;
      simulation.episode++;
      simulation.done = false;
      simulation.restartRemaining = null;
      simulation.outcome = "FLYING";
    }
    stepAccumulator = 0;
    $("episode").textContent = "4 PARALLEL EPISODES";
    status("4 AI SIMULATIONS RUNNING");
    $("multi-error").hidden = true;
    drawMulti();
    hideOverlay();
    $("reset").disabled = false;
    running = true;
  } catch (error) { showError(error); }
  finally {
    busy = false;
    if (resetRequested) {
      resetRequested = false;
      resetEpisode();
    }
  }
}
function showError(error) {
  running = false; busy = false; status("RUNTIME ERROR");
  const message = String(error?.message || error).split("\n").slice(-5).join(" ");
  if (controllerMode === "multi") {
    $("multi-error").textContent = message;
    $("multi-error").hidden = false;
  } else {
    overlay(message, true);
  }
  console.error(error);
}
async function advanceMultiStep() {
  const activeSimulations = multiSimulations.filter((simulation) => !simulation.done);
  if (activeSimulations.length === 0) return;

  const activeActions = await choosePolicyActions(activeSimulations.map((simulation) => simulation.state.observation));
  const actions = multiSimulations.map(() => 0);
  activeSimulations.forEach((simulation, index) => {
    simulation.action = activeActions[index];
    actions[simulation.index] = activeActions[index];
  });
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
      simulation.outcome = result.truncated ? "TIME LIMIT" : "COMPLETE";
      simulation.restartRemaining = AUTO_RESET_DELAY_SECONDS;
    }
  }
}
function resetSelectedMulti(indices) {
  if (indices.length === 0) return;
  pyodide.globals.set("_multi_reset_indices", JSON.stringify(indices));
  let scenes;
  try {
    scenes = readPythonJson("reset_multi_indices_json(_multi_reset_indices)");
  } finally {
    pyodide.globals.delete("_multi_reset_indices");
  }
  for (const { index, state: nextState } of scenes) {
    const simulation = multiSimulations[index];
    simulation.state = nextState;
    simulation.reward = 0;
    simulation.action = 0;
    simulation.episode++;
    simulation.done = false;
    simulation.restartRemaining = null;
    simulation.outcome = "FLYING";
  }
}
async function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = lastFrameTime === 0 ? 0 : Math.min(now - lastFrameTime, MAX_FRAME_ELAPSED_MS);
  lastFrameTime = now;
  const scaledElapsedSeconds = elapsed * simulationSpeed / 1000;
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
  const multiResetIndices = [];
  if (controllerMode === "multi") {
    for (const simulation of multiSimulations) {
      if (!simulation.done || simulation.restartRemaining === null) continue;
      simulation.restartRemaining -= scaledElapsedSeconds;
      if (simulation.restartRemaining <= 0) multiResetIndices.push(simulation.index);
    }
    if (multiResetIndices.length > 0 && !busy) {
      busy = true;
      try {
        resetSelectedMulti(multiResetIndices);
        drawMulti();
        if (multiSimulations.some((simulation) => simulation.done)) status("FLIGHTS COMPLETE · RESETTING EACH IN TURN");
        else status("4 AI SIMULATIONS RUNNING");
      } catch (error) { showError(error); }
      finally { busy = false; }
      stepAccumulator = 0;
      return;
    }
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
      if (controllerMode === "multi") {
        await advanceMultiStep();
      } else {
        if (controllerMode === "override") {
          const aiAction = await choosePolicyAction(state.observation);
          const humanAction = humanOverrideAction();
          action = humanAction === null ? aiAction : humanAction;
        } else if (controllerMode === "policy") {
          action = await choosePolicyAction(state.observation);
        }
        const result = readPythonJson(`step_json(${action})`);
        state = result.state;
        totalReward += result.reward;
        if (result.terminated || result.truncated) {
          running = false;
          terminalResult = result;
        }
      }
      stepAccumulator = Math.max(0, stepAccumulator - STEP_INTERVAL_MS);
      stepsRun++;
    }
    if (controllerMode === "multi") {
      drawMulti();
    } else {
      updateTelemetry(); draw();
    }
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
$("multi-controller").addEventListener("click", () => chooseController("multi"));
$("time-scale").addEventListener("change", (event) => {
  simulationSpeed = Number(event.currentTarget.value);
  stepAccumulator = 0;
});
updateControllerButtons();

async function start() {
  try {
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
def reset_many_json():
    scenes = []
    for sim_env in multi_envs:
        observation, _ = sim_env.reset()
        scenes.append(scene_data(sim_env, observation))
    return json.dumps(scenes)
def reset_multi_indices_json(indices_json):
    results = []
    for index in json.loads(indices_json):
        observation, _ = multi_envs[index].reset()
        results.append({"index": index, "state": scene_data(multi_envs[index], observation)})
    return json.dumps(results)
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
    status("SELECT A PILOT TO START");
    $("human-controller").disabled = false;
    $("policy-controller").disabled = false;
    $("override-controller").disabled = false;
    $("multi-controller").disabled = false;
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
initializeMultiBoard();
draw(); start();
