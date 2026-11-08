import { test, expect } from '@playwright/test';
test('initial state and invalid VRM recovery', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#record')).toBeDisabled();
  await page.locator('#model').setInputFiles({ name: 'bad.vrm', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(page.locator('#status')).toContainText('모델 로드 실패');
  await expect(page.locator('#model')).toBeEnabled(); expect(errors).toEqual([]);
});
test('permission denied is explained', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.goto('/'); await page.locator('#mic').click();
  await expect(page.locator('#status')).toContainText('마이크 권한이 거부');
  await expect(page.locator('#mic')).toBeEnabled();
});
test('real VRM load, mic, recording audio/video, repeat and cleanup', async ({ page }) => {
  test.skip(!process.env.VRM_TEST_MODEL, 'Set VRM_TEST_MODEL to a locally licensed .vrm file');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as any).__streams = [];
    navigator.mediaDevices.getUserMedia = async options => { const stream = await original(options); (window as any).__streams.push(stream); return stream; };
  });
  await page.goto('/');
  await page.locator('#model').setInputFiles(process.env.VRM_TEST_MODEL!);
  await expect(page.locator('#status')).toContainText('모델 준비 완료');
  await page.locator('#mic').click(); await expect(page.locator('#record')).toBeEnabled();
  for (let i = 0; i < 2; i++) {
    await page.locator('#record').click(); await expect(page.locator('#mic')).toBeDisabled();
    await page.waitForTimeout(1400); await page.locator('#stop').click();
    await expect(page.locator('#status')).toContainText('녹화 완료');
    const result = await page.evaluate(async () => {
      const blob = await (await fetch((document.getElementById('download') as HTMLAnchorElement).href)).blob();
      const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('WebM decode failed')); });
      await video.play();
      const decoded = (video as any).captureStream() as MediaStream;
      const result = { size: blob.size, width: video.videoWidth, audio: decoded.getAudioTracks().length, video: decoded.getVideoTracks().length };
      video.pause(); decoded.getTracks().forEach(t => t.stop()); URL.revokeObjectURL(video.src); return result;
    });
    expect(result.size).toBeGreaterThan(1000); expect(result.width).toBeGreaterThan(0); expect(result.audio).toBe(1); expect(result.video).toBe(1);
  }
  await page.locator('#mic').click();
  expect(await page.evaluate(() => (window as any).__streams.every((s: MediaStream) => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  expect(errors).toEqual([]);
});
