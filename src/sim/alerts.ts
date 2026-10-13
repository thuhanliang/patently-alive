import { CAUSE, deathsByBlock, recentByCause } from './ledger';
import type { SimState } from './sim';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from './time';

/**
 * 警报：引擎按固定的规则从推演状态里找出值得注意的事，排出轻重（铁律 4：怎么算"严重"只在这里定义）。
 * 界面同一时间只显示最响的一条（朱红，见 CLAUDE.md「美术」）。
 *
 * 规则：
 * - 濒临消失：总数不到开局的 NEAR_EXTINCT_FRACTION；
 * - 骤减：和一年前同一季节的普查比，减少了 DECLINE_ALERT 以上；地点是这个物种近期死得最多的区块。
 *   比一年前而不是比几个月前：繁殖季过后数量本来就会回落两三成，那不是问题。所以开局第一年没有骤减警报，只有濒临消失；
 * - 饥荒：近期死亡里饿死的占一半以上（死亡数够多时才算）；
 * - 资源：满意度低、预算不够布最便宜的工具（由调用方传入，不在推演状态里）。
 */
export const NEAR_EXTINCT_FRACTION = 0.1;
export const DECLINE_WINDOW_DAYS = DAYS_PER_YEAR;
export const DECLINE_ALERT = 0.25;
export const FAMINE_SHARE = 0.5;
export const FAMINE_MIN_DEATHS = 20;
export const LOW_SATISFACTION = 30;

export type AlertKind = 'nearExtinct' | 'decline' | 'famine' | 'lowSatisfaction' | 'lowBudget';

export interface Alert {
  kind: AlertKind;
  /** 0–1，越大越响。 */
  severity: number;
  /** 涉及的物种（资源类警报为 −1）。 */
  species: number;
  /** 数值：骤减的比例、饿死的占比、满意度、预算……按 kind 解读。 */
  value: number;
  /** 地图上的位置（格子坐标，区块中心）；没有具体地点时为 null。 */
  at: { x: number; y: number } | null;
}

export interface AlertInputs {
  /** 每格属于哪个区块（和死因账本同一套区块）。 */
  blockOf: Int32Array;
  /** 各物种是不是本地物种（情景的委托目标给出）。给了的话，濒临消失和骤减只报本地物种：外来物种减少是好事。 */
  native?: readonly boolean[] | undefined;
  /** 当前资源；沙盒里可以不给。 */
  resources?: { budget: number; satisfaction: number; cheapestTool: number } | undefined;
}

/** 所有警报，最响的在前。 */
export function alerts(state: Readonly<SimState>, inputs: AlertInputs): Alert[] {
  const out: Alert[] = [];
  const census = state.census;
  // 开局那次普查一直留着（见 Sim.daily）。
  const first = census[0];
  const today = Math.floor(state.tick / TICKS_PER_DAY);
  // 和窗口开始时最近的一次普查比。
  const past = [...census].reverse().find((c) => c.day <= today - DECLINE_WINDOW_DAYS);
  const totals = state.lastDay.map((d) => d.total);

  for (let s = 0; s < totals.length; s++) {
    const total = totals[s]!;
    const start = first?.totals[s] ?? 0;
    const watched = !inputs.native || inputs.native[s] === true;
    if (watched && start > 0 && total < start * NEAR_EXTINCT_FRACTION) {
      out.push({ kind: 'nearExtinct', severity: 0.9 + 0.1 * (1 - total / (start * NEAR_EXTINCT_FRACTION)), species: s, value: total, at: hotspot(state, s, inputs.blockOf) });
      continue;
    }
    const before = past?.totals[s] ?? 0;
    if (watched && past && before > 0) {
      const drop = 1 - total / before;
      if (drop >= DECLINE_ALERT) {
        out.push({ kind: 'decline', severity: Math.min(0.89, 0.4 + drop * 0.6), species: s, value: drop, at: hotspot(state, s, inputs.blockOf) });
        continue;
      }
    }
    const byCause = recentByCause(state.deaths, s);
    const deaths = byCause.reduce((a, b, cause) => (cause === CAUSE.removed ? a : a + b), 0);
    if (deaths >= FAMINE_MIN_DEATHS) {
      const share = byCause[CAUSE.starvation]! / deaths;
      if (share >= FAMINE_SHARE) out.push({ kind: 'famine', severity: 0.3 + 0.2 * share, species: s, value: share, at: null });
    }
  }

  const r = inputs.resources;
  if (r) {
    if (r.satisfaction < LOW_SATISFACTION) {
      out.push({ kind: 'lowSatisfaction', severity: 0.5 + 0.4 * (1 - r.satisfaction / LOW_SATISFACTION), species: -1, value: r.satisfaction, at: null });
    }
    if (r.budget < r.cheapestTool) out.push({ kind: 'lowBudget', severity: 0.45, species: -1, value: r.budget, at: null });
  }
  return out.sort((a, b) => b.severity - a.severity || a.species - b.species);
}

/** 物种 s 近期死得最多（人为移除不算）的区块的中心；没有记录时为 null。 */
export function hotspot(state: Readonly<SimState>, s: number, blockOf: Int32Array): { x: number; y: number } | null {
  const perBlock = deathsByBlock(state.deaths, s, 'all');
  let best = -1;
  let bestN = 0;
  for (let b = 0; b < perBlock.length; b++) {
    const n = perBlock[b]!;
    if (n > bestN) {
      bestN = n;
      best = b;
    }
  }
  if (best < 0) return null;
  const w = state.grid.width;
  let sx = 0;
  let sy = 0;
  let k = 0;
  for (let c = 0; c < blockOf.length; c++) {
    if (blockOf[c] !== best) continue;
    sx += c % w;
    sy += Math.floor(c / w);
    k += 1;
  }
  return { x: Math.floor(sx / k), y: Math.floor(sy / k) };
}
