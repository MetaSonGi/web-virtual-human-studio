export function mouthLevel(samples: Float32Array, gain: number): number {
  if (!samples.length) return 0;
  const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
  return Math.min(1, Math.max(0, (rms - 0.012) * gain));
}
export function smooth(current: number, target: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-18 * Math.max(0, delta)));
}
export function webmType(supported: (type: string) => boolean): string | undefined {
  return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(supported);
}
