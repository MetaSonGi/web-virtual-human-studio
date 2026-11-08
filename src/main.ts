import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { mouthLevel, smooth, webmType } from './signal';
import './style.css';

document.querySelector('#app')!.innerHTML = `
<header><span>VIRTUAL HUMAN / LOCAL STUDIO</span><h1>나만의 아바타 스튜디오</h1><p>모델을 불러오고, 목소리로 움직이고, 영상으로 남기세요.</p></header>
<main><section id="viewport" aria-label="3D 아바타 미리보기"><div id="empty">VRM 모델을 불러오세요<span>드래그로 회전 · 휠로 확대 · 오른쪽 드래그로 이동</span></div></section>
<aside><h2>01 / 아바타</h2><label class="file">VRM 파일 선택<input id="model" type="file" accept=".vrm"></label><p id="modelName">VRM 0.x / 1.0 지원</p>
<p><a href="https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm" target="_blank" rel="noopener noreferrer" style="color:#75dfcc">무료 공식 VRM 샘플 다운로드 ↗</a><br><small>pixiv 제작 테스트 모델 · 다운로드 후 위에서 파일을 선택하세요. <a href="https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models" target="_blank" rel="noopener noreferrer" style="color:#75dfcc">출처</a> · <a href="https://vrm.dev/licenses/1.0/" target="_blank" rel="noopener noreferrer" style="color:#75dfcc">이용 조건</a></small></p>
<label>표정<select id="expression"><option value="neutral">기본</option><option value="happy">기쁨</option><option value="angry">화남</option><option value="sad">슬픔</option><option value="relaxed">편안함</option><option value="surprised">놀람</option></select></label><button id="reset">카메라 초기화</button>
<h2>02 / 목소리</h2><button id="mic">마이크 시작</button><label>입 벌림 감도<input id="gain" type="range" min="1" max="30" value="10"></label><meter id="level" min="0" max="1" value="0" aria-label="입 벌림 수준"></meter>
<h2>03 / 녹화</h2><p>캔버스 영상 + 마이크 음성 · WebM</p><button id="record" disabled>녹화 시작</button><button id="stop" disabled>녹화 종료</button><a id="download" hidden>WebM 다운로드</a><p id="timer">00:00</p>
<p id="status" role="status" aria-live="polite">준비되었습니다. 모델 파일은 서버로 전송되지 않습니다.</p><small>모델의 이용·방송·상업적 사용 조건을 먼저 확인하세요.</small></aside></main>`;
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const micButton = el<HTMLButtonElement>('mic'), recordButton = el<HTMLButtonElement>('record'), stopButton = el<HTMLButtonElement>('stop');
const fileInput = el<HTMLInputElement>('model'), expression = el<HTMLSelectElement>('expression');
const status = (message: string) => { el('status').textContent = message; };
const errorText = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '마이크 권한이 거부되었습니다. 브라우저 사이트 권한에서 허용하세요.';
    if (error.name === 'NotFoundError') return '사용 가능한 마이크가 없습니다.';
    if (error.name === 'NotReadableError') return '마이크를 사용할 수 없습니다. 다른 앱의 사용 여부를 확인하세요.';
  }
  return error instanceof Error ? error.message : String(error);
};

async function boot() {
  const viewport = el('viewport');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewport.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#151d2b');
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  controls.minDistance = 0.2; controls.maxDistance = 20;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x596179, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(1, 3, 3); scene.add(key);
  const grid = new THREE.GridHelper(10, 20, 0x46566c, 0x293345); scene.add(grid);
  let vrm: VRM | undefined, disposed = false, loading = false;
  let micStream: MediaStream | undefined, audio: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, analyser: AnalyserNode | undefined;
  let samples = new Float32Array(1024), mouth = 0, pendingMic = false;
  let recorder: MediaRecorder | undefined, recordingStream: MediaStream | undefined, downloadURL: string | undefined, started = 0;
  const download = el<HTMLAnchorElement>('download');
  const syncButtons = () => {
    const busy = !!recorder;
    recordButton.disabled = !vrm || !micStream || busy || loading || pendingMic;
    stopButton.disabled = !recorder || recorder.state !== 'recording';
    micButton.disabled = busy || pendingMic;
    fileInput.disabled = busy || loading;
  };
  const resetCamera = () => {
    const box = vrm ? new THREE.Box3().setFromObject(vrm.scene) : new THREE.Box3(new THREE.Vector3(-0.5,0,-0.5),new THREE.Vector3(0.5,1.8,0.5));
    const center = box.getCenter(new THREE.Vector3()); const size = box.getSize(new THREE.Vector3());
    const distance = Math.max(size.y, size.x / camera.aspect, 0.5) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.25;
    controls.target.copy(center); camera.position.set(center.x, center.y, center.z + distance); controls.update();
  };
  el('reset').onclick = resetCamera; resetCamera();
  const resize = new ResizeObserver(() => {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    // Keep encoder dimensions stable during recording.
    if (recorder) return;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }); resize.observe(viewport);
  const loader = new GLTFLoader(); loader.register(parser => new VRMLoaderPlugin(parser));
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]; if (!file || loading || recorder) return;
    if (!file.name.toLowerCase().endsWith('.vrm')) { status('확장자가 .vrm인 파일을 선택하세요.'); return; }
    loading = true; syncButtons(); status('모델을 불러오는 중입니다…');
    let candidate: VRM | undefined;
    try {
      const gltf = await loader.parseAsync(await file.arrayBuffer(), '');
      candidate = gltf.userData.vrm as VRM | undefined;
      if (!candidate) { VRMUtils.deepDispose(gltf.scene); throw new Error('유효한 VRM 모델이 아닙니다.'); }
      if (disposed) { VRMUtils.deepDispose(candidate.scene); return; }
      VRMUtils.rotateVRM0(candidate);
      candidate.scene.traverse(object => { object.frustumCulled = false; });
      if (vrm) { scene.remove(vrm.scene); VRMUtils.deepDispose(vrm.scene); }
      vrm = candidate; scene.add(vrm.scene); resetCamera();
      el('empty').hidden = true; el('modelName').textContent = file.name;
      const supported = vrm.expressionManager?.expressionMap ?? {};
      for (const option of expression.options) option.disabled = option.value !== 'neutral' && !(option.value in supported);
      expression.value = 'neutral'; status('모델 준비 완료. 마이크를 시작하세요.');
    } catch (e) { status(`모델 로드 실패: ${errorText(e)}`); }
    finally { loading = false; fileInput.value = ''; syncButtons(); }
  };
  function releaseMic() {
    source?.disconnect(); analyser?.disconnect(); micStream?.getTracks().forEach(t => t.stop());
    if (audio) void audio.close().catch(() => {});
    source = undefined; analyser = undefined; micStream = undefined; audio = undefined;
    micButton.textContent = '마이크 시작'; syncButtons();
  }
  micButton.onclick = async () => {
    if (micStream) { releaseMic(); status('마이크가 꺼졌습니다.'); return; }
    pendingMic = true; syncButtons();
    try {
      if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('마이크는 HTTPS 또는 localhost에서 사용할 수 있습니다.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (disposed) { stream.getTracks().forEach(t => t.stop()); return; }
      micStream = stream; audio = new AudioContext(); await audio.resume();
      if (disposed) { releaseMic(); return; }
      source = audio.createMediaStreamSource(stream); analyser = audio.createAnalyser(); analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize); source.connect(analyser);
      // No connection to speakers: prevents microphone feedback.
      stream.getAudioTracks()[0].onended = () => { if (recorder?.state === 'recording') recorder.stop(); releaseMic(); status('마이크 연결이 종료되었습니다.'); };
      micButton.textContent = '마이크 종료'; status('마이크 활성화. 말하면 입이 움직입니다.');
    } catch (e) { releaseMic(); status(errorText(e)); }
    finally { pendingMic = false; syncButtons(); }
  };
  function releaseRecording() {
    recordingStream?.getTracks().forEach(t => t.stop()); recordingStream = undefined; recorder = undefined;
    syncButtons();
    if (!disposed) { renderer.setSize(viewport.clientWidth, viewport.clientHeight); camera.aspect = viewport.clientWidth / viewport.clientHeight; camera.updateProjectionMatrix(); }
  }
  recordButton.onclick = () => {
    if (!vrm || !micStream || recorder) return;
    try {
      if (typeof MediaRecorder === 'undefined' || !renderer.domElement.captureStream) throw new Error('이 브라우저는 캔버스 녹화를 지원하지 않습니다. 최신 Chrome/Edge를 사용하세요.');
      const mimeType = webmType(t => MediaRecorder.isTypeSupported(t));
      if (!mimeType) throw new Error('이 브라우저는 WebM 녹화를 지원하지 않습니다.');
      const video = renderer.domElement.captureStream(30); recordingStream = video;
      for (const track of micStream.getAudioTracks()) recordingStream.addTrack(track.clone());
      recorder = new MediaRecorder(recordingStream, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = []; let failed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { failed = true; status('녹화 오류가 발생했습니다. 다시 시도하세요.'); if (recorder?.state !== 'inactive') recorder?.stop(); };
      recorder.onstop = () => {
        if (!disposed && !failed && chunks.length) {
          if (downloadURL) URL.revokeObjectURL(downloadURL);
          downloadURL = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
          download.href = downloadURL; download.download = `virtual-human-${Date.now()}.webm`; download.hidden = false;
          status('녹화 완료. WebM 다운로드를 눌러 저장하세요.');
        }
        releaseRecording();
      };
      recorder.start(1000); started = performance.now(); syncButtons(); status('녹화 중 · 마이크 음성이 함께 저장됩니다.');
    } catch (e) { releaseRecording(); status(errorText(e)); }
  };
  stopButton.onclick = () => { if (recorder?.state === 'recording') { recorder.stop(); stopButton.disabled = true; status('녹화를 마무리하는 중입니다…'); } };
  const clock = new THREE.Clock(); let frame = 0;
  function animate() {
    if (disposed) return;
    frame = requestAnimationFrame(animate); const delta = Math.min(clock.getDelta(), 0.1);
    let target = 0;
    if (analyser) { analyser.getFloatTimeDomainData(samples); target = mouthLevel(samples, Number(el<HTMLInputElement>('gain').value)); }
    mouth = smooth(mouth, target, delta); el<HTMLMeterElement>('level').value = mouth;
    if (vrm) {
      const manager = vrm.expressionManager;
      for (const option of expression.options) manager?.setValue(option.value, option.value === expression.value && option.value !== 'neutral' ? 1 : 0);
      manager?.setValue('aa', mouth); vrm.update(delta);
    }
    if (recorder?.state === 'recording') { const seconds = Math.floor((performance.now() - started) / 1000); el('timer').textContent = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
    controls.update(); renderer.render(scene, camera);
  } animate();
  function cleanup() {
    disposed = true; cancelAnimationFrame(frame); resize.disconnect();
    if (recorder?.state === 'recording') recorder.stop();
    releaseMic(); releaseRecording(); if (downloadURL) URL.revokeObjectURL(downloadURL);
    controls.dispose(); if (vrm) VRMUtils.deepDispose(vrm.scene);
    grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); renderer.dispose();
  }
  window.addEventListener('pagehide', cleanup, { once: true });
}
void boot().catch(e => status(`3D 초기화 실패: ${errorText(e)}. WebGL 지원 여부를 확인하세요.`));
