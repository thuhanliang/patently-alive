import type { Design, Part, Slot } from '../data/schema/design';
import type { ViabilityRules } from '../data/schema/viability';
import { detPow } from './detmath';
import { furOf, insulation } from './fur';

/**
 * 冷热（设计台的冷热试验，2026-11-02；推导见 MODEL.md"冷热试验"）。只给预览：要气候输入，推演和编译结果不读它。
 *
 * Scholander–Irving 的体温调节模型，都以基础代谢为单位：
 * - δ = 体温和"不用多产热也保得住体温"的气温之差 = delta0 × (体重 / 4 千克)^massExp × 保温（保温见 fur.ts，短毛 = 1）；
 * - 冷的一头：静息时要产的热 = (体温 − 气温) / δ，超过 coldStrained 就一直在发抖；
 * - 热的一头：动起来产 activeHeat 的热，干散热最多 vasoFactor × (体温 − 气温) / δ（气温高过体温时是负的：反过来吸热），
 *   剩下的要靠喘、出汗蒸发掉，超过 heatStrained 就喘得厉害。
 * 毛长了冷的一头好过、热的一头难过；个子大了一样（δ 随体重变大）。耳的面积以后从热的一头的干散热里分出去。
 */

export interface ThermalLoad {
  tempC: number;
  /** δ（°C）。 */
  delta: number;
  /** 静息时保体温要产的热（基础代谢的倍数）。 */
  coldLoad: number;
  /** 动起来时要蒸发掉的热（基础代谢的倍数，负的是不用蒸发）。 */
  heatLoad: number;
  /** 等级按哪一头：冷的一头（true）还是热的一头。 */
  cold: boolean;
  grade: 'ok' | 'strained' | 'failing' | 'fatal';
  /** 余量：1 以上没问题（冷：coldStrained ÷ 静息产热；热：干散热 ÷ (activeHeat − heatStrained)）。 */
  margin: number;
  /** 冷的时候比动起来本来就产的热还要多产几成（第 3 步 c 的饭量用）；不冷是 0。 */
  extraHeat: number;
}

const gradeOf = (x: number, s: number, f: number, F: number): ThermalLoad['grade'] => (x > F ? 'fatal' : x > f ? 'failing' : x > s ? 'strained' : 'ok');
const RANK = { ok: 0, strained: 1, failing: 2, fatal: 3 } as const;

export function thermalLoad(ctx: { design: Design; parts: Readonly<Record<Slot, Part>>; bird: boolean; rules: ViabilityRules }, tempC: number): ThermalLoad {
  const r = ctx.rules.thermal;
  const tb = ctx.bird ? r.bodyTempBird.value : r.bodyTempMammal.value;
  const fur = furOf(ctx.design, ctx.parts.coat, ctx.rules) ?? ctx.parts.coat.fur ?? 0;
  const ins = ctx.bird ? r.birdInsulation.value : insulation(fur, ctx.rules);
  const delta = r.delta0.value * detPow(ctx.design.bodyMassKg / 4, r.massExp.value) * ins;
  const gap = tb - tempC;
  const coldLoad = Math.max(0, gap) / delta;
  const dry = (r.vasoFactor.value * gap) / delta;
  const heatLoad = r.activeHeat.value - dry;
  const cg = gradeOf(coldLoad, r.coldStrained.value, r.coldFailing.value, r.coldFatal.value);
  const hg = gradeOf(heatLoad, r.heatStrained.value, r.heatFailing.value, r.heatFatal.value);
  const coldMargin = coldLoad > 0 ? r.coldStrained.value / coldLoad : Infinity;
  const heatMargin = Math.max(0, dry) / (r.activeHeat.value - r.heatStrained.value);
  // 哪一头更重按哪一头；都没问题时按余量小的那一头（冷还是热，决定说明里写哪一个）。
  const cold = RANK[cg] !== RANK[hg] ? RANK[cg] > RANK[hg] : coldMargin <= heatMargin;
  return {
    tempC,
    delta,
    coldLoad,
    heatLoad,
    cold,
    grade: cold ? cg : hg,
    margin: Math.min(coldMargin, heatMargin),
    extraHeat: Math.max(0, coldLoad / r.activeHeat.value - 1),
  };
}
