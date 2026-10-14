#!/usr/bin/env python3
"""Generate arcade announcer voice lines with a modern neural TTS (Piper),
then quantize/downsample them so they sound like a 1990s arcade cabinet.

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
import struct
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig

# Key phrases / "action beats" in the 1990s arcade announcer idiom.
# name -> (spoken text, options)
#   pitch: playback rate multiplier applied after synthesis (>1 = higher)
#   drive: extra gain into the quantizer for a hotter, crunchier tone
LINES = {
    "coin":            {"text": "Insert coin.", "drive": 1.15},
    "select":          {"text": "Choose your pilot.", "drive": 1.1},
    "round_one":       {"text": "Round one.", "drive": 1.1},
    "round_two":       {"text": "Round two.", "drive": 1.1},
    "round_three":     {"text": "Final round.", "drive": 1.1},
    "fight":           {"text": "Fight!", "drive": 1.3, "pitch": 1.06},
    "perfect":         {"text": "Perfect!", "drive": 1.35, "pitch": 1.12},
    "flawless":        {"text": "Flawless victory!", "drive": 1.3, "pitch": 1.1},
    "ko":              {"text": "K. O.!", "drive": 1.4, "pitch": 1.05},
    "you_win":         {"text": "You win!", "drive": 1.2, "pitch": 1.08},
    "you_lose":        {"text": "You lose.", "drive": 1.1, "pitch": 0.95},
    "game_over":       {"text": "Game over.", "drive": 1.1, "pitch": 0.93},
    "new_challenger":  {"text": "New challenger!", "drive": 1.3, "pitch": 1.1},
    "time_up":         {"text": "Time up!", "drive": 1.25, "pitch": 1.08},
    "take_off":        {"text": "Take off!", "drive": 1.2, "pitch": 1.08},
}


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
    a = pitch_shift(audio, 1.0)  # placeholder to keep API symmetric
    a = a * drive
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
    ap.add_argument("--retro-rate", type=int, default=8000)
    ap.add_argument("--retro-bits", type=int, default=8)
    ap.add_argument("--keep-hifi", action="store_true")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    voice = PiperVoice.load(args.model)
    sr = voice.config.sample_rate
    manifest = {"sampleRate": args.retro_rate, "bits": args.retro_bits,
                "sourceSampleRate": sr, "lines": {}}

    for name, spec in LINES.items():
        text = spec["text"]
        factor = spec.get("pitch", 1.0)
        drive = spec.get("drive", 1.0)
        _, dry = synth(voice, text, length_scale=1.05)
        dry = trim_silence(dry, sr=sr)
        dry = pitch_shift(dry, factor)
        retro_a = resample(dry, sr, args.retro_rate)
        retro_a = retro(retro_a, bits=args.retro_bits, drive=drive)
        # cheap one-pole low-pass to soften aliasing (emulates DAC output filter)
        alpha = 0.55
        y = np.empty_like(retro_a)
        acc = 0.0
        for i, v in enumerate(retro_a):
            acc = acc + alpha * (v - acc)
            y[i] = acc
        retro_a = y
        # normalize to a consistent arcade-loud level
        peak = float(np.max(np.abs(retro_a))) or 1.0
        retro_a = retro_a / peak * 0.9
        write_wav_8(os.path.join(args.out, name + ".wav"), retro_a, args.retro_rate)
        if args.keep_hifi:
            write_wav_16(os.path.join(args.out, "hifi", name + ".wav"), dry, sr)
        dur = round(retro_a.size / args.retro_rate, 3)
        manifest["lines"][name] = {"file": name + ".wav", "text": text,
                                   "duration": dur, "rms": round(rms(retro_a), 4)}
        print(f"{name:16s} {dur:5.2f}s rms={rms(retro_a):.3f}  '{text}'")

    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nWrote {len(LINES)} lines -> {args.out}")


if __name__ == "__main__":
    main()
