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
 * 所以区块里的数是"最近"的而不是累计的。
 *
 * 新鲜尸体（fresh）：最近 FRESH_DAYS 天里死在各区块的尸体，按天分槽存，过了这几天就腐烂、找不到了。
 * 尸检只能找新鲜尸体；被兽医队移除的不留在野外，不算。尸检找到一具就从这里拿走一具。
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

/**
 * 尸体（和蛋壳、残巢）还能尸检的天数（含死的那天）。小动物的尸体几天内就被吃掉或腐烂，一周后基本找不到。
 * 假设值，见 docs/MODEL.md。
 */
export const FRESH_DAYS = 7;

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
  /** [天槽][物种][死因][区块]，新鲜尸体；freshSlot 是今天的槽。 */
  fresh: Float64Array;
  freshSlot: number;
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
    fresh: new Float64Array(FRESH_DAYS * species * causes * blocks),
    freshSlot: 0,
  };
}

/**
 * 物种数增加时（引种）把账本换成新的布局：死因数随物种数变（每个物种多两种"被它捕食"的死因），
 * 已有的账目原样搬过去，新物种和新死因从 0 开始。返回新账本，旧账本不动。
 */
export function growLedger(old: DeathLedger, species: number): DeathLedger {
  if (species < old.species) throw new RangeError(`物种数只能增加：${old.species} → ${species}`);
  const next = createLedger(species, old.blocks);
  next.freshSlot = old.freshSlot;
  const B = old.blocks;
  for (let s = 0; s < old.species; s++) {
    for (let c = 0; c < old.causes; c++) {
      const from = s * old.causes + c;
      const to = s * next.causes + c;
      next.today[to] = old.today[from]!;
      next.lastDay[to] = old.lastDay[from]!;
      next.recent.set(old.recent.subarray(from * B, (from + 1) * B), to * B);
      for (let slot = 0; slot < FRESH_DAYS; slot++) {
        const f = freshIndex(old, slot, s, c, 0);
        next.fresh.set(old.fresh.subarray(f, f + B), freshIndex(next, slot, s, c, 0));
      }
    }
  }
  return next;
}

/** 记一笔：物种 s 在区块 block 因 cause 死了 n 只。 */
export function recordDeaths(ledger: DeathLedger, s: number, cause: number, block: number, n: number): void {
  if (n === 0) return;
  const i = (s * ledger.causes + cause) * ledger.blocks + block;
  ledger.recent[i] = ledger.recent[i]! + n;
  const t = s * ledger.causes + cause;
  ledger.today[t] = ledger.today[t]! + n;
  if (cause !== CAUSE.removed) {
    const f = freshIndex(ledger, ledger.freshSlot, s, cause, block);
    ledger.fresh[f] = ledger.fresh[f]! + n;
  }
}

/** 新鲜尸体数组里的下标。 */
export function freshIndex(ledger: DeathLedger, slot: number, s: number, cause: number, block: number): number {
  return ((slot * ledger.species + s) * ledger.causes + cause) * ledger.blocks + block;
}

/** 死了几天的那一槽（0 = 今天）。 */
export function freshSlotAgo(ledger: DeathLedger, daysAgo: number): number {
  return (ledger.freshSlot - daysAgo + FRESH_DAYS) % FRESH_DAYS;
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
  // 最老的一槽腐烂了，腾出来记明天的尸体。
  ledger.freshSlot = (ledger.freshSlot + 1) % FRESH_DAYS;
  const size = ledger.species * ledger.causes * ledger.blocks;
  ledger.fresh.fill(0, ledger.freshSlot * size, (ledger.freshSlot + 1) * size);
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

export type DecodedCause =
  | { kind: 'starvation' }
  | { kind: 'other' }
  | { kind: 'removed' }
  | { kind: 'predation'; predator: number }
  | { kind: 'nest'; predator: number };

/** 把死因编号拆开（CAUSE 的反函数）。species 是物种数；不合法的编号抛 RangeError。 */
export function decodeCause(cause: number, species: number): DecodedCause {
  if (cause === CAUSE.starvation) return { kind: 'starvation' };
  if (cause === CAUSE.other) return { kind: 'other' };
  if (cause === CAUSE.removed) return { kind: 'removed' };
  const predator = Math.floor((cause - 3) / 2);
  if (!Number.isInteger(cause) || predator < 0 || predator >= species) throw new RangeError(`没有这种死因：${cause}`);
  return (cause - 3) % 2 === 0 ? { kind: 'predation', predator } : { kind: 'nest', predator };
}

/** 死因的名字（界面用）。names 是各物种的名字。 */
export function causeName(cause: number, names: readonly string[]): string {
  const d = decodeCause(cause, names.length);
  switch (d.kind) {
    case 'starvation':
      return '饿死';
    case 'other':
      return '其他（衰老、疾病、意外）';
    case 'removed':
      return '人为移除';
    case 'predation':
      return `被${names[d.predator]}捕食`;
    case 'nest':
      return `巢失败（被${names[d.predator]}吃掉）`;
  }
}

/** 死亡热力图和警报地点按什么死因筛选（人为移除一律不算）。 */
export type DeathFilter = 'all' | 'predation' | 'nest' | 'starvation' | 'other';

/** 物种 s 每个区块近期死了多少（按死因筛选；人为移除不算）。热力图和警报地点共用这一个定义（铁律 4）。 */
export function deathsByBlock(l: DeathLedger, s: number, filter: DeathFilter): Float64Array {
  const out = new Float64Array(l.blocks);
  for (let cause = 0; cause < l.causes; cause++) {
    if (cause === CAUSE.removed) continue;
    const kind = decodeCause(cause, l.species).kind;
    if (filter !== 'all' && filter !== kind) continue;
    const base = (s * l.causes + cause) * l.blocks;
    for (let b = 0; b < l.blocks; b++) out[b] = out[b]! + l.recent[base + b]!;
  }
  return out;
}
