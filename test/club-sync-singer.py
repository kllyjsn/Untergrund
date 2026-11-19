"""Local harness singer: the production render with a content-addressed disk cache."""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "singer"))
from singer import AUDIO, Singer, request_hash, serve, validate


class CachedSinger(Singer):
    def __init__(self, directory):
        super().__init__(backend="litert", threads=4)
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)

    def render(self, raw):
        req = validate(raw)
        key = request_hash(req)
        audio, meta = self.directory / f"{key}.audio", self.directory / f"{key}.json"
        if audio.exists() and meta.exists():
            print(f"singer cache hit {key}", file=sys.stderr, flush=True)
            return audio.read_bytes(), AUDIO[req["audio"]][2], json.loads(meta.read_text())
        print(f"singer cache miss {key}", file=sys.stderr, flush=True)
        data, kind, info = super().render(req)
        audio.with_suffix(".part").write_bytes(data)
        audio.with_suffix(".part").replace(audio)
        meta.write_text(json.dumps(info))
        return data, kind, info


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    secret = os.environ.get("SINGER_SECRET")
    if not secret:
        parser.error("SINGER_SECRET is required")
    serve(args.port, CachedSinger(args.cache), secret)
