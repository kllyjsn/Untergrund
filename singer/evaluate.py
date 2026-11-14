"""Score a sung stem against the request that sang it: python singer/evaluate.py stem.wav request.json [...]

request.json is the `untergrund-sing/1` body (or {"req": body}); prints vocal_metrics.measure() as JSON per stem.
"""
import json
import sys

import numpy as np
import soundfile as sf

import vocal_metrics

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or len(args) % 2:
        sys.exit(__doc__)
    for wav, req in zip(args[::2], args[1::2]):
        x, sr = sf.read(wav, dtype="float32")
        body = json.load(open(req))
        print(wav, json.dumps(vocal_metrics.measure(x if x.ndim == 1 else x.mean(1), sr, body.get("req", body)["score"])))
