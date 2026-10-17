# 🚀 LunarLander Policy Lab — Tournament Edition

> **9 Trained ONNX Policies · Pyodide Physics · Retro Arcade Cabinet** — Fly LunarLander-v2 yourself, co-pilot alongside a Stable-Baselines3 PPO policy with live softmax sparklines, or race 4 AI pilots head-to-head across 10 seeded tournament rounds.

[![Play Now on Livive](https://img.shields.io/badge/▶_PLAY_NOW-lunar.livive.net-38bdf8?style=for-the-badge)](https://lunar.livive.net/)

---

## 🎮 Play in Your Browser ([lunar.livive.net](https://lunar.livive.net/))

- **Solo Flight & Co-Piloting:** Choose **Human Pilot** (`←/→` rotate, `↑` main engine), **Co-Piloting** (AI flies by default; hold any arrow key to override on the fly), or **AI Pilot** (watch any of the 9 trained ONNX policies fly with the live **Policy Inspector** showing `COAST / LEFT / BURN / RIGHT` softmax bars and confidence sparkline).
- **Multiplayer & 4-Pilot Cup:** Race `1v1 Versus`, `2v2 Doubles`, or the `4-Pilot Cup` across 10 seeded rounds with customizable **House Rules** hazards (Sensor Fault, Thruster Fault, Wind, Gravity).

---

## 🛠️ For Developers (The Other 10%)

### Local macOS Launcher
```sh
./run_local.sh
```
The launcher installs `numpy`, `pygame`, and the committed pure-Python PyPyBox2D wheel if missing. Python 3.9+ recommended. Controls: **←/→** rotate, **↑** main engine, **R** restart, **Esc** quit.

### Browser POC Build
```sh
bash install.sh
bash run.sh
```
Open `http://localhost:8787/`. The static page runs the Python environment in Pyodide with ONNX Runtime Web 1.19.2 for PPO inference.

### Project Layout
- `index.html` — static cabinet shell and screens.
- `src/main.js` — entry point, boot, event wiring, animation loop.
- `src/policy.js`, `src/models.js` — ONNX model loading and inference.
- `src/solo.js`, `src/match.js` — Solo Flight and Tournament engines.
- `src/python.js` + `src/py/setup.py` — Pyodide bridge and Python bootstrap.
- `data/*.json` — model catalog, hazards, arenas, leaderboards.
