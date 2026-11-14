"""Sing the opening of each genre's song in every built-in voice and singing mode on CPU, measure it (vocal_metrics.py)
and rank. Local only (it runs the model): python singer/voice_survey.py --models ~/singer/models pop.json rnb.json folk.json
Each JSON is an untergrund-sing/1 request (or {"req": request}); its file name (pop, rnb, folk) names the genre.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import singer as S  # noqa: E402
import expression  # noqa: E402
from vocal_metrics import measure  # noqa: E402


def excerpt(score: dict, beats: float) -> dict:
    """The score up to the first rest ``beats`` beats after its first sung note (whole phrases), with its words as the text."""
    notes, t = [], None
    for row in score["notes"]:
        if t is not None and t >= beats and row[0] == "-":
            break
        notes.append(row)
        if row[0] != "-" or t is not None:
            t = (t or 0.0) + row[2]
    words = [re.sub(r"~\d+$", "", l) for l, _, _ in notes if l != "-" and not re.search(r"~([2-9]|\d\d)$", l)]
    return {**score, "notes": notes, "text": " ".join(words)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("requests", nargs="+")
    ap.add_argument("--models", default=str(Path.home() / "singer" / "models"))
    ap.add_argument("--beats", type=float, default=32)
    ap.add_argument("--voices", default=",".join(S.VOICES))
    ap.add_argument("--modes", default="pop,ballad")
    ap.add_argument("--expr", default="{}", help="expression knobs (JSON) for every render")
    ap.add_argument("--out", default="voice-survey.json")
    a = ap.parse_args(argv)
    eng = S.ScyllasBand(Path(a.models), "litert", None).load().rt.engine
    rows = []
    for path in a.requests:
        raw = json.load(open(path))
        req = S.validate(raw.get("req", raw))
        genre = Path(path).stem
        for mode in a.modes.split(","):
            score = excerpt({**req["score"], "style": mode}, a.beats)
            for voice in a.voices.split(","):
                t0 = time.time()
                audio = expression.sing(eng, score, voice, req["seed"], expression.clean_expr(json.loads(a.expr)))
                row = dict(genre=genre, mode=mode, voice=voice, render_s=round(time.time() - t0, 1), **measure(audio, S.SAMPLE_RATE, score))
                rows.append(row)
                print(json.dumps(row), flush=True)
    json.dump(rows, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
