# LunarLander Policy Lab

The browser page is a playable environment POC with a selectable trained-policy controller. The terminal launcher remains available for local play and environment work.

## Project links

- [Live browser demo](https://lunar.livive.net/)
- [Published PPO model card](https://huggingface.co/seekdepth/ppo-LunarLander-v2)
- [Hugging Face Deep RL Course: Unit 1 hands-on](https://huggingface.co/learn/deep-rl-course/en/unit1/hands-on)

A small terminal-playable LunarLander environment using the upstream v0.26-era
LunarLander constants/reward structure, PyPyBox2D for pure-Python physics, and
pygame for the local window. It includes a deliberately small `gymnasium`
compatibility shim so Gymnasium and its environment registry are not installed. The
local shim supports `gymnasium.make("LunarLander-v2")` and the familiar
`gymnasium.envs.box2d.lunar_lander` import path for this environment only.

## Run on macOS

```sh
./run_local.sh
```

The launcher installs `numpy`, `pygame`, and the committed pure-Python
PyPyBox2D wheel if they are missing. Python 3.9+ is recommended. Controls:
**←/→** rotate, **↑** main engine, **R** restart, **Esc** quit.

For an automated, headless physics smoke test:

```sh
python3 - <<'PY'
from lunar_lander_local import LunarLander, heuristic

env = LunarLander(render_mode=None)
obs, _ = env.reset(seed=7)
total = 0.0
for _ in range(1000):
    obs, reward, terminated, truncated, _ = env.step(heuristic(obs))
    total += reward
    if terminated or truncated:
        break
print(f"steps={env.episode_steps} reward={total:.1f} done={terminated or truncated}")
env.close()
PY
```

## Scope

This POC mirrors the classic discrete LunarLander interface (`reset()` and
five-value `step()`), 8-value observations, action ids, physics constants, and
reward shaping. It is not the complete Gymnasium package and does not promise
bit-for-bit Box2D trajectories: PyPyBox2D is an older pure-Python Box2D 2.1-era
port, while Gymnasium's original environment uses native Box2D 2.3 bindings.
`lunar_lander_local.py` is the adapted runnable implementation. The reference
environment is [Gymnasium LunarLander-v2](https://github.com/Farama-Foundation/Gymnasium/blob/v0.26.3/gymnasium/envs/box2d/lunar_lander.py).

## Browser POC

The static page runs the same Python environment in Pyodide 0.23.4. Run
`bash install.sh`, then `bash run.sh`, and open `http://localhost:8787/`.
NumPy and Micropip load from
Pyodide's package repository. The browser installs a first-party wheel built
from the Gym shim and environment source, plus the separately credited,
architecture-independent PyPyBox2D wheel in `third_party/wheels/`. The
PyPyBox2D wheel was built once from upstream's pure-Python release and is
committed; deploys reuse it. See `third_party/README.md` for provenance and
license details. GitHub Actions builds the first-party wheel for Pages.

The browser uses JavaScript canvas rendering and does not require pygame.

### Project layout

The browser app is a set of plain ES modules loaded directly by the page (no
bundler):

- `index.html` — static cabinet shell (screens, HUD, menus).
- `style.css` — manifest that imports `styles/` (fonts, cabinet, screens, pages).
- `src/main.js` — entry point: boot, event wiring, animation loop.
- `src/config.js` — tunables and the screen registry.
- `src/state.js` — shared mutable state.
- `src/data.js` — loads the JSON tables from `data/` at boot.
- `src/hazards.js`, `src/audio.js`, `src/render.js`, `src/models.js`,
  `src/leaderboard.js`, `src/input.js` — feature modules.
- `src/solo.js`, `src/match.js` — Solo Flight and Tournament engines.
- `src/screens.js`, `src/ui.js`, `src/attract.js` — screen router, menus, attract demo.
- `src/python.js` + `src/py/setup.py` — Pyodide bridge and Python bootstrap.
- `data/*.json` — taglines, arenas, hazards, music tracks, model catalog, voice list.

### Trained policy

The browser runs the Stable-Baselines3 policy as a small ONNX actor with
ONNX Runtime Web 1.19.2's WASM CPU backend. With fault settings off, the policy
receives the current 8-value environment observation and selects the maximum of
the model's four action logits. With Sensor Fault enabled, an AI decision may
instead receive the previous physics-step observation. PyTorch,
Stable-Baselines3, and the ONNX exporter are only used locally when producing
the model file.

The browser offers Human Pilot, AI Pilot, and Autopilot with Override. It also
offers a 4 AI Simulations mode: four independent environments run policy actions
concurrently, using a batched ONNX inference call and keeping separate rewards
and episode outcomes. In override mode the AI controls the full action space by
default; any held human arrow-key input takes control for that step.

The browser-only Sensor Fault and Thruster Fault controls each default to OFF
and offer 5%, 10%, 25%, and 50% settings. Sensor Fault substitutes the previous
physics-step observation for the AI's current input at the selected chance per
decision; telemetry continues to show the actual environment state. Thruster
Fault applies at each physics step: a requested thrust action may be dropped,
or an unrequested action may fire while the controller requested coast. This
affects Human Pilot and AI commands. These fault settings do not change the
trained model or the Python environment implementation.

To reproduce the export on macOS, create a separate environment and run the
exporter. If the Hugging Face checkpoint is still an LFS pointer in the
submodule, the exporter downloads the checkpoint at the submodule's pinned
Hugging Face revision into a temporary cache.

```sh
python3 -m venv .venv-policy-export
.venv-policy-export/bin/pip install -r requirements-policy-export.txt
.venv-policy-export/bin/python tools/export_lunarlander_policy.py
```

The export is written to `models/ppo-LunarLander-v2/ppo-LunarLander-v2.onnx`.
The script compares ONNX logits and deterministic actions against the source
SB3 policy before replacing the output file.

The local `run.sh` build uses that submodule artifact when it is present. The
Pages build does not check out submodules: it fetches the ONNX file from the
public Hugging Face model repository at the full commit SHA in
`models/onnx-revision.txt`. When updating the policy, publish the ONNX artifact
to Hugging Face and update that file to the commit containing the upload. The
existing deployment workflow remains unchanged.

For the local launcher, the committed wheel is installed from `requirements.txt`:

```sh
python3 -m pip install -r requirements.txt
```
