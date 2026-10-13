# LunarLander Policy Lab

The browser page is a playable environment POC, with trained-policy integration as the next milestone. The terminal launcher remains available for local play and environment work.

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

The static page runs the same Python environment in Pyodide 0.23.4. Start
`./run.sh` and open `http://127.0.0.1:8000/`. NumPy and Micropip load from
Pyodide's package repository. The browser installs a first-party wheel built
from the Gym shim and environment source, plus the separately credited,
architecture-independent PyPyBox2D wheel in `third_party/wheels/`. The
PyPyBox2D wheel was built once from upstream's pure-Python release and is
committed; deploys reuse it. See `third_party/README.md` for provenance and
license details. GitHub Actions builds the first-party wheel for Pages.

The browser uses JavaScript canvas rendering and does not require pygame.

For the local launcher, the committed wheel is installed from `requirements.txt`:

```sh
python3 -m pip install -r requirements.txt
```
