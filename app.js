const PYODIDE_VERSION = "0.23.4";
const FPS = 50;
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
let lastStep = 0;
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

function readPythonJson(expression) {
  return JSON.parse(pyodide.runPython(expression));
}
async function resetEpisode() {
  if (!pyodide || busy) return;
  busy = true; running = false;
  try {
    state = readPythonJson("reset_json()");
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
function frame(now) {
  requestAnimationFrame(frame);
  if (!running || busy || now - lastStep < 1000 / FPS) return;
  lastStep = now; busy = true;
  try {
    const result = readPythonJson(`step_json(${action})`);
    state = result.state; totalReward += result.reward;
    updateTelemetry(); draw();
    if (result.terminated || result.truncated) {
      running = false;
      status(result.terminated ? "EPISODE COMPLETE" : "TIME LIMIT REACHED");
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
window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowDown" && !event.repeat) {
    event.preventDefault();
    resetEpisode();
    return;
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.code)) {
    event.preventDefault(); pressed.add(event.code); updateAction();
  }
});
window.addEventListener("keyup", (event) => { pressed.delete(event.code); updateAction(); });
window.addEventListener("blur", () => { pressed.clear(); updateAction(); });
$("reset").addEventListener("click", resetEpisode);

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
    await resetEpisode(); requestAnimationFrame(frame);
  } catch (error) { showError(error); }
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
