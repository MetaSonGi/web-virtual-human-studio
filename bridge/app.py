"""Local VRM -> Pixelle-Video digital-human bridge. No model API keys in browser."""
from __future__ import annotations

import argparse
import asyncio
import base64
from contextlib import asynccontextmanager
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field
import yaml

VOICES = {"ko-KR-SunHiNeural", "ko-KR-InJoonNeural"}


class GenerationInput(BaseModel):
    image: str = Field(max_length=6_000_000)
    script: str = Field(min_length=1, max_length=1000)
    voice: str = "ko-KR-SunHiNeural"


class PixelleAdapter:
    def __init__(self, home: Path | None):
        self.home = home.resolve() if home else None
        self.workflow = os.environ.get("PIXELLE_WORKFLOW", "runninghub/digital_customize.json")
        self.core = None

    def health(self):
        missing = []
        if not self.home or not (self.home / "pixelle_video").is_dir():
            missing.append("PIXELLE_HOME에 공식 Pixelle-Video 소스 폴더를 지정하세요.")
        else:
            config_path = self.home / "config.yaml"
            workflow_path = self.home / "workflows" / self.workflow
            if not workflow_path.is_file():
                missing.append("디지털 휴먼 워크플로 파일을 찾을 수 없습니다.")
            if not config_path.is_file():
                missing.append("Pixelle-Video config.yaml에 생성 서비스 설정이 필요합니다.")
            else:
                try:
                    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
                    workflow = json.loads(workflow_path.read_text(encoding="utf-8")) if workflow_path.is_file() else {}
                    comfy = config.get("comfyui", {})
                    if workflow.get("source") == "runninghub" and not comfy.get("runninghub_api_key"):
                        missing.append("Pixelle-Video 설정에 RunningHub API 키가 필요합니다.")
                    elif workflow.get("source") != "runninghub" and not comfy.get("comfyui_url"):
                        missing.append("로컬 ComfyUI 주소와 디지털 휴먼 워크플로를 설정하세요.")
                except (ValueError, yaml.YAMLError, AttributeError):
                    missing.append("Pixelle-Video 설정 또는 워크플로 형식을 확인하세요.")
        return {"service": "vrm-pixelle-bridge", "ready": not missing, "missing": missing,
                "workflow": self.workflow, "note": "구성 확인 결과입니다. 모델 연결과 생성 성공은 요청 실행 시 확인됩니다."}

    async def generate(self, image: Path, script: str, voice: str, folder: Path, progress):
        from pixelle_video import pixelle_video
        import httpx
        self.core = pixelle_video
        await self.core.initialize()
        progress("speech", "한국어 음성을 만드는 중입니다…")
        audio_path = folder / "narration.mp3"
        await self.core.tts(text=script, inference_mode="local", voice=voice, speed=1.0,
                            output_path=str(audio_path))
        progress("rendering", "캐릭터 영상 생성 중입니다. 수 분 이상 걸릴 수 있습니다…")
        workflow_path = self.home / "workflows" / self.workflow
        workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
        workflow_input = workflow["workflow_id"] if workflow.get("source") == "runninghub" else json.dumps(workflow)
        kit = await self.core._get_or_create_comfykit()
        result = await kit.execute(workflow_input, {"videoimage": str(image), "audio": str(audio_path)})
        urls = getattr(result, "videos", None)
        if not urls:
            for output in (getattr(result, "outputs", None) or {}).values():
                if isinstance(output, dict) and output.get("videos"):
                    urls = output["videos"]
                    break
        if not urls or not isinstance(urls[0], str):
            raise RuntimeError("생성 워크플로에서 영상 경로를 반환하지 않았습니다.")
        progress("downloading", "생성한 영상을 가져오는 중입니다…")
        target = folder / "result.mp4"
        source = urls[0]
        if source.startswith(("https://", "http://")):
            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                async with client.stream("GET", source) as response:
                    response.raise_for_status()
                    size = 0
                    with target.open("wb") as destination:
                        async for chunk in response.aiter_bytes():
                            size += len(chunk)
                            if size > 500_000_000:
                                raise RuntimeError("생성 영상이 500MB 제한을 초과했습니다.")
                            destination.write(chunk)
        else:
            import shutil
            source_path = Path(source).resolve()
            if not source_path.is_file():
                raise RuntimeError("생성 영상 파일을 찾을 수 없습니다.")
            shutil.copyfile(source_path, target)
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError("생성 영상이 비어 있습니다.")
        return target

    async def close(self):
        if self.core:
            await self.core.cleanup()


def create_app(adapter=None, output: Path | None = None):
    adapter = adapter or PixelleAdapter(Path(os.environ["PIXELLE_HOME"]) if os.environ.get("PIXELLE_HOME") else None)
    root = (output or Path(__file__).resolve().parent / ".jobs").resolve()
    root.mkdir(parents=True, exist_ok=True)
    jobs: dict[str, dict] = {}
    tasks: dict[str, asyncio.Task] = {}
    for file in root.glob("*/job.json"):
        try:
            job = json.loads(file.read_text(encoding="utf-8"))
            if job.get("state") not in {"completed", "failed", "cancelled"}:
                job.update(state="failed", message="서버가 재시작되어 생성이 중단됐습니다. 다시 요청하세요.")
            jobs[file.parent.name] = job
        except (ValueError, OSError):
            continue

    def persist(job_id):
        (root / job_id / "job.json").write_text(json.dumps(jobs[job_id], ensure_ascii=False), encoding="utf-8")

    @asynccontextmanager
    async def lifespan(app):
        yield
        for task in tasks.values():
            task.cancel()
        await asyncio.gather(*tasks.values(), return_exceptions=True)
        await adapter.close()

    app = FastAPI(title="VRM Pixelle bridge", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]"])
    origins = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 5174, 4173, 8787)]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Studio-Request"])

    @app.middleware("http")
    async def check_origin(request: Request, call_next):
        if request.method in {"POST", "DELETE"} and request.headers.get("origin") and request.headers["origin"] not in origins:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "허용되지 않은 요청 출처입니다."}, status_code=403)
        return await call_next(request)

    def lookup(job_id):
        if job_id not in jobs:
            raise HTTPException(404, "생성 작업을 찾을 수 없습니다.")
        return jobs[job_id]

    @app.get("/api/health")
    async def health():
        return adapter.health()

    @app.post("/api/jobs", status_code=202)
    async def generate(body: GenerationInput):
        health = adapter.health()
        if not health["ready"]:
            raise HTTPException(503, " ".join(health["missing"]))
        if any(not task.done() for task in tasks.values()):
            raise HTTPException(409, "이미 생성 중인 작업이 있습니다. 완료 후 다시 요청하세요.")
        if not body.script.strip() or body.voice not in VOICES:
            raise HTTPException(422, "대본 또는 한국어 음성을 확인하세요.")
        try:
            if not body.image.startswith("data:image/png;base64,"):
                raise ValueError("PNG 캡처가 필요합니다.")
            data = base64.b64decode(body.image.split(",", 1)[1], validate=True)
            if len(data) > 4_000_000:
                raise ValueError("캡처 이미지가 너무 큽니다.")
            with Image.open(BytesIO(data)) as image:
                if image.format != "PNG" or image.width > 4096 or image.height > 4096:
                    raise ValueError("4096px 이하의 PNG를 사용하세요.")
                image.verify()
        except Exception as error:
            raise HTTPException(422, "유효한 캐릭터 PNG 캡처를 다시 만들어 주세요.") from error
        job_id = uuid.uuid4().hex
        folder = root / job_id
        folder.mkdir()
        image_path = folder / "character.png"
        image_path.write_bytes(data)
        (folder / "script.txt").write_text(body.script.strip(), encoding="utf-8")
        jobs[job_id] = {"id": job_id, "state": "queued", "message": "영상 생성을 준비합니다."}
        persist(job_id)

        def progress(state, message):
            jobs[job_id].update(state=state, message=message)
            persist(job_id)

        async def run():
            try:
                async with asyncio.timeout(1800):
                    await adapter.generate(image_path, body.script.strip(), body.voice, folder, progress)
                progress("completed", "AI 캐릭터 영상 생성이 완료됐습니다.")
            except asyncio.CancelledError:
                progress("cancelled", "대기를 중단했습니다. 외부 서비스 작업은 계속 실행되거나 과금될 수 있습니다.")
                raise
            except Exception:
                # Provider exceptions may contain signed URLs or secrets. Never send them to the browser.
                progress("failed", "영상 생성에 실패했습니다. Pixelle-Video의 서비스 설정·잔액·워크플로·네트워크를 확인하세요.")
        tasks[job_id] = asyncio.create_task(run())
        return jobs[job_id].copy()

    @app.get("/api/jobs/{job_id}")
    async def job_status(job_id: str):
        return lookup(job_id)

    @app.delete("/api/jobs/{job_id}")
    async def cancel(job_id: str):
        job = lookup(job_id)
        task = tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            if job["state"] not in {"completed", "failed", "cancelled"}:
                job.update(state="cancelled", message="대기를 중단했습니다. 외부 서비스 작업은 계속 실행되거나 과금될 수 있습니다.")
                persist(job_id)
        return job

    @app.get("/api/jobs/{job_id}/video")
    async def video(job_id: str):
        job = lookup(job_id)
        file = root / job_id / "result.mp4"
        if job["state"] != "completed" or not file.is_file():
            raise HTTPException(409, "생성 영상이 아직 준비되지 않았습니다.")
        return FileResponse(file, media_type="video/mp4", filename=f"character-{job_id}.mp4")
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pixelle-home", type=Path)
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    if args.pixelle_home:
        home = args.pixelle_home.resolve()
        os.environ["PIXELLE_HOME"] = str(home)
        sys.path.insert(0, str(home))
        os.chdir(home)  # Upstream resolves config.yaml, workflows and templates against cwd.
    elif os.environ.get("PIXELLE_HOME"):
        home = Path(os.environ["PIXELLE_HOME"]).resolve()
        sys.path.insert(0, str(home))
        os.chdir(home)
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port)
