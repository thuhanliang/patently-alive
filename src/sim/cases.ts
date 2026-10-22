import type { Case } from '../data/schema/case';
import type { SpeciesParams } from '../data/schema/species';
import { FED_SUFFICIENT, starvationRateOf } from './physiology';
import { TERRAIN } from './terrain';

/**
 * 个案动物（2026-10-22）：情景里单独记着的"这一只"（个体医学这条线，GDD"兽医"）。
 * 它不在格子、个体模型里：不进数量、不被陷阱抓、不抽随机数，推演的结果和没有它时逐位相同。
 * 状态只由情景数据、当天日期和日志里的救助操作推出来，所以存档、回放不用另外记。
 *
 * - hidden：还没人看见；
 * - wild：在野外，体况每天按确定的速度往下掉（见 dailyDecline）；
 * - rescued：带回事务所了，在养；
 * - office：养好了，成了事务所的猫；
 * - lost：没来得及，体况掉到 0。
 */
export type CasePhase = 'hidden' | 'wild' | 'rescued' | 'office' | 'lost';

export interface CaseStatus {
  id: string;
  name: string;
  phase: CasePhase;
  /** 体况（0–1）：野外时往下掉；带回来以后慢慢养回 1。 */
  condition: number;
  /** 野外：照现在的速度还能撑几天；不会饿的为 null。 */
  daysLeft: number | null;
  /** 在哪一格（开局按 anchor 找好）。 */
  x: number;
  y: number;
  /** 野外能吃饱多少（0–1，牙齿 × 食谱）。 */
  wildFed: number;
  /** 哪天带回来的；没带回来为 null。 */
  rescuedDay: number | null;
}

/** 野外能吃饱多少：Σ 食谱比例 × 牙齿能对付的比例（dentition.json）。牙齿齐全时就是 1。 */
export function wildFed(c: Case, sp: SpeciesParams): number {
  const e = c.edible;
  if (!e) throw new Error(`个案 ${c.id} 的牙齿还没换成能吃下去的比例（edible）`);
  const d = sp.diet;
  return d.plant * e.plant + d.vertebrate * e.vertebrate + d.invertebrate * e.invertebrate + (d.aquatic ?? 0) * e.aquatic;
}

/**
 * 体况每天掉多少：和格子模型里饿死的风险同一个式子（starvationRate × (1 − 吃饱程度 / 够吃的线)），
 * 这里当成确定的消耗，不抽随机数（一只动物的故事不该看运气在几天内就没了）。吃得够的为 0。
 */
export function dailyDecline(c: Case, sp: SpeciesParams): number {
  return starvationRateOf(c.massKg) * Math.max(0, 1 - wildFed(c, sp) / FED_SUFFICIENT);
}

/** 哪天体况掉到 0（没来得及）；不会饿的为 null。 */
export function lostDayOf(c: Case, sp: SpeciesParams): number | null {
  const d = dailyDecline(c, sp);
  return d > 0 ? c.appearsDay + Math.ceil(c.condition / d - 1e-9) : null;
}

/**
 * 在哪一格：离 anchor 最近的灌丛格，没有灌丛就找最近的陆地（距离相同取下标小的）。
 * 只看地形，换种子以后照样落在陆地上。
 */
export function caseLocation(c: Case, grid: { width: number; height: number; terrain: Uint8Array }): { x: number; y: number } {
  const { width, height, terrain } = grid;
  const ax = c.anchor.x * (width - 1);
  const ay = c.anchor.y * (height - 1);
  let best = -1;
  let bestD = Infinity;
  for (const want of [TERRAIN.shrub, -1]) {
    for (let i = 0; i < terrain.length; i++) {
      const t = terrain[i]!;
      if (want === -1 ? t === TERRAIN.water : t !== want) continue;
      const dx = (i % width) - ax;
      const dy = Math.floor(i / width) - ay;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) break;
  }
  if (best < 0) throw new Error(`个案 ${c.id}：地图上没有陆地`);
  return { x: best % width, y: Math.floor(best / width) };
}

/** 某一天的状态。rescuedDay：日志里救助操作那天（没有为 null）。 */
export function caseStatus(c: Case, sp: SpeciesParams, at: { x: number; y: number }, day: number, rescuedDay: number | null): CaseStatus {
  const base = { id: c.id, name: c.name, x: at.x, y: at.y, wildFed: wildFed(c, sp), rescuedDay };
  const decline = dailyDecline(c, sp);
  const conditionOn = (d: number): number => Math.max(0, c.condition - decline * Math.max(0, d - c.appearsDay));
  if (rescuedDay !== null) {
    const start = conditionOn(rescuedDay);
    const t = c.rescue.recoveryDays > 0 ? Math.min(1, (day - rescuedDay) / c.rescue.recoveryDays) : 1;
    return { ...base, phase: t >= 1 ? 'office' : 'rescued', condition: start + (1 - start) * t, daysLeft: null };
  }
  if (day < c.appearsDay) return { ...base, phase: 'hidden', condition: c.condition, daysLeft: null };
  const lost = lostDayOf(c, sp);
  if (lost !== null && day >= lost) return { ...base, phase: 'lost', condition: 0, daysLeft: 0 };
  return { ...base, phase: 'wild', condition: conditionOn(day), daysLeft: lost === null ? null : lost - day };
}
