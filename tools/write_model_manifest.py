#!/usr/bin/env python3
"""Write <site>/models/manifest.json describing the pilots the cabinet can load.

The default PPO pilot is always listed. Any ONNX files placed under
<site>/models/contenders/<id>/ are discovered automatically and labelled from
ATTRIBUTION (falling back to a prettified folder name).

Each entry carries attribution so the UI can render the pilot roster and the
Play screen's "Pilot source" caption: label, author, algorithm, role, and a
link to the source the pilot came from.
"""

import json
import sys
from pathlib import Path

# id -> label / author / algorithm / role / source. Only the five pilots listed
# in the branding spec (AIA-8) may appear; do not invent new sources.
ATTRIBUTION = {
    "ppo": {
        "label": "seekdepth jpeckenpaugh",
        "author": "seekdepth",
        "algorithm": "PPO",
        "role": "default",
        "source": "https://huggingface.co/seekdepth/ppo-LunarLander-v2",
    },
    "miftakhov": {
        "label": "Miftakhov Dueling DDQN",
        "author": "Miftakhov",
        "algorithm": "Dueling Double DQN",
        "role": "contender",
        "source": "https://github.com/RMiftakhov/LunarLander-v2-drlnd",
    },
    "sanket": {
        "label": "Sanket DQN",
        "author": "sanket",
        "algorithm": "DQN",
        "role": "contender",
        "source": "https://github.com/sanketsans/openAIenv",
    },
    "khordoo": {
        "label": "khordoo n-step DQN",
        "author": "khordoo",
        "algorithm": "n-step DQN",
        "role": "contender",
        "source": "https://github.com/khordoo/Deep-Reinforcement-Learning-with-PyTorch",
    },
    "cpow": {
        "label": "cpow-89 Ext. DQN",
        "author": "cpow-89",
        "algorithm": "Extended DQN",
        "role": "contender",
        "source": "https://github.com/cpow-89/Extended-Deep-Q-Learning-For-Open-AI-Gym-Environments",
    },
    "udacity": {
        "label": "Udacity DQN",
        "author": "Udacity",
        "algorithm": "DQN",
        "role": "contender",
        "source": "https://github.com/udacity/deep-reinforcement-learning",
    },
    "nikhilbarhate": {
        "label": "Barhate Actor-Critic",
        "author": "Barhate",
        "algorithm": "Actor-Critic",
        "role": "contender",
        "source": "https://github.com/nikhilbarhate99/Actor-Critic",
    },
    "xinliyu": {
        "label": "Xinli Yu DQN",
        "author": "Xinli Yu",
        "algorithm": "DQN",
        "role": "contender",
        "source": "https://github.com/XinliYu/RL-Projects",
    },
    "ashbellett": {
        "label": "Bellett DQN",
        "author": "Bellett",
        "algorithm": "DQN",
        "role": "contender",
        "source": "https://github.com/ashbellett/reinforcement-learning",
    },
}


def prettify(name):
    return name.replace("-", " ").replace("_", " ").title()


def attribution(model_id, url):
    meta = ATTRIBUTION.get(model_id, {})
    return {
        "id": model_id,
        "label": meta.get("label", prettify(model_id)),
        "url": url,
        "author": meta.get("author", ""),
        "algorithm": meta.get("algorithm", ""),
        "role": meta.get("role", "contender"),
        "source": meta.get("source", ""),
    }


def main():
    site = Path(sys.argv[1] if len(sys.argv) > 1 else "_site")
    models = [attribution("ppo", "models/ppo-LunarLander-v2.onnx")]

    contenders = site / "models" / "contenders"
    if contenders.is_dir():
        for folder in sorted(contenders.iterdir()):
            if not folder.is_dir():
                continue
            for onnx in sorted(folder.glob("*.onnx")):
                models.append(attribution(folder.name, f"models/contenders/{folder.name}/{onnx.name}"))

    destination = site / "models" / "manifest.json"
    destination.write_text(json.dumps({"models": models}, indent=2) + "\n")
    print(f"Wrote {destination} with {len(models)} model(s)")


if __name__ == "__main__":
    main()
