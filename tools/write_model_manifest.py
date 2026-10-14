#!/usr/bin/env python3
"""Write <site>/models/manifest.json describing the policies the demo can load.

The first-party PPO policy is always listed. Any ONNX files placed under
<site>/models/contenders/<id>/ are discovered automatically and labelled from
LABELS (falling back to a prettified folder name).
"""

import json
import sys
from pathlib import Path

LABELS = {
    "ppo": "PPO (1st party, Stable-Baselines3)",
    "miftakhov": "Miftakhov Dueling DDQN",
    "sanket": "Sanket DQN",
    "khordoo": "khordoo n-step DQN",
    "cpow": "cpow-89 Ext. DQN",
}


def prettify(name):
    return name.replace("-", " ").replace("_", " ").title()


def main():
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    models = [{"id": "ppo", "label": LABELS["ppo"], "url": "models/ppo-LunarLander-v2.onnx"}]

    contenders = site / "models" / "contenders"
    if contenders.is_dir():
        for folder in sorted(contenders.iterdir()):
            if not folder.is_dir():
                continue
            for onnx in sorted(folder.glob("*.onnx")):
                models.append({
                    "id": folder.name,
                    "label": LABELS.get(folder.name, prettify(folder.name)),
                    "url": f"models/contenders/{folder.name}/{onnx.name}",
                })

    destination = site / "models" / "manifest.json"
    destination.write_text(json.dumps({"models": models}, indent=2) + "\n")
    print(f"Wrote {destination} with {len(models)} model(s)")


if __name__ == "__main__":
    main()
