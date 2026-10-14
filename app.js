const PYODIDE_VERSION = "0.23.4";
const ONNX_RUNTIME_VERSION = "1.19.2";
const POLICY_MODEL_URL = new URL("./models/ppo-LunarLander-v2.onnx", import.meta.url);
const FPS = 50;
const STEP_INTERVAL_MS = 1000 / FPS;
const MAX_CATCH_UP_STEPS = 4;
const MAX_FRAME_ELAPSED_MS = 100;
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
let lastFrameTime = 0;
let stepAccumulator = 0;
const pressed = new Set();

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

function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#101821";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8293a1";
  for (let i = 0; i < 45; i++) {
    const x = (i * 137 + 29) % w, y = (i * 71 + 19) % 275;
    ctx.globalAlpha = .22 + ((i * 17) % 6) / 12;
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  if (!state) return;

  // Draw the generated terrain from the same world coordinates used by physics.
  const terrain = state.terrain;
  if (terrain.length) {
    ctx.beginPath();
    let p = screenPoint(terrain[0][0]);
    ctx.moveTo(p[0], p[1]);
    for (const segment of terrain) {
      p = screenPoint(segment[1]);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = "#1b2530"; ctx.fill();
    ctx.beginPath();
    p = screenPoint(terrain[0][0]); ctx.moveTo(p[0], p[1]);
    for (const segment of terrain) { p = screenPoint(segment[1]); ctx.lineTo(p[0], p[1]); }
    ctx.strokeStyle = "#697784"; ctx.lineWidth = 2; ctx.stroke();
  }
  const padLeft = screenPoint([state.pad[0], state.pad[1]]);
  const padRight = screenPoint([state.pad[2], state.pad[1]]);
  ctx.strokeStyle = "#c7f36b"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(...padLeft); ctx.lineTo(...padRight); ctx.stroke();
  ctx.fillStyle = "#c7f36b"; ctx.font = "10px monospace";
  ctx.fillText("LANDING ZONE", padLeft[0] + 7, padLeft[1] + 19);

  for (const body of state.bodies) {
    if (body.circle) {
      const c = screenPoint(body.circle.center);
      ctx.fillStyle = body.particle ? "#ff9d5c" : "#d3dde3";
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, body.circle.radius * SCALE), 0, Math.PI * 2); ctx.fill();
      continue;
    }
    if (!body.vertices?.length) continue;
    const points = body.vertices.map(screenPoint);
    if (body.particle) {
      ctx.fillStyle = "#ff9d5c"; ctx.beginPath(); ctx.arc(points[0][0], points[0][1], 2, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = "#e4ebef"; ctx.strokeStyle = "#aab7c0"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // Engine flame follows the current input state.
  const obs = state.observation;
  const x = w / 2 + obs[0] * (w / 2), y = h - (obs[1] * (VIEWPORT_HALF_H) + 8.1) * SCALE;
  ctx.save(); ctx.translate(x, y); ctx.rotate(obs[4]);
  if (action === 2) {
    ctx.fillStyle = "#ff9d5c"; ctx.beginPath(); ctx.moveTo(-5, 12); ctx.lineTo(0, 27 + Math.random() * 7); ctx.lineTo(5, 12); ctx.fill();
  }
  if (action === 1 || action === 3) {
    const sign = action === 1 ? 1 : -1;
    ctx.fillStyle = "#75d8e6"; ctx.beginPath(); ctx.moveTo(sign * 9, 0); ctx.lineTo(sign * (20 + Math.random() * 4), 4); ctx.lineTo(sign * 9, 7); ctx.fill();
  }
  ctx.restore();
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
  ];
  for (const [id, mode] of choices) {
    const button = $(id);
    const selected = controllerMode === mode;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
    const stateLabel = button.querySelector(".controller-state");
    stateLabel.textContent = selected ? "ACTIVE" : mode !== "human" && policySession ? "READY" : "SELECT";
  }
  $("controller-help").hidden = controllerMode !== "override";
}

function controllerButton(mode) {
  const ids = {
    human: "human-controller",
    policy: "policy-controller",
    override: "override-controller",
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
  if (request !== controllerRequest) return;
  controllerMode = mode;
  pressed.clear();
  updateAction();
  updateControllerButtons();
  if (episode === 0 && state && !running) await resetEpisode();
}

async function choosePolicyAction(observation) {
  const ort = globalThis.ort;
  const input = new ort.Tensor("float32", Float32Array.from(observation), [1, 8]);
  const result = await policySession.run({ observation: input });
  const logits = result.logits.data;
  let best = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i;
  return best;
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
  busy = true; running = false;
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
function showError(error) {
  running = false; busy = false; status("RUNTIME ERROR");
  overlay(String(error?.message || error).split("\n").slice(-5).join(" "), true);
  console.error(error);
}
async function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = lastFrameTime === 0 ? 0 : Math.min(now - lastFrameTime, MAX_FRAME_ELAPSED_MS);
  lastFrameTime = now;
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
      const result = readPythonJson(`step_json(${action})`);
      state = result.state;
      totalReward += result.reward;
      stepAccumulator = Math.max(0, stepAccumulator - STEP_INTERVAL_MS);
      stepsRun++;
      if (result.terminated || result.truncated) {
        running = false;
        terminalResult = result;
      }
    }
    updateTelemetry(); draw();
    if (terminalResult) {
      stepAccumulator = 0;
      status(terminalResult.terminated ? "EPISODE COMPLETE" : "TIME LIMIT REACHED");
      overlay(`Episode ended · ${totalReward.toFixed(1)} points · reset to fly again`);
      $("reset").disabled = false;
    }
  } catch (error) { showError(error); }
  finally { busy = false; }
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
    resetEpisode();
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
$("reset").addEventListener("click", resetEpisode);
$("human-controller").addEventListener("click", () => chooseController("human"));
$("policy-controller").addEventListener("click", () => chooseController("policy"));
$("override-controller").addEventListener("click", () => chooseController("override"));
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
def scene_data(observation):
    bodies = []
    for body in env.drawlist + env.particles:
        for fixture in body.fixtures:
            shape = fixture.shape
            if isinstance(shape, Circle):
                center = body.transform * shape.position
                bodies.append({"circle": {"center": [center.x, center.y], "radius": shape.radius}, "particle": body in env.particles})
            elif hasattr(shape, "vertices"):
                vertices = body.transform
                world_vertices = [vertices * point for point in shape.vertices]
                bodies.append({"vertices": [[p.x, p.y] for p in world_vertices], "particle": False})
    return {"observation": observation.tolist(), "terrain": env.sky_polys,
            "pad": [env.helipad_x1, env.helipad_y, env.helipad_x2], "bodies": bodies}
def reset_json():
    observation, _ = env.reset()
    return json.dumps(scene_data(observation))
def step_json(action):
    observation, reward, terminated, truncated, _ = env.step(int(action))
    return json.dumps({"state": scene_data(observation), "reward": reward,
                       "terminated": terminated, "truncated": truncated})
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
    $("reset").disabled = true;
  } catch (error) { showError(error); }
  finally { busy = false; }
}
async function installWheel(url) {
  pyodide.globals.set("_wheel_url", url);
  try {
    await pyodide.runPythonAsync("import micropip\nawait micropip.install(_wheel_url, deps=False)");
  } finally {
    pyodide.globals.delete("_wheel_url");
  }
}
draw(); start();
