import { describe, it, expect } from 'vitest';
import { mouthLevel, smooth, webmType } from './signal';
describe('audio envelope', () => {
  it('rejects noise and clamps loud input', () => {
    expect(mouthLevel(new Float32Array(), 10)).toBe(0);
    expect(mouthLevel(new Float32Array([0.01,-0.01]), 10)).toBe(0);
    expect(mouthLevel(new Float32Array([1,-1]), 10)).toBe(1);
    expect(mouthLevel(new Float32Array([0.1,-0.1]), 5)).toBeCloseTo(0.44);
  });
  it('smooths independently of frame partition', () => {
    expect(smooth(smooth(0,1,0.02),1,0.02)).toBeCloseTo(smooth(0,1,0.04));
    expect(smooth(1,0,1)).toBeLessThan(0.001);
  });
  it('selects supported WebM or fails explicitly', () => {
    expect(webmType(t => t === 'video/webm')).toBe('video/webm');
    expect(webmType(() => false)).toBeUndefined();
  });
});
