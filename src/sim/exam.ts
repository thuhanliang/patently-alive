import { detExp, detLog } from './detmath';
import type { Individuals } from './individuals';
import { CAUSE, RECENT_HALF_LIFE_DAYS, type DeathLedger } from './ledger';
import { FED_SUFFICIENT, juvenileStageAt, type DerivedSpecies } from './physiology';
import type { Population } from './population';
import type { Rng } from './rng';
import { standardNormal } from './sample';

/**
 * 体检：兽医队抓到一只动物（陷阱或采样），称重、评体况、估年龄、看胃内容物，然后放生或移除。
 * 量出来的数由引擎按这只动物的真实状态加上测量误差算出（铁律 4：指标只由引擎定义），界面只负责措辞。
 *
 * - 营养状况（0–1）：展开的个体看体内储备；格子里的看那一格最近一次每日结算吃饱的程度（fedLast）。
 * - 体况评分（BCS，1–5，半分一档）：1 + BCS_RANGE × 营养状况，加评分误差。3 左右是正常，2 以下偏瘦。
 * - 体重：成体体重 × 生长比例（幼体按年龄线性长大）× 营养的影响，加称量误差。
 * - 年龄：个体按出生日；格子里的幼体按所在的年龄段，成体按成年后的死亡率抽一个"成年了多久"（没有逐只记录，只有分布）。
 * - 胃内容物：多满看营养状况；成分按食谱比例；有没有脊椎动物残骸、是谁的，看死因账本里这一片最近被这个物种吃掉的是谁、
 *   平均每只每天吃掉几只（残骸大约留一天）。
 */

/** 营养满分时体况评分比 1 高多少。 */
export const BCS_RANGE = 2.5;
/** 体况评分的误差（标准差，分）。 */
export const BCS_NOISE = 0.3;
/** 称量误差（相对，标准差）。 */
export const MASS_NOISE = 0.05;
/** 营养对体重的影响：营养为 0 时体重是正常的 MASS_STARVED 倍，营养满分时是 MASS_STARVED + MASS_CONDITION_SPAN 倍（1.05）。 */
export const MASS_STARVED = 0.75;
export const MASS_CONDITION_SPAN = 0.3;
/** 胃里东西少于这个比例就算空胃（也看不出有什么残骸）。 */
export const EMPTY_STOMACH = 0.1;
/** 刚出生时的体重占成体的比例（幼体从这里线性长到成体）。 */
export const BIRTH_MASS_FRACTION = 0.1;

export interface Stomach {
  /** 多满（0–1）。 */
  fullness: number;
  /** 成分占比（加起来为 1；空胃时全为 0）。 */
  plant: number;
  invertebrate: number;
  vertebrate: number;
  /** 脊椎动物残骸是哪个物种的；认不出（或没有）时为 −1。vertebrate > 0 而 prey = −1 是认不出的肉和骨渣。 */
  prey: number;
  /** 残骸是蛋或雏（巢里的）而不是会跑的个体。 */
  preyNest: boolean;
}

export interface Exam {
  species: number;
  x: number;
  y: number;
  female: boolean;
  juvenile: boolean;
  /** 真实年龄（天）。检查卡上只显示由它推出的年龄估计（ageClass）。 */
  ageDays: number;
  massKg: number;
  /** 体况评分 1–5，半分一档。 */
  bcs: number;
  stomach: Stomach;
}

/** 体检用到的推演状态。 */
export interface ExamContext {
  species: readonly DerivedSpecies[];
  populations: readonly Population[];
  individuals: Individuals;
  fedLast: readonly Float64Array[];
  ledger: DeathLedger;
  blockOf: Int32Array;
  width: number;
  day: number;
  rng: Rng;
  /** 物种 s 在区块 block 里有多少只；调用方可以缓存（同一晚的多次体检共用）。 */
  countInBlock: (s: number, block: number) => number;
}

/** 被检查的是谁：格子里某格某年龄段的一只（stage −1 是成体），或一只展开的个体。 */
export type Subject = { kind: 'cohort'; s: number; c: number; stage: number } | { kind: 'individual'; i: number };

/** 年龄估计（检查卡上的说法）：由引擎按年龄占寿命的比例分档。 */
export type AgeClass = 'juvenile' | 'young' | 'prime' | 'old';

export function ageClass(sp: DerivedSpecies, ageDays: number, juvenile: boolean): AgeClass {
  if (juvenile) return 'juvenile';
  const grown = grownDays(sp);
  const t = (ageDays - grown) / Math.max(1, sp.maxAgeDays - grown);
  return t < 0.15 ? 'young' : t < 0.5 ? 'prime' : 'old';
}

/** 长成成体的年龄（天）：幼体传送带走完（和推演里判断成年同一口径）。 */
export function grownDays(sp: DerivedSpecies): number {
  return sp.juvenileStages * sp.stageDays;
}

/** 体况评分：1 + BCS_RANGE × 营养，加评分误差，半分一档，夹在 1–5。 */
export function scoreBcs(nutrition: number, rng: Rng): number {
  const raw = 1 + BCS_RANGE * nutrition + BCS_NOISE * standardNormal(rng);
  return Math.min(5, Math.max(1, Math.round(raw * 2) / 2));
}

/** 格子里物种 s 在格 c 的营养状况（0–1）。 */
export function cellNutrition(fedLast: readonly Float64Array[], s: number, c: number): number {
  return clamp01(fedLast[s]![c]! / FED_SUFFICIENT);
}

/** 营养状况对体重的影响。 */
export function massFactor(nutrition: number): number {
  return MASS_STARVED + MASS_CONDITION_SPAN * nutrition;
}

export function examine(subject: Subject, ctx: ExamContext): Exam {
  const { rng } = ctx;
  let s: number;
  let c: number;
  let x: number;
  let y: number;
  let female: boolean;
  let ageDays: number;
  let juvenile: boolean;
  let nutrition: number;
  if (subject.kind === 'individual') {
    const ind = ctx.individuals;
    const i = subject.i;
    s = ind.species[i]!;
    const sp = ctx.species[s]!;
    x = Math.floor(ind.x[i]!);
    y = Math.floor(ind.y[i]!);
    c = y * ctx.width + x;
    female = ind.female[i] === 1;
    ageDays = ctx.day - ind.born[i]!;
    juvenile = juvenileStageAt(sp, ind.born[i]!, ctx.day) < sp.juvenileStages;
    nutrition = clamp01((ind.reserve[i]! + 1) / (sp.maxReserveDays + 1));
  } else {
    s = subject.s;
    c = subject.c;
    const sp = ctx.species[s]!;
    x = c % ctx.width;
    y = Math.floor(c / ctx.width);
    female = rng.nextInt(2) === 1;
    juvenile = subject.stage >= 0;
    if (juvenile) {
      ageDays = Math.floor((subject.stage + rng.nextFloat()) * sp.stageDays);
    } else {
      // 成年了多久：按成体每日死亡率的指数分布抽（存活到 t 天的概率随 t 指数下降），截断在最长寿命以内
      // （按截断分布的反函数抽，不会都堆在寿命上限）。
      const m = Math.max(1e-6, sp.adultDailyMortality);
      const span = Math.max(0, sp.maxAgeDays - grownDays(sp));
      const tail = detExp(-m * span);
      const t = Math.floor(-detLog(1 - rng.nextFloat() * (1 - tail)) / m);
      ageDays = grownDays(sp) + Math.min(span, t);
    }
    nutrition = cellNutrition(ctx.fedLast, s, c);
  }
  const sp = ctx.species[s]!;
  const growth = juvenile ? Math.min(1, BIRTH_MASS_FRACTION + (1 - BIRTH_MASS_FRACTION) * (ageDays / grownDays(sp))) : 1;
  const massKg = Math.max(0, sp.params.bodyMassKg * growth * massFactor(nutrition) * (1 + MASS_NOISE * standardNormal(rng)));
  const bcs = scoreBcs(nutrition, rng);
  return { species: s, x, y, female, juvenile, ageDays, massKg, bcs, stomach: stomachOf(s, c, nutrition, ctx) };
}

/** 平均一只动物在死因账本"近期"里的权重相当于多少天的死亡（半衰期 h 天的指数衰减，总权重 ≈ h / ln 2）。 */
const RECENT_WEIGHT_DAYS = RECENT_HALF_LIFE_DAYS / 0.6931471805599453;

function stomachOf(s: number, c: number, nutrition: number, ctx: ExamContext): Stomach {
  const { rng, ledger } = ctx;
  const d = ctx.species[s]!.params.diet;
  const fullness = clamp01(nutrition * (0.4 + 0.6 * rng.nextFloat()));
  if (fullness < EMPTY_STOMACH) return { fullness, plant: 0, invertebrate: 0, vertebrate: 0, prey: -1, preyNest: false };
  let prey = -1;
  let preyNest = false;
  if (d.vertebrate > 0) {
    // 这一片最近被物种 s 吃掉的：按死因账本（被 s 捕食、巢被 s 吃）。
    const block = ctx.blockOf[c]!;
    const kills: { q: number; nest: boolean; w: number }[] = [];
    let total = 0;
    for (let q = 0; q < ledger.species; q++) {
      for (const nest of [false, true]) {
        const cause = nest ? CAUSE.nest(s) : CAUSE.predation(s);
        const w = ledger.recent[(q * ledger.causes + cause) * ledger.blocks + block]!;
        if (w > 0) {
          kills.push({ q, nest, w });
          total += w;
        }
      }
    }
    if (total > 0) {
      // 平均每只每天吃掉几只；残骸大约留一天，所以这就是胃里有残骸的概率。
      const eaters = Math.max(1, ctx.countInBlock(s, block));
      const perDay = total / RECENT_WEIGHT_DAYS / eaters;
      if (rng.nextFloat() < Math.min(1, perDay)) {
        let pick = rng.nextFloat() * total;
        for (const k of kills) {
          pick -= k.w;
          if (pick < 0 || k === kills[kills.length - 1]) {
            prey = k.q;
            preyNest = k.nest;
            break;
          }
        }
      }
    }
  }
  // 成分按食谱比例，每一类有 ±30% 的出入（今天吃到什么有运气）。
  // 认得出是谁的残骸才算脊椎动物这一类；只吃肉的动物胃里总有肉，认不出时记成认不出的肉和骨渣。
  const jitter = (): number => 0.7 + 0.6 * rng.nextFloat();
  const plant = d.plant * jitter();
  const invertebrate = d.invertebrate * jitter();
  const onlyMeat = d.plant + d.invertebrate === 0;
  const vertebrate = prey >= 0 ? Math.max(d.vertebrate, 0.1) * jitter() : onlyMeat ? d.vertebrate : 0;
  const sum = plant + invertebrate + vertebrate;
  return { fullness, plant: plant / sum, invertebrate: invertebrate / sum, vertebrate: vertebrate / sum, prey, preyNest };
}

/**
 * 各物种按区块的只数（格子计数 + 展开的个体），第一次问到某个物种时整张图数一遍，之后查表。
 * 一晚的多次体检共用一个（这期间只有被移除的会变，差一两只不影响"平均每只吃掉几只"）。
 */
export function blockCounter(
  populations: readonly Population[],
  individuals: Individuals,
  blockOf: Int32Array,
  width: number,
): (s: number, block: number) => number {
  const cache = new Map<number, Float64Array>();
  let blocks = 0;
  for (let c = 0; c < blockOf.length; c++) blocks = Math.max(blocks, blockOf[c]! + 1);
  return (s, block) => {
    let counts = cache.get(s);
    if (!counts) {
      counts = new Float64Array(blocks);
      const pop = populations[s]!;
      for (let c = 0; c < blockOf.length; c++) {
        let n = pop.adults[c]!;
        for (const j of pop.juveniles) n += j[c]!;
        const b = blockOf[c]!;
        counts[b] = counts[b]! + n;
      }
      for (let i = 0; i < individuals.count; i++) {
        if (individuals.species[i] !== s) continue;
        const c = Math.floor(individuals.y[i]!) * width + Math.floor(individuals.x[i]!);
        const b = blockOf[c]!;
        counts[b] = counts[b]! + 1;
      }
      cache.set(s, counts);
    }
    return counts[block]!;
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
