import { SLOTS, type Design, type EffectTarget, type HintId, type HintTemplates, type Part, type Slot } from '../data/schema/design';
import type { ScalingLaws } from '../data/schema/scaling';
import type { SpeciesParams } from '../data/schema/species';
import type { ViabilityRules } from '../data/schema/viability';
import { allocateBody, type BodyAllocation } from './body';
import { detExp, detLog } from './detmath';
import { scaleTraits, type ScaledTraits } from './scaling';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from './time';
import { runChecks, type CheckResult, type EnvironmentProfile } from './viability';

/**
 * 设计编译器（阶段 3）：一份设计 → 物种参数、推导属性、能量收支、提醒。确定、纯函数。
 *
 * 设计只写原因（体型、部件、繁殖策略……）；繁殖率、寿命、存活率、活动范围、能量需求全由这里从缩放公式和部件的钩子推导（铁律 5）。
 * 推导结果落到阶段 1 的物种参数（SpeciesParams）上，推演引擎不区分真实物种和设计物种。
 */

/** 编译要用的数据：部件表、缩放公式、提醒模板，以及按现有技术校准的胃口基准（见 calibrate）。 */
export interface DesignKit {
  parts: ReadonlyMap<string, Part>;
  laws: ScalingLaws;
  hints: HintTemplates;
  /** 身体可行性检查的阈值（阶段 3.5，viability.json）。 */
  viability: ViabilityRules;
  /** 现有技术写成设计后"能量需求 ÷ 消化率 ÷ 基础开销"的几何平均：这个值算胃口 1 倍。 */
  appetiteBaseline: number;
}

export interface EnergyLine {
  label: string;
  kjPerDay: number;
}

export interface CompiledDesign {
  params: SpeciesParams;
  /** 缩放公式的原始推导（还没乘部件的钩子），设计台的"推导属性"一栏对照用。 */
  scaled: ScaledTraits;
  /** 每个钩子的总倍数：各部件相乘；能量例外，是各部件的增减相加（和能量收支的各行一致）。 */
  multipliers: Readonly<Record<EffectTarget, number>>;
  energy: {
    /** 开销：日常代谢、各部件、育幼（千焦/天）。 */
    lines: EnergyLine[];
    needKjPerDay: number;
    /** 按食谱加权的消化率（0–1）：吃进去的能量能取出多少。 */
    digestibility: number;
    /** 胃口：要吃同体重的现有动物几倍的食物。写进物种参数的 energyFactor，推演里吃不够就饿。 */
    appetite: number;
  };
  /** 老同事的提醒（按模板拼出），从不禁止。 */
  hints: { id: HintId; text: string }[];
  /** 会飞但太重：翅膀照长（照样付能量），就是飞不起来。 */
  tooHeavyToFly: boolean;
  /** 长羽毛的：按鸟的公式推导。 */
  bird: boolean;
  /** 一年几窝（和引擎的 litterRate 一致）。 */
  littersPerYear: number;
  /** 体重分配（阶段 3.5）。 */
  body: BodyAllocation;
  /** 身体可行性检查的结果（阶段 3.5），按 CHECKS 的顺序。 */
  viability: CheckResult[];
}

/** 生产 1 克断奶（出飞）的后代要多少千焦：组织本身约 7 千焦/克，加上怀孕、泌乳（喂雏）的损耗。建模假设，见 MODEL.md。 */
export const REPRO_KJ_PER_G = 20;
/** 兽在繁殖季里两胎的间隔 ≈ 妊娠期 + 这个比例 × 断奶天数（哺乳和下一次怀孕部分重叠）。 */
const LACTATION_OVERLAP = 0.5;
/** 鸟：出壳后在窝里的天数 ≈ 孵化期 × 这个倍数（晚成鸟的雏鸟期和孵化期相当；早成鸟再乘育幼部件的钩子）。 */
const BIRD_NESTLING_FACTOR = 1;
/** 鸟：两窝间隔 ≈ 窝里天数 × 这个倍数（出飞后还要带一阵，再筑新窝）。 */
const BIRD_RENEST_FACTOR = 1.5;
/** 胃口超过 / 低于这个倍数时提醒。 */
const APPETITE_HIGH = 1.35;
const APPETITE_LOW = 0.75;

/**
 * 各部件的钩子合起来。能量的各项是分开列在收支上的开销（"翅膀 +15%""早成 +6%"），所以相加；
 * 其余的钩子作用在同一个量上，相乘。
 */
function multipliersOf(parts: readonly Part[]): Record<EffectTarget, number> {
  const m: Record<EffectTarget, number> = { energy: 1, dailyRange: 1, mortality: 1, gestation: 1, nestDays: 1, maturity: 1 };
  for (const p of parts) {
    for (const e of p.effects) {
      if (e.target === 'energy') m.energy += e.factor - 1;
      else m[e.target] *= e.factor;
    }
  }
  return m;
}

/** 按槽位取出部件；部件不存在或放错了槽位就报错。 */
export function partsOf(design: Design, kit: Pick<DesignKit, 'parts'>): Record<Slot, Part> {
  const out = {} as Record<Slot, Part>;
  for (const slot of SLOTS) {
    const p = kit.parts.get(design.parts[slot]);
    if (!p) throw new Error(`没有部件「${design.parts[slot]}」`);
    if (p.slot !== slot) throw new Error(`部件「${p.name}」不能装在 ${slot} 槽`);
    out[slot] = p;
  }
  return out;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const FOOD_NAMES = { plant: '植物', vertebrate: '脊椎动物', invertebrate: '无脊椎动物' } as const;

function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/**
 * env 只给设计台预览用（这片地的食物、以后的气候）：只影响可行性检查的结果和提醒，从不影响物种参数。
 */
export function compileDesign(design: Design, kit: DesignKit, env?: EnvironmentProfile): CompiledDesign {
  const parts = partsOf(design, kit);
  const all = SLOTS.map((s) => parts[s]);
  const bird = parts.coat.bodyPlan === 'bird';
  const diet = parts.mouth.diet!;
  const hasWings = all.some((p) => p.flies === true);
  const climbs = all.some((p) => p.climbs === true);
  const scaled = scaleTraits(kit.laws, { bodyMassKg: design.bodyMassKg, litterSize: design.litterSize, diet, bird, flies: hasWings });
  const m = multipliersOf(all);

  // 繁殖节奏。
  const gestationDays = Math.max(1, Math.round(scaled.gestationDays * m.gestation));
  // 窝里的天数：兽从出生算到断奶；鸟从产蛋算起，蛋一直在窝里，部件的钩子只缩短出壳以后那一段。
  const nestDays = Math.max(1, Math.round(bird ? gestationDays + scaled.gestationDays * BIRD_NESTLING_FACTOR * m.nestDays : scaled.weaningDays * m.nestDays));
  // 繁殖季里的间隔。缩放公式里的胎间隔是全年平均（含非繁殖季），不能直接用，见 MODEL.md 五之十一。
  // 兽：哺乳期按窝里天数算（早成的离窝早，下一胎也来得早）。
  const interval = bird ? nestDays * BIRD_RENEST_FACTOR : gestationDays + LACTATION_OVERLAP * nestDays;
  const litterIntervalDays = Math.max(gestationDays, Math.round(interval));
  // 性成熟至少比出窝晚一截（幼体传送带要在窝外留几段），也不少于引擎要求的 8 天。
  const ageAtMaturityDays = Math.max(8, Math.round(nestDays * 1.5), Math.round(scaled.ageAtMaturityDays * m.maturity));
  const breedingByMonth = Array.from({ length: 12 }, (_, i) => (i < design.breedingMonths ? 1 : 0));
  // 和引擎一致（physiology 的 litterRate）：繁殖季里每隔一个间隔一窝，繁殖季比间隔还短也有一窝。
  const seasonDays = design.breedingMonths * DAYS_PER_MONTH;
  const littersPerYear = Math.max(1, seasonDays / litterIntervalDays);

  // 存活：部件的钩子乘在死亡率上。
  const mortality = Math.min(0.99, Math.max(0.01, (1 - scaled.adultAnnualSurvival) * m.mortality));
  const tooHeavyToFly = scaled.tooHeavyToFly;

  // 能量收支：开销 = 日常代谢 + 部件 + 育幼；胃口 = 开销 ÷ 消化率，按现有技术的平均归一。
  const base = scaled.fieldMetabolismKjPerDay;
  // 胃口除以日常代谢，所以鸟兽的代谢差在胃口里抵消：推演的摄食公式是按真实动物定的，不分鸟兽，
  // 设计出来的鸻和真实的鸻要吃得一样多。鸟兽之差体现在缩放公式（寿命、繁殖）上。
  const lines: EnergyLine[] = [{ label: bird ? '日常代谢（鸟）' : '日常代谢（兽）', kjPerDay: base }];
  for (const p of all) {
    for (const e of p.effects) if (e.target === 'energy' && e.factor !== 1) lines.push({ label: `${p.name}：${e.why}`, kjPerDay: base * (e.factor - 1) });
  }
  const offspringG = design.litterSize * littersPerYear * scaled.weaningMassG;
  lines.push({ label: `育幼：一年约 ${round1(littersPerYear)} 窝，每窝 ${design.litterSize} 个`, kjPerDay: (offspringG * REPRO_KJ_PER_G) / DAYS_PER_YEAR });
  const needKjPerDay = lines.reduce((s, l) => s + l.kjPerDay, 0);
  const d = parts.digestion.digest!;
  const digestibility = diet.plant * d.plant + diet.vertebrate * d.vertebrate + diet.invertebrate * d.invertebrate;
  const appetite = needKjPerDay / base / digestibility / kit.appetiteBaseline;

  const params: SpeciesParams = {
    id: design.id,
    name: design.name,
    scientificName: `Inventum ${design.id.slice(2)}`,
    diet: { ...diet },
    bodyMassKg: design.bodyMassKg,
    activity: design.activity,
    reproduction: {
      litterSize: design.litterSize,
      gestationDays,
      litterIntervalDays,
      ageAtMaturityDays,
      breedingByMonth,
      nestDays,
      nest: design.nest,
    },
    survival: { adultAnnual: Math.round((1 - mortality) * 1000) / 1000 },
    maxLifespanYears: round1(scaled.maxLifespanYears),
    movement: {
      dailyRangeM: Math.round(scaled.dailyRangeM * m.dailyRange),
      homeRangeKm2: Number(scaled.homeRangeKm2.toPrecision(3)),
      ...(design.territorial ? { territorial: true } : {}),
      ...(hasWings && !tooHeavyToFly ? { flies: true } : {}),
      ...(climbs ? { climbs: true } : {}),
    },
    initialDensityPerHa: 0,
    ...(design.color ? { appearance: { color: design.color } } : {}),
    source: `设计：${parts.coat.name}、${parts.mouth.name}、${parts.limbs.name}、${parts.tail.name}、${parts.digestion.name}、${parts.rearing.name}`,
    energyFactor: Math.round(appetite * 1000) / 1000,
  };

  // 提醒：按固定顺序检查，结果确定。
  const hints: CompiledDesign['hints'] = [];
  // 模板齐不齐由 schema 保证（HINT_IDS 每个都要有）。
  const hint = (id: HintId, vars: Record<string, string | number> = {}): void => {
    hints.push({ id, text: fill(kit.hints[id], vars) });
  };
  if (appetite > APPETITE_HIGH) hint('energyHigh', { factor: round1(appetite) });
  if (appetite < APPETITE_LOW) hint('energyLow', { factor: round1(appetite) });
  for (const food of ['plant', 'vertebrate', 'invertebrate'] as const) {
    if (diet[food] >= 0.3 && d[food] < 0.5) hint('dietMismatch', { food: FOOD_NAMES[food], share: pct(diet[food]), eff: pct(d[food]) });
  }
  if (tooHeavyToFly) hint('tooHeavyToFly', { mass: design.bodyMassKg, flyer: kit.laws.flight.heaviestFlyer, max: kit.laws.flight.maxMassKg });
  if (!bird && parts.mouth.beak) hint('beakOnMammal');
  if (bird && !parts.mouth.beak) hint('teethOnBird');
  if (!bird && hasWings) hint('wingsOnMammal');
  if (design.breedingMonths < 12 && seasonDays < litterIntervalDays) hint('oneLitterSeason', { months: design.breedingMonths, interval: litterIntervalDays });
  if (design.nest === 'ground' && nestDays > 30) hint('groundNestLong', { days: nestDays });
  if (design.litterSize >= 6 && params.survival.adultAnnual < 0.25) hint('bigLitterShortLife', { litter: design.litterSize, survival: pct(params.survival.adultAnnual) });
  if (diet.vertebrate >= 0.5 && scaled.homeRangeKm2 > 1) hint('carnivoreHomeRange', { area: round1(scaled.homeRangeKm2) });
  if (bird) hint('borrowedLaw');

  // 身体可行性（阶段 3.5）：只出等级和提醒，推演里的后果从第 3 步起接入。
  const body = allocateBody(design, bird, kit.viability);
  const viability = runChecks({ design, parts, bird, body, rules: kit.viability, ...(env ? { env } : {}) });
  for (const r of viability) for (const h of r.hints) hint(h.id, h.vars);

  return { params, scaled, multipliers: m, energy: { lines, needKjPerDay, digestibility, appetite }, hints, tooHeavyToFly, bird, littersPerYear, body, viability };
}

/**
 * 胃口基准：把现有技术写成设计（src/data/design/templates.json），按基准 1 编译，
 * 取"开销 ÷ 日常代谢 ÷ 消化率"的几何平均。这样现有动物的胃口平均是 1，和推演里的摄食公式（按真实动物定的）对得上。
 */
export function calibrate(templates: readonly Design[], kit: Omit<DesignKit, 'appetiteBaseline'>): number {
  if (templates.length === 0) return 1;
  let sum = 0;
  for (const t of templates) sum += detLog(compileDesign(t, { ...kit, appetiteBaseline: 1 }).energy.appetite);
  return detExp(sum / templates.length);
}

/** 组装编译要用的数据，并按现有技术校准胃口基准。 */
export function makeDesignKit(
  parts: ReadonlyMap<string, Part>,
  laws: ScalingLaws,
  hints: HintTemplates,
  viability: ViabilityRules,
  templates: readonly Design[],
): DesignKit {
  const kit = { parts, laws, hints, viability };
  return { ...kit, appetiteBaseline: calibrate(templates, kit) };
}

/** 配置里的设计数据（DesignData，见 config.ts）和设计台用的 DesignKit 互相转换：两边编译的结果必须一样。 */
type DesignData = { parts: readonly Part[]; laws: ScalingLaws; hints: HintTemplates; viability: ViabilityRules; appetiteBaseline: number };

export function designKitFromData(data: DesignData): DesignKit {
  return { parts: new Map(data.parts.map((p) => [p.id, p] as const)), laws: data.laws, hints: data.hints, viability: data.viability, appetiteBaseline: data.appetiteBaseline };
}

export function designDataOf(kit: DesignKit): DesignData & { parts: Part[] } {
  return { parts: [...kit.parts.values()], laws: kit.laws, hints: kit.hints, viability: kit.viability, appetiteBaseline: kit.appetiteBaseline };
}
