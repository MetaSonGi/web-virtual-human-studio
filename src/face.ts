import type { VRMExpressionManager, VRMExpression } from '@pixiv/three-vrm';

const originalOverrides = new WeakMap<VRMExpression, VRMExpression['overrideMouth']>();
/** Let speech animate the mouth even when an emotion normally overrides it. */
export function updateFace(manager: VRMExpressionManager | undefined, emotion: string, mouth: number, speaking: boolean) {
  if (!manager) return;
  for (const name of ['neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised']) {
    const expression = manager.getExpression(name);
    if (!expression) continue;
    if (!originalOverrides.has(expression)) originalOverrides.set(expression, expression.overrideMouth);
    expression.overrideMouth = speaking ? 'none' : originalOverrides.get(expression)!;
    manager.setValue(name, name === emotion && name !== 'neutral' ? (speaking ? 1 - mouth * 0.8 : 1) : 0);
  }
  manager.setValue('aa', mouth);
}
