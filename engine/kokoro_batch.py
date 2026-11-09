"""Speak a batch of phrases with Kokoro, loading the model once.

Usage: python3 kokoro_batch.py <model.onnx> <voices.bin> <jobs.json>
jobs.json is a list of {"text", "voice", "speed", "lang", "out"}.
Prints one JSON line per phrase: {"out", "sampleRate", "seconds"}.
"""
import inspect
import json
import sys

import kokoro_onnx
import soundfile as sf

model_path, voices_path, jobs_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(jobs_path, "r", encoding="utf-8") as fh:
    jobs = json.load(fh)

model = kokoro_onnx.Kokoro(model_path, voices_path)
supports_lang = "lang" in inspect.signature(model.create).parameters


def speak(text, kwargs):
    try:
        return model.create(text, **kwargs)
    except IndexError:
        # Very long phrases overflow the voice token table. Split near the middle at a space.
        mid = len(text) // 2
        spaces = [i for i, c in enumerate(text) if c.isspace()]
        cut = min(spaces, key=lambda i: abs(i - mid)) if spaces else mid
        a, ra = speak(text[:cut].strip(), kwargs)
        b, rb = speak(text[cut:].strip(), kwargs)
        return list(a) + list(b), ra


for job in jobs:
    kwargs = {"voice": job["voice"], "speed": float(job.get("speed", 1.0))}
    if supports_lang and job.get("lang"):
        kwargs["lang"] = job["lang"]
    samples, rate = speak(job["text"], kwargs)
    sf.write(job["out"], samples, rate, subtype="PCM_16")
    print(json.dumps({"out": job["out"], "sampleRate": rate, "seconds": round(len(samples) / rate, 4)}), flush=True)
