type Job = { id: string; state: string; message: string };
const END = new Set(['completed', 'failed', 'cancelled']);

export function mountPixelle(canvas: HTMLCanvasElement, ready: () => boolean, render: () => void) {
  const panel = document.createElement('section'); panel.className = 'ai-panel';
  panel.innerHTML = `<h2>04 / AI 캐릭터 영상</h2><p>캐릭터 캡처 + 대본 → Pixelle-Video</p>
  <button id="ai-capture" disabled>현재 캐릭터 캡처</button><img id="ai-image" alt="AI 영상에 사용할 캐릭터 캡처" hidden><a id="ai-image-download" hidden>캡처 PNG 저장</a>
  <label>캐릭터가 말할 대본<textarea id="ai-script" maxlength="1000" rows="4" placeholder="안녕하세요. 저의 버추얼 스튜디오에 오신 것을 환영합니다."></textarea></label>
  <label>한국어 음성<select id="ai-voice"><option value="ko-KR-SunHiNeural">선히 · 여성</option><option value="ko-KR-InJoonNeural">인준 · 남성</option></select></label>
  <button id="ai-check">Pixelle 연결 확인</button><button id="ai-generate" disabled>AI 영상 생성</button><button id="ai-cancel" hidden>생성 대기 중단</button>
  <p id="ai-state" role="status" aria-live="polite">캐릭터를 캡처하고 Pixelle 연결을 확인하세요.</p>
  <video id="ai-result" controls playsinline hidden></video><a id="ai-download" hidden>생성 영상 MP4 다운로드</a>
  <small>생성 버튼을 누르면 캡처와 대본을 로컬 Pixelle 서버로 전송합니다. 설정된 TTS·생성 서비스에도 전달되며 서비스 비용이 발생할 수 있습니다. 3D 모델 자체는 전송하지 않습니다.</small>`;
  document.querySelector('aside')!.append(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>(`#${id}`)!;
  const capture = get<HTMLButtonElement>('ai-capture'), generate = get<HTMLButtonElement>('ai-generate'), check = get<HTMLButtonElement>('ai-check');
  const cancel = get<HTMLButtonElement>('ai-cancel'), script = get<HTMLTextAreaElement>('ai-script'), voice = get<HTMLSelectElement>('ai-voice');
  const image = get<HTMLImageElement>('ai-image'), imageDownload = get<HTMLAnchorElement>('ai-image-download');
  const video = get<HTMLVideoElement>('ai-result'), download = get<HTMLAnchorElement>('ai-download');
  const say = (text: string) => { get('ai-state').textContent = text; };
  let snapshot = '', connected = false, busy = false, disposed = false, timer: ReturnType<typeof setTimeout> | undefined, jobId: string | undefined;
  const requests = new Set<AbortController>();
  function refresh() {
    capture.disabled = !ready() || busy; generate.disabled = !snapshot || !script.value.trim() || !connected || busy;
    script.disabled = busy; voice.disabled = busy; check.disabled = busy; cancel.hidden = !busy;
  }
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/pixelle-api/api${path}`, { ...init, signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', ...init.headers } });
      if (!response.ok) {
        let detail: string | undefined;
        try { const body = await response.json(); if (typeof body.detail === 'string') detail = body.detail; } catch { /* Non-JSON proxy failure */ }
        throw new Error(detail ?? 'Pixelle 연결 서버를 사용할 수 없습니다. bridge/app.py를 먼저 실행하세요.');
      }
      return await response.json() as T;
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function errorMessage(error: unknown) {
    return error instanceof Error && error.name !== 'AbortError' ? error.message : '서버 응답이 늦거나 연결이 중단됐습니다. 연결 확인 후 다시 시도하세요.';
  }
  capture.onclick = () => {
    try {
      render();
      const output = document.createElement('canvas');
      const scale = Math.min(1, 1536 / Math.max(canvas.width, canvas.height));
      output.width = Math.round(canvas.width * scale); output.height = Math.round(canvas.height * scale);
      output.getContext('2d')!.drawImage(canvas, 0, 0, output.width, output.height);
      snapshot = output.toDataURL('image/png'); image.src = snapshot; image.hidden = false;
      imageDownload.href = snapshot; imageDownload.download = 'vrm-character.png'; imageDownload.hidden = false;
      say('캡처했습니다. 얼굴이 잘 보이지 않으면 카메라를 확대하고 다시 캡처하세요.'); refresh();
    } catch (e) { say(`캡처 실패: ${errorMessage(e)}`); }
  };
  script.oninput = refresh;
  async function checkConnection() {
    check.disabled = true;
    try {
      const health = await request<{ ready: boolean; missing: string[] }>('/health');
      connected = health.ready;
      say(connected ? 'Pixelle 구성이 확인됐습니다. 캡처와 대본을 준비한 뒤 생성하세요.' : health.missing.join(' '));
    } catch (e) { connected = false; say(errorMessage(e)); }
    finally { if (!disposed) refresh(); }
  }
  check.onclick = checkConnection;
  async function poll() {
    if (!jobId || disposed) return;
    try {
      const job = await request<Job>(`/jobs/${jobId}`); say(job.message);
      if (END.has(job.state)) {
        busy = false; refresh();
        if (job.state === 'completed') {
          const url = `/pixelle-api/api/jobs/${jobId}/video`;
          video.src = url; video.hidden = false; download.href = url; download.download = `character-${jobId}.mp4`; download.hidden = false;
        }
        try { localStorage.removeItem('pixelle-job'); } catch { /* storage optional */ }
        return;
      }
      timer = setTimeout(poll, 1500);
    } catch (e) {
      say(`${errorMessage(e)} 작업은 서버에서 계속될 수 있습니다. 연결되면 상태를 다시 확인합니다.`);
      timer = setTimeout(poll, 5000);
    }
  }
  generate.onclick = async () => {
    if (!snapshot || !connected || busy || !script.value.trim()) return;
    busy = true; refresh(); say('생성 요청을 전송합니다…'); video.hidden = true; download.hidden = true;
    try {
      const job = await request<Job>('/jobs', { method: 'POST', body: JSON.stringify({ image: snapshot, script: script.value.trim(), voice: voice.value }) });
      jobId = job.id; try { localStorage.setItem('pixelle-job', jobId); } catch { /* storage optional */ }
      await poll();
    } catch (e) { busy = false; refresh(); say(errorMessage(e)); }
  };
  cancel.onclick = async () => {
    if (!jobId) return;
    if (timer) clearTimeout(timer); cancel.disabled = true;
    try {
      const job = await request<Job>(`/jobs/${jobId}`, { method: 'DELETE' }); say(job.message); busy = false;
      try { localStorage.removeItem('pixelle-job'); } catch { /* storage optional */ }
    } catch (e) { say(errorMessage(e)); timer = setTimeout(poll, 1500); }
    finally { cancel.disabled = false; refresh(); }
  };
  try { jobId = localStorage.getItem('pixelle-job') ?? undefined; if (jobId && /^[a-f0-9]{32}$/.test(jobId)) { busy = true; void poll(); } } catch { /* storage optional */ }
  refresh();
  return { refresh, dispose() { disposed = true; if (timer) clearTimeout(timer); requests.forEach(r => r.abort()); video.pause(); video.removeAttribute('src'); image.removeAttribute('src'); snapshot = ''; } };
}
