#!/usr/bin/env python3
"""Export the pinned Stable-Baselines3 PPO policy to browser-ready ONNX."""

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from stable_baselines3 import PPO
from torch import nn


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHECKPOINT = ROOT / "models/ppo-LunarLander-v2/ppo-LunarLander-v2.zip"
DEFAULT_OUTPUT = ROOT / "models/ppo-LunarLander-v2/ppo-LunarLander-v2.onnx"
ACTION_MAPPING = "0=noop,1=rotate_left,2=main_engine,3=rotate_right"


def source_revision() -> str:
    return subprocess.check_output(
        ["git", "-C", str(DEFAULT_CHECKPOINT.parent), "rev-parse", "HEAD"], text=True
    ).strip()


class ActorLogits(nn.Module):
    """Expose only the policy actor; SB3's value head is not needed at inference."""

    def __init__(self, policy: nn.Module) -> None:
        super().__init__()
        self.policy = policy

    def forward(self, observation: torch.Tensor) -> torch.Tensor:
        features = self.policy.extract_features(observation)
        if isinstance(features, tuple):
            features = features[0]
        latent = self.policy.mlp_extractor.forward_actor(features)
        return self.policy.action_net(latent)


def checkpoint_payload(checkpoint: Path) -> Path:
    if not checkpoint.is_file():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint}")
    if not checkpoint.read_bytes()[:64].startswith(b"version https://git-lfs.github.com/spec/v1"):
        return checkpoint

    revision = source_revision()
    from huggingface_hub import hf_hub_download

    cache_dir = Path(tempfile.gettempdir()) / "lunarlander-hf-cache"
    payload = hf_hub_download(
        repo_id="seekdepth/ppo-LunarLander-v2",
        filename=checkpoint.name,
        revision=revision,
        cache_dir=str(cache_dir),
    )
    print(f"Fetched LFS checkpoint for HF revision {revision}: {payload}")
    return Path(payload)


def load_model(checkpoint: Path) -> PPO:
    checkpoint = checkpoint_payload(checkpoint)

    # The checkpoint's learning-rate and clipping schedules were cloudpickled
    # under Python 3.11. They are training-only; supply equivalent constant
    # schedules so inference does not need to deserialize those functions.
    model = PPO.load(
        str(checkpoint),
        device="cpu",
        custom_objects={
            "lr_schedule": lambda _progress: 3e-4,
            "clip_range": lambda _progress: 0.2,
        },
    )
    if tuple(model.observation_space.shape or ()) != (8,):
        raise ValueError(f"Expected an 8-value observation, got {model.observation_space}")
    if getattr(model.action_space, "n", None) != 4:
        raise ValueError(f"Expected a four-action Discrete space, got {model.action_space}")
    if model.get_vec_normalize_env() is not None:
        raise ValueError("This exporter expects raw observations without VecNormalize")
    return model


def export_and_validate(checkpoint: Path, output: Path, samples: int) -> tuple[float, int]:
    model = load_model(checkpoint)
    actor = ActorLogits(model.policy.eval()).eval()
    example = torch.zeros((1, 8), dtype=torch.float32)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_name(output.name + ".tmp")

    try:
        torch.onnx.export(
            actor,
            (example,),
            str(temporary_output),
            input_names=["observation"],
            output_names=["logits"],
            dynamic_axes={"observation": {0: "batch"}, "logits": {0: "batch"}},
            opset_version=17,
            do_constant_folding=True,
            dynamo=False,
        )

        graph = onnx.load(str(temporary_output))
        onnx.checker.check_model(graph)
        metadata = {
            "source": f"seekdepth/ppo-LunarLander-v2@{source_revision()}",
            "stable_baselines3": "2.0.0a5",
            "observation_shape": "[batch,8] float32; raw, unnormalized observations",
            "output": "[batch,4] categorical action logits",
            "action_mapping": ACTION_MAPPING,
        }
        for key, value in metadata.items():
            entry = graph.metadata_props.add()
            entry.key = key
            entry.value = value
        onnx.save(graph, str(temporary_output))

        session = ort.InferenceSession(
            str(temporary_output), providers=["CPUExecutionProvider"]
        )
        observation_space = model.observation_space
        rng = np.random.default_rng(20261013)
        observations = rng.uniform(
            low=observation_space.low,
            high=observation_space.high,
            size=(samples, 8),
        ).astype(np.float32)
        # Exercise recognizable states in addition to bounded random inputs.
        observations[:2] = np.asarray(
            [
                np.zeros(8, dtype=np.float32),
                [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.0, 0.0],
            ],
            dtype=np.float32,
        )

        expected_actions, _ = model.predict(observations, deterministic=True)
        actual_logits = session.run(["logits"], {"observation": observations})[0]
        actual_actions = actual_logits.argmax(axis=1)
        equal_actions = np.equal(expected_actions.reshape(-1), actual_actions)
        if not np.all(equal_actions):
            mismatches = np.flatnonzero(~equal_actions)[:10].tolist()
            raise AssertionError(
                f"SB3 and ONNX chose different actions for {int((~equal_actions).sum())}/"
                f"{samples} observations; first mismatches: {mismatches}"
            )

        with torch.inference_mode():
            expected_logits = actor(torch.from_numpy(observations)).cpu().numpy()
        max_logit_error = float(np.max(np.abs(expected_logits - actual_logits)))
        if not np.allclose(expected_logits, actual_logits, rtol=1e-4, atol=1e-5):
            raise AssertionError(f"ONNX logits differ from PyTorch (max error {max_logit_error})")

        os.replace(temporary_output, output)
        return max_logit_error, int(equal_actions.sum())
    finally:
        temporary_output.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--samples", type=int, default=4096)
    args = parser.parse_args()
    if args.samples < 2:
        parser.error("--samples must be at least 2")

    max_error, matched = export_and_validate(args.checkpoint, args.output, args.samples)
    print(f"Exported: {args.output}")
    print(f"Actions matching SB3: {matched}/{args.samples}")
    print(f"Maximum absolute logit error: {max_error:.8g}")


if __name__ == "__main__":
    main()
