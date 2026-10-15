import type { Design } from '../data/schema/design';
import { BODY_SYSTEMS, type BodySystem, type ViabilityRules } from '../data/schema/viability';
import { detPow } from './detmath';

/**
 * 体重分配（阶段 3.5）：一具身体的体重分给骨骼、肌肉、消化道、心血管、脂肪（其余是皮、脑、内脏等，不参与分配）。
 *
 * 默认份额按体重缩放（viability.json 的 body，如骨骼 0.061·M^0.09）。玩家给每个系统一个倍数（设计的 allocation），
 * 然后整体按比例缩回原来的总量：多给骨头，别的系统就按比例少一点（此消彼长）。
 * 可行性检查读的是缩回后的"实际倍数"（relative）。
 */

export interface BodyAllocation {
  /** 默认份额（占体重的比例）。 */
  base: Readonly<Record<BodySystem, number>>;
  /** 实际份额。 */
  share: Readonly<Record<BodySystem, number>>;
  /** 实际份额 ÷ 默认份额：检查用这个。不写分配的设计全是 1。 */
  relative: Readonly<Record<BodySystem, number>>;
}

/** 玩家给的倍数，夹在 viability.json 允许的范围里。 */
export function requestedOf(design: Design, rules: ViabilityRules): Record<BodySystem, number> {
  const lo = rules.body.minRelative.value;
  const hi = rules.body.maxRelative.value;
  const out = {} as Record<BodySystem, number>;
  for (const s of BODY_SYSTEMS) out[s] = Math.min(hi, Math.max(lo, design.allocation?.[s] ?? 1));
  return out;
}

export function allocateBody(design: Design, bird: boolean, rules: ViabilityRules): BodyAllocation {
  const laws = bird ? rules.body.bird : rules.body.mammal;
  const req = requestedOf(design, rules);
  const base = {} as Record<BodySystem, number>;
  let baseTotal = 0;
  let reqTotal = 0;
  for (const s of BODY_SYSTEMS) {
    base[s] = laws[s].coef.value * detPow(design.bodyMassKg, laws[s].exp.value);
    baseTotal += base[s];
    reqTotal += base[s] * req[s];
  }
  // 总量不变：按比例缩回。全是 1 时 scale 正好是 1，不引入舍入误差。
  const scale = reqTotal === baseTotal ? 1 : baseTotal / reqTotal;
  const share = {} as Record<BodySystem, number>;
  const relative = {} as Record<BodySystem, number>;
  for (const s of BODY_SYSTEMS) {
    relative[s] = req[s] * scale;
    share[s] = base[s] * relative[s];
  }
  return { base, share, relative };
}
