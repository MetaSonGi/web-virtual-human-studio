import asyncio
import base64
from io import BytesIO
from pathlib import Path
import sys

from fastapi.testclient import TestClient
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent))
from app import create_app, PixelleAdapter


def capture():
    buffer = BytesIO()
    Image.new("RGB", (32, 32)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


class Adapter:
    def health(self):
        return {"ready": True, "missing": []}

    async def generate(self, image, script, voice, folder, progress):
        assert image.read_bytes().startswith(b"\x89PNG")
        assert script == "안녕하세요"
        progress("rendering", "test generation")
        await asyncio.sleep(0.01)
        (folder / "result.mp4").write_bytes(b"test-only-video-fixture")

    async def close(self):
        pass


def test_unconfigured(tmp_path):
    with TestClient(create_app(PixelleAdapter(None), tmp_path), base_url="http://localhost") as client:
        assert client.get("/api/health").json()["ready"] is False
        assert client.post("/api/jobs", json={"image": capture(), "script": "hello"}).status_code == 503


def test_validation_and_origin(tmp_path):
    with TestClient(create_app(Adapter(), tmp_path), base_url="http://localhost") as client:
        assert client.post("/api/jobs", json={"image": "bad", "script": "hello"}).status_code == 422
        assert client.post("/api/jobs", json={"image": capture(), "script": " "}).status_code == 422
        assert client.post("/api/jobs", json={"image": capture(), "script": "hello", "voice": "unknown"}).status_code == 422
        assert client.post("/api/jobs", headers={"Origin": "https://other.example"}, json={"image": capture(), "script": "hello"}).status_code == 403


def test_job_result_and_restart(tmp_path):
    import time
    with TestClient(create_app(Adapter(), tmp_path), base_url="http://localhost") as client:
        result = client.post("/api/jobs", json={"image": capture(), "script": "안녕하세요"})
        assert result.status_code == 202
        job_id = result.json()["id"]
        for _ in range(50):
            job = client.get(f"/api/jobs/{job_id}").json()
            if job["state"] == "completed":
                break
            time.sleep(.01)
        assert job["state"] == "completed"
        assert client.get(f"/api/jobs/{job_id}/video").content == b"test-only-video-fixture"
        assert client.get("/api/jobs/nonexistent/video").status_code == 404
    with TestClient(create_app(Adapter(), tmp_path), base_url="http://localhost") as client:
        assert client.get(f"/api/jobs/{job_id}").json()["state"] == "completed"


def test_cancel_and_provider_error_redaction(tmp_path):
    class Slow(Adapter):
        async def generate(self, *args):
            await asyncio.sleep(30)
    with TestClient(create_app(Slow(), tmp_path), base_url="http://localhost") as client:
        job_id = client.post("/api/jobs", json={"image": capture(), "script": "안녕하세요"}).json()["id"]
        assert client.delete(f"/api/jobs/{job_id}").json()["state"] == "cancelled"
    class Broken(Adapter):
        async def generate(self, *args):
            raise RuntimeError("provider-secret-not-for-browser")
    import time
    with TestClient(create_app(Broken(), tmp_path / "errors"), base_url="http://localhost") as client:
        job_id = client.post("/api/jobs", json={"image": capture(), "script": "안녕하세요"}).json()["id"]
        for _ in range(50):
            response = client.get(f"/api/jobs/{job_id}")
            if response.json()["state"] == "failed":
                break
            time.sleep(.01)
        assert response.json()["state"] == "failed"
        assert "provider-secret" not in response.text


def test_pixelle_sdk_adapter_contract(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import json
    home = tmp_path / "pixelle"
    (home / "pixelle_video").mkdir(parents=True)
    workflow = home / "workflows" / "runninghub" / "digital_customize.json"
    workflow.parent.mkdir(parents=True)
    workflow.write_text(json.dumps({"source": "runninghub", "workflow_id": "test-workflow"}))
    (home / "config.yaml").write_text("comfyui:\n  runninghub_api_key: test-only\n")
    image = tmp_path / "character.png"
    image.write_bytes(base64.b64decode(capture().split(",")[1]))
    generated = tmp_path / "provider-result.mp4"
    generated.write_bytes(b"sdk-contract-fixture")
    calls = []
    async def initialize():
        calls.append("initialize")
    async def tts(**kwargs):
        assert kwargs["text"] == "안녕하세요"
        assert kwargs["voice"] == "ko-KR-SunHiNeural"
        Path(kwargs["output_path"]).write_bytes(b"tts-fixture")
    async def execute(workflow_id, inputs):
        assert workflow_id == "test-workflow"
        assert inputs["videoimage"] == str(image)
        assert Path(inputs["audio"]).is_file()
        return SimpleNamespace(videos=[str(generated)])
    async def kit():
        return SimpleNamespace(execute=execute)
    core = SimpleNamespace(initialize=initialize, tts=tts, _get_or_create_comfykit=kit)
    monkeypatch.setitem(sys.modules, "pixelle_video", SimpleNamespace(pixelle_video=core))
    adapter = PixelleAdapter(home)
    assert adapter.health()["ready"] is True
    states = []
    result = asyncio.run(adapter.generate(image, "안녕하세요", "ko-KR-SunHiNeural", tmp_path, lambda state, message: states.append(state)))
    assert result.read_bytes() == b"sdk-contract-fixture"
    assert states == ["speech", "rendering", "downloading"]
    assert calls == ["initialize"]
