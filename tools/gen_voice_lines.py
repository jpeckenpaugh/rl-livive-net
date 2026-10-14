#!/usr/bin/env python3
"""Generate arcade announcer voice lines with a modern neural TTS (Piper),
then quantize/downsample them so they sound like a 1990s arcade cabinet.

The spoken copy and per-clip pitch/drive live in a line spec (the v2 catalog),
not in this file. By default the script reads `tools/voice_lines_v2.json`,
next to this file; pass `--spec` to point at another catalog.

Pipeline per line:
  1. Neural TTS (Piper, 22.05 kHz, high quality / realistic).
  2. Optional pitch and tempo tweak (announcer flair).
  3. Retro stage: resample down + bit-quantize (+ optional drive) -> crunch.
  4. Write 8-bit mono WAV (tiny, browser-playable) + a 16-bit "hi-fi" WAV
     for A/B comparison.

Usage:
  PYTHONPATH=<piper lib> python3 gen_voice_lines.py \
      --model voices/en_US-ryan-high.onnx --out assets/voice
"""
import argparse
import json
import os
import sys
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig

DEFAULT_SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "voice_lines_v2.json")


def load_spec(path):
    """Load the line spec (clip id -> spoken text + options) from a catalog.

    The v2 catalog stores clips as a list of records; each record must have an
    `id` and a `text`. Optional `options` carries the announcer flair used by
    the retro stage (`pitch`, `drive`). The returned dict preserves catalog
    order and keeps the record metadata for the manifest.
    """
    with open(path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    clips = spec.get("clips")
    if not isinstance(clips, list) or not clips:
        raise ValueError(f"{path}: expected a non-empty 'clips' array")
    lines = {}
    for clip in clips:
        clip_id = clip.get("id")
        text = clip.get("text")
        if not clip_id or not text:
            raise ValueError(f"{path}: every clip needs an 'id' and 'text': {clip!r}")
        if clip_id in lines:
            raise ValueError(f"{path}: duplicate clip id {clip_id!r}")
        lines[clip_id] = clip
    return spec, lines


def synth(voice, text, length_scale=1.0):
    cfg = SynthesisConfig(length_scale=length_scale, normalize_audio=True)
    sr = voice.config.sample_rate
    chunks = list(voice.synthesize(text, syn_config=cfg))
    if not chunks:
        return sr, np.zeros(0, dtype=np.float32)
    parts = [np.frombuffer(c.audio_int16_bytes, dtype="<i2") for c in chunks]
    audio = np.concatenate(parts).astype(np.float32) / 32768.0
    return sr, audio


def resample(audio, src_sr, dst_sr):
    if src_sr == dst_sr or audio.size == 0:
        return audio
    n = int(round(audio.size * dst_sr / src_sr))
    x_old = np.linspace(0.0, 1.0, num=audio.size, endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def pitch_shift(audio, factor):
    """Cheap pitch shift via resample-and-restore-length (changes tempo too)."""
    if factor == 1.0 or audio.size == 0:
        return audio
    n = int(round(audio.size / factor))
    x_old = np.linspace(0.0, 1.0, num=audio.size, endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def retro(audio, dst_sr=8000, bits=8, drive=1.0, noise=0.0025):
    """Downsample + bit-quantize + a hair of noise = old arcade DAC."""
    if audio.size == 0:
        return audio
    a = audio * drive
    # quantize to `bits` levels
    levels = (1 << bits) - 1
    a = np.clip(a, -1.0, 1.0)
    a = np.round((a + 1.0) * 0.5 * levels) / levels * 2.0 - 1.0
    return a.astype(np.float32)


def trim_silence(audio, thresh=0.006, pad_ms=12, sr=22050):
    if audio.size == 0:
        return audio
    mag = np.abs(audio)
    idx = np.where(mag > thresh)[0]
    if idx.size == 0:
        return audio
    pad = int(sr * pad_ms / 1000)
    start = max(0, idx[0] - pad)
    end = min(audio.size, idx[-1] + pad)
    return audio[start:end]


def write_wav_16(path, audio, sr):
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def write_wav_8(path, audio, sr):
    # 8-bit unsigned PCM, the classic arcade format
    pcm = np.clip(audio, -1.0, 1.0)
    pcm = np.round((pcm + 1.0) * 127.5).astype(np.uint8)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def rms(a):
    return float(np.sqrt(np.mean(np.square(a)))) if a.size else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--spec", default=DEFAULT_SPEC,
                    help="line spec / catalog JSON (default: tools/voice_lines_v2.json)")
    ap.add_argument("--retro-rate", type=int, default=8000)
    ap.add_argument("--retro-bits", type=int, default=8)
    ap.add_argument("--keep-hifi", action="store_true")
    args = ap.parse_args()

    spec, lines = load_spec(args.spec)
    gen = spec.get("generator") or {}
    length_scale = float(gen.get("lengthScale", 1.05))
    post_alpha = float(gen.get("postFilterAlpha", 0.55))
    peak_target = float(gen.get("peak", 0.9))

    os.makedirs(args.out, exist_ok=True)
    voice = PiperVoice.load(args.model)
    sr = voice.config.sample_rate
    manifest = {"sampleRate": args.retro_rate, "bits": args.retro_bits,
                "sourceSampleRate": sr,
                "catalogVersion": spec.get("catalogVersion"),
                "lines": {}}

    for name, clip in lines.items():
        text = clip["text"]
        options = clip.get("options") or {}
        factor = options.get("pitch", 1.0)
        drive = options.get("drive", 1.0)
        _, dry = synth(voice, text, length_scale=length_scale)
        dry = trim_silence(dry, sr=sr)
        dry = pitch_shift(dry, factor)
        retro_a = resample(dry, sr, args.retro_rate)
        retro_a = retro(retro_a, bits=args.retro_bits, drive=drive)
        # cheap one-pole low-pass to soften aliasing (emulates DAC output filter)
        y = np.empty_like(retro_a)
        acc = 0.0
        for i, v in enumerate(retro_a):
            acc = acc + post_alpha * (v - acc)
            y[i] = acc
        retro_a = y
        # normalize to a consistent arcade-loud level
        peak = float(np.max(np.abs(retro_a))) or 1.0
        retro_a = retro_a / peak * peak_target
        write_wav_8(os.path.join(args.out, name + ".wav"), retro_a, args.retro_rate)
        if args.keep_hifi:
            write_wav_16(os.path.join(args.out, "hifi", name + ".wav"), dry, sr)
        dur = round(retro_a.size / args.retro_rate, 3)
        record = {"file": name + ".wav", "text": text,
                  "duration": dur, "rms": round(rms(retro_a), 4)}
        # carry the catalog's classification so the director can read it too
        for field in ("type", "category", "priority"):
            if clip.get(field) is not None:
                record[field] = clip[field]
        manifest["lines"][name] = record
        print(f"{name:24s} {dur:5.2f}s rms={rms(retro_a):.3f}  '{text}'")

    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote {len(lines)} lines from {os.path.relpath(args.spec)} -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
