import type { SpeciesParams } from '../data/schema/species';
import { detExp, detLog } from './detmath';

/**
 * 性状相似度：档案馆检索、阶段 3 的申请书检索都用它。
 * 只比较性状（体型、食性、活动时段、繁殖、移动方式），不比较名字；结果确定、可复现。
 *
 * 每一项性状算一个"差距"（0 = 一样，1 = 明显不同，最多算到 2），按权重平均成总差距 D，
 * 相似度 = exp(−SIMILARITY_SCALE × D)：一模一样是 1；船鼠和褐家鼠、野猫和赤狐这样的近亲约 0.7；食性或体型截然不同的在 0.3 以下。
 * 查询可以只给一部分性状（例如只问体重和食性），只在给出的性状上比。
 */

export type Activity = SpeciesParams['activity'];
/** 窝的类型；none = 不写窝（幼体不在窝里，阶段 0 的物种）。 */
export type NestKind = 'ground' | 'burrow' | 'none';

export interface TraitQuery {
  bodyMassKg?: number;
  diet?: { plant: number; vertebrate: number; invertebrate: number };
  activity?: Activity;
  litterSize?: number;
  /** 妊娠期；鸟是孵化期。 */
  gestationDays?: number;
  ageAtMaturityDays?: number;
  maxLifespanYears?: number;
  nest?: NestKind;
  flies?: boolean;
  climbs?: boolean;
  territorial?: boolean;
}

export type TraitKey = keyof TraitQuery;

/** 各项性状的权重：体型和食性最能决定一种动物"是什么"，其次是繁殖节奏和移动方式。 */
export const TRAIT_WEIGHTS: Readonly<Record<TraitKey, number>> = {
  bodyMassKg: 3,
  diet: 3,
  activity: 1,
  litterSize: 1,
  gestationDays: 0.5,
  ageAtMaturityDays: 1,
  maxLifespanYears: 1,
  nest: 0.5,
  flies: 1.5,
  climbs: 0.5,
  territorial: 0.5,
};

/** 相似度 = exp(−SIMILARITY_SCALE × 总差距)。 */
export const SIMILARITY_SCALE = 1.5;
/** 相似度不低于这个值算"实质相同"（阶段 3 的审查用：授权许可而不是创造性改进）。 */
export const SUBSTANTIALLY_SAME = 0.9;

/** 体重差 4 倍、其余数量差 3 倍算"明显不同"（差距 1）。 */
const MASS_FOLD = 4;
const OTHER_FOLD = 3;
/** 单项差距的上限：某一项差得再远，也不让它压过其余全部。 */
const MAX_TRAIT_DISTANCE = 2;

/** 一个物种的全部可比性状。 */
export function traitsOf(p: SpeciesParams): Required<TraitQuery> {
  return {
    bodyMassKg: p.bodyMassKg,
    diet: { ...p.diet },
    activity: p.activity,
    litterSize: p.reproduction.litterSize,
    gestationDays: p.reproduction.gestationDays,
    ageAtMaturityDays: p.reproduction.ageAtMaturityDays,
    maxLifespanYears: p.maxLifespanYears,
    nest: p.reproduction.nest ?? 'none',
    flies: p.movement.flies === true,
    climbs: p.movement.climbs === true,
    territorial: p.movement.territorial === true,
  };
}

/** 数量按倍数比：差 fold 倍算 1。不是正数（查询里填了 0）时按最大差距算，免得出 NaN。 */
function foldDistance(a: number, b: number, fold: number): number {
  if (!(a > 0 && b > 0)) return a === b ? 0 : MAX_TRAIT_DISTANCE;
  return Math.abs(detLog(a / b)) / detLog(fold);
}

/** 活动时段：同一种为 0；昼行和夜行相反为 1；晨昏、全天和它们部分重叠为 0.5。 */
function activityDistance(a: Activity, b: Activity): number {
  if (a === b) return 0;
  const opposite = (a === 'diurnal' && b === 'nocturnal') || (a === 'nocturnal' && b === 'diurnal');
  return opposite ? 1 : 0.5;
}

function traitDistance(key: TraitKey, q: TraitQuery, t: Required<TraitQuery>): number {
  switch (key) {
    case 'bodyMassKg':
      return foldDistance(q.bodyMassKg!, t.bodyMassKg, MASS_FOLD);
    case 'diet': {
      // 三类食物比例的 L1 距离：完全换成另一类食物算 2。
      const d = q.diet!;
      return Math.abs(d.plant - t.diet.plant) + Math.abs(d.vertebrate - t.diet.vertebrate) + Math.abs(d.invertebrate - t.diet.invertebrate);
    }
    case 'activity':
      return activityDistance(q.activity!, t.activity);
    case 'litterSize':
      return foldDistance(q.litterSize!, t.litterSize, OTHER_FOLD);
    case 'gestationDays':
      return foldDistance(q.gestationDays!, t.gestationDays, OTHER_FOLD);
    case 'ageAtMaturityDays':
      return foldDistance(q.ageAtMaturityDays!, t.ageAtMaturityDays, OTHER_FOLD);
    case 'maxLifespanYears':
      return foldDistance(q.maxLifespanYears!, t.maxLifespanYears, OTHER_FOLD);
    case 'nest':
      return q.nest === t.nest ? 0 : 1;
    case 'flies':
      return q.flies === t.flies ? 0 : 1;
    case 'climbs':
      return q.climbs === t.climbs ? 0 : 1;
    case 'territorial':
      return q.territorial === t.territorial ? 0 : 1;
  }
}

const KEYS = Object.keys(TRAIT_WEIGHTS) as TraitKey[];

export interface Match {
  id: string;
  /** 0–1，1 = 给出的性状完全一样。 */
  similarity: number;
  /** 每一项给出的性状差多远（0 = 一样，最多 2），按权重 × 差距从大到小排：最前面的就是"最不像"的地方。 */
  differences: { key: TraitKey; distance: number }[];
}

/** 一条查询和一个物种的相似度。查询一项性状也没给时为 0。 */
export function compare(q: TraitQuery, id: string, p: SpeciesParams): Match {
  const t = traitsOf(p);
  let weighted = 0;
  let total = 0;
  const differences: Match['differences'] = [];
  for (const key of KEYS) {
    if (q[key] === undefined) continue;
    const distance = Math.min(MAX_TRAIT_DISTANCE, traitDistance(key, q, t));
    weighted += TRAIT_WEIGHTS[key] * distance;
    total += TRAIT_WEIGHTS[key];
    differences.push({ key, distance });
  }
  differences.sort((a, b) => TRAIT_WEIGHTS[b.key] * b.distance - TRAIT_WEIGHTS[a.key] * a.distance || KEYS.indexOf(a.key) - KEYS.indexOf(b.key));
  const similarity = total === 0 ? 0 : detExp(-SIMILARITY_SCALE * (weighted / total));
  return { id, similarity, differences };
}

/**
 * 在候选物种里找最接近的 k 个，相似度从高到低；一样高时按 id 排，保证可复现。
 * exclude：不参与比较的 id（例如查某条现有技术"最像谁"时排除它自己）。
 */
export function nearest(q: TraitQuery, candidates: Iterable<SpeciesParams>, k: number, exclude: readonly string[] = []): Match[] {
  const out: Match[] = [];
  for (const p of candidates) if (!exclude.includes(p.id)) out.push(compare(q, p.id, p));
  out.sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, k);
}
