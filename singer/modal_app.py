"""Untergrund's neural singer on Modal: Singer.render (singer.py) on an L4 GPU that scales to zero.

Deploy (docs/singer.md):
  pip install modal==1.2.1 && modal token new
  modal secret create untergrund-singer SINGER_SECRET=<a long random string>
  modal deploy singer/modal_app.py
The web endpoint it prints is SINGER_URL for the untergrund-i2i9 Vercel project (with the same SINGER_SECRET).
"""
from __future__ import annotations

import json

import modal

from singer import LIMITS, MODEL_REVISION, RUNTIME_COMMIT, RUNTIME_REPO, BadRequest, Singer, authorized, validate

MODELS = "/models"
app = modal.App("untergrund-singer")
# The model weights live here, downloaded once at the pinned revision and checksummed (fetch_model in singer.py).
volume = modal.Volume.from_name("untergrund-singer-models", create_if_missing=True)
secret = modal.Secret.from_name("untergrund-singer")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "libsndfile1")
    .pip_install("numpy==2.2.6", "huggingface_hub==0.36.2", "soundfile==0.14.0", "onnxruntime-gpu[cuda,cudnn]==1.23.2", "fastapi==0.115.12")
    # The runtime at its release commit, without its LiteRT dependency (the GPU runs ONNX Runtime).
    .pip_install(f"scyllasband @ git+{RUNTIME_REPO}@{RUNTIME_COMMIT}", extra_options="--no-deps")
    .env({"SINGER_MODELS": MODELS, "SINGER_BACKEND": "onnx-gpu", "HF_HUB_DISABLE_TELEMETRY": "1", "SCYLLASBAND_NO_BOOTSTRAP": "1"})
    .add_local_python_source("singer")
)


@app.cls(gpu="L4", image=image, volumes={MODELS: volume}, min_containers=0, max_containers=2, scaledown_window=60, timeout=600)
class Voice:
    @modal.enter()
    def load(self):
        self.singer = Singer()
        self.singer.load()
        volume.commit()

    @modal.method()
    def render(self, req: dict) -> tuple[bytes, str, dict]:
        return self.singer.render(req)


@app.function(image=image, secrets=[secret], min_containers=0, scaledown_window=60, timeout=60)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    import os

    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, Response

    api, key = FastAPI(docs_url=None, redoc_url=None, openapi_url=None), os.environ.get("SINGER_SECRET", "")

    @api.get("/health")
    def health():
        return {"ok": True, "model": MODEL_REVISION}

    @api.post("/submit")
    async def submit(request: Request):
        if not authorized(request.headers.get("authorization"), key):
            return JSONResponse({"error": "unauthorized"}, 401)
        body = await request.body()
        if len(body) > LIMITS["body"]:
            return JSONResponse({"error": "too_large"}, 413)
        try:
            req = validate(json.loads(body or b"{}"))
        except (BadRequest, ValueError) as err:
            return JSONResponse({"error": "bad_request", "detail": str(err)}, 400)
        call = Voice().render.spawn(req)
        return JSONResponse({"id": call.object_id}, 202)

    @api.get("/result")
    def result(request: Request, id: str = ""):
        if not authorized(request.headers.get("authorization"), key):
            return JSONResponse({"error": "unauthorized"}, 401)
        if not id.startswith("fc-") or len(id) > 64:
            return JSONResponse({"error": "unknown_job"}, 404)
        try:
            audio, kind, meta = modal.FunctionCall.from_id(id).get(timeout=0)
        except TimeoutError:
            return JSONResponse({"status": "pending"}, 202)
        except BadRequest as err:
            return JSONResponse({"error": "bad_request", "detail": str(err)}, 400)
        except Exception:  # noqa: BLE001
            return JSONResponse({"error": "sing_failed"}, 500)
        return Response(audio, media_type=kind, headers={"X-Sing-Meta": json.dumps(meta)})

    return api
