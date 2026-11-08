import { it, expect } from 'vitest';
import { VRMExpression, VRMExpressionManager } from '@pixiv/three-vrm';
import { updateFace } from './face';

it('keeps actual mouth morph active under surprised/happy override and restores model settings', () => {
  const manager = new VRMExpressionManager();
  const aa = new VRMExpression('aa'); let applied = 0;
  aa.addBind({ applyWeight: weight => { applied += weight; }, clearAppliedWeight: () => { applied = 0; } });
  manager.registerExpression(aa);
  for (const name of ['surprised','happy']) {
    const emotion = new VRMExpression(name); emotion.overrideMouth = 'blend'; manager.registerExpression(emotion);
  }
  for (const name of ['surprised','happy']) {
    updateFace(manager, name, 0.6, true); manager.update();
    expect(applied).toBeCloseTo(0.6);
    updateFace(manager, name, 0, false); manager.update();
    expect(applied).toBe(0); expect(manager.getExpression(name)!.overrideMouth).toBe('blend');
  }
});
