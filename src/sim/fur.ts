import type { Design, Part } from '../data/schema/design';
import type { ViabilityRules } from '../data/schema/viability';
import { detPow } from './detmath';

/**
 * 毛长（设计台第 3 步 b，2026-11-02；推导见 MODEL.md"形状：毛长"）。
 *
 * 毛长是体表的第一个连续参数：一条绝对的轴，以 10 为底的对数，短毛 = 0。体表卡是这条轴上的预设点
 * （部件的 fur：短毛 0、厚绒毛 0.301 ≈ 两倍长），设计里写了 shape.fur 就用它，卡只给默认值。
 * 这和腿长、尾长不同：那两个是"比所选部件的一般长多少"，换卡以后还在；毛长是绝对的，换体表卡会把它清掉（设计台负责）。
 *
 * 保温 I = 皮肤和贴身空气层的那一份 s + 毛的那一份 (1 − s) × 毛长倍数（短毛 = 1，Scholander 1950：保温大致随毛厚线性增加）；
 * 一天里有 θ 份能量花在保温上（短毛时），这份开销和保温成反比：能量倍数 = 1 + θ × (1/I − 1)。
 * θ 不单独写数，用厚绒毛卡的效果（0.93）反解，所以两张卡的点上正好是卡原来的数（锚点直接返回，不经过浮点公式）。
 *
 * 推演里还没有气候：毛越长只省不费（毛长的上限限住了能省多少）；冷热的两头只在设计台的冷热试验里预览。
 */

/** 体表卡在毛长轴上的点和它的能量倍数（锚点）。 */
export interface FurAnchor {
  x: number;
  factor: number;
}

/** 兽的体表卡里写了毛长的：它们的点和能量倍数（没有能量效果的就是 1）。 */
export function furAnchors(parts: Iterable<Part>): FurAnchor[] {
  const out: FurAnchor[] = [];
  for (const p of parts) {
    if (p.slot !== 'coat' || p.bodyPlan !== 'mammal' || p.fur === undefined) continue;
    out.push({ x: p.fur, factor: p.effects.find((e) => e.target === 'energy')?.factor ?? 1 });
  }
  return out;
}

/** 设计写的毛长（夹进范围）；没写，或者长羽毛的，返回 undefined：用体表卡自己的效果，和以前逐位相同。 */
export function furOf(design: Design, coat: Part, rules: ViabilityRules): number | undefined {
  const x = design.shape?.fur;
  if (x === undefined || coat.bodyPlan !== 'mammal') return undefined;
  return Math.min(rules.shape.furMax.value, Math.max(rules.shape.furMin.value, x));
}

/** 毛长 x 的保温（短毛 = 1）。 */
export function insulation(x: number, rules: ViabilityRules): number {
  const s = rules.shape.furSkinShare.value;
  return s + (1 - s) * (x === 0 ? 1 : detPow(10, x));
}

/** 短毛时一天里花在保温上的那一份 θ：用离短毛最远的那个锚点反解。 */
export function furHeatShare(anchors: readonly FurAnchor[], rules: ViabilityRules): number {
  let far: FurAnchor | null = null;
  for (const a of anchors) if (a.x !== 0 && (!far || Math.abs(a.x) > Math.abs(far.x))) far = a;
  if (!far) return 0;
  return (far.factor - 1) / (1 / insulation(far.x, rules) - 1);
}

/** 毛长 x 的能量倍数：在体表卡的点上返回卡原来的数，其余按保温的公式。 */
export function furEnergyFactor(x: number, anchors: readonly FurAnchor[], rules: ViabilityRules): number {
  for (const a of anchors) if (a.x === x) return a.factor;
  if (x === 0) return 1;
  return 1 + furHeatShare(anchors, rules) * (1 / insulation(x, rules) - 1);
}
