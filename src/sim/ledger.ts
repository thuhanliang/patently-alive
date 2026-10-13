import { detPow } from './detmath';

/**
 * 死因账本：每一笔死亡记下死因、地点（按拥挤区块，8×8 格，和家域相当）、时间。
 * 尸检报告、死因热力图、以后的纪录片都从这里取数。
 *
 * 死因（每个物种各一套，S 是物种数）：
 *   0 饿死；1 其他（衰老、疾病、意外）；2 人为移除（兽医工具，第 5 步起）；
 *   3 + 2p 被物种 p 捕食（会跑的：成体、出了窝的幼体）；
 *   4 + 2p 巢失败：窝里的蛋、雏鸟、幼崽被物种 p 吃掉。
 *
 * 地点按区块而不是逐格：逐格按物种、死因存要几百万个数，快照太大；区块的分辨率（400 米）已经够看"哪一片死得多"。
 * 时间：按天的全岛合计（today / lastDay），加上按区块、随时间衰减的近期死亡（recent，半衰期 RECENT_HALF_LIFE_DAYS 天），
 * 所以区块里的数是"最近"的而不是累计的。尸检要用的新鲜尸体第 5 步再加。
 */
export const CAUSE = {
  starvation: 0,
  other: 1,
  removed: 2,
  predation: (predator: number): number => 3 + 2 * predator,
  nest: (predator: number): number => 4 + 2 * predator,
} as const;

export function causeCount(species: number): number {
  return 3 + 2 * species;
}

/** 近期死亡的半衰期（天）。 */
export const RECENT_HALF_LIFE_DAYS = 30;
const RECENT_KEEP = detPow(0.5, 1 / RECENT_HALF_LIFE_DAYS);

export interface DeathLedger {
  species: number;
  causes: number;
  blocks: number;
  /** [物种][死因][区块]，近期死亡（衰减）。 */
  recent: Float64Array;
  /** [物种][死因]，今天到目前为止。 */
  today: Float64Array;
  /** [物种][死因]，最近一次每日结算那一天的全天合计。 */
  lastDay: Float64Array;
}

export function createLedger(species: number, blocks: number): DeathLedger {
  const causes = causeCount(species);
  return {
    species,
    causes,
    blocks,
    recent: new Float64Array(species * causes * blocks),
    today: new Float64Array(species * causes),
    lastDay: new Float64Array(species * causes),
  };
}

/** 记一笔：物种 s 在区块 block 因 cause 死了 n 只。 */
export function recordDeaths(ledger: DeathLedger, s: number, cause: number, block: number, n: number): void {
  if (n === 0) return;
  const i = (s * ledger.causes + cause) * ledger.blocks + block;
  ledger.recent[i] = ledger.recent[i]! + n;
  const t = s * ledger.causes + cause;
  ledger.today[t] = ledger.today[t]! + n;
}

/**
 * 每日结算结束时（closeLedgerDay 之后）：近期死亡整体衰减一天，包括今天刚记的。
 * 个体每小时记的和格子模型每天记的都在同一天结束时衰减，两边一致。
 */
export function decayLedger(ledger: DeathLedger): void {
  const { recent } = ledger;
  for (let i = 0; i < recent.length; i++) recent[i] = recent[i]! * RECENT_KEEP;
}

/** 每日结算结束时：今天的合计挪进 lastDay，今天清零。 */
export function closeLedgerDay(ledger: DeathLedger): void {
  ledger.lastDay.set(ledger.today);
  ledger.today.fill(0);
}

/** 物种 s 在全图（或某个区块）的近期死亡，按死因列出。 */
export function recentByCause(ledger: DeathLedger, s: number, block?: number): number[] {
  const out = new Array<number>(ledger.causes).fill(0);
  for (let cause = 0; cause < ledger.causes; cause++) {
    const base = (s * ledger.causes + cause) * ledger.blocks;
    if (block !== undefined) out[cause] = ledger.recent[base + block]!;
    else for (let b = 0; b < ledger.blocks; b++) out[cause]! += ledger.recent[base + b]!;
  }
  return out;
}

/** 死因的名字（界面、尸检报告用）。names 是各物种的名字。 */
export function causeName(cause: number, names: readonly string[]): string {
  if (cause === CAUSE.starvation) return '饿死';
  if (cause === CAUSE.other) return '其他（衰老、疾病、意外）';
  if (cause === CAUSE.removed) return '人为移除';
  const p = Math.floor((cause - 3) / 2);
  const who = names[p];
  if (!Number.isInteger(cause) || who === undefined) throw new RangeError(`没有这种死因：${cause}`);
  return (cause - 3) % 2 === 0 ? `被${who}捕食` : `巢失败（被${who}吃掉）`;
}
