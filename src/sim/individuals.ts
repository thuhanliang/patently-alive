import type { Grid } from './grid';
import { crossesWater } from './terrain';
import { inFocus, type FocusRect } from './focus';
import {
  CATCH_RADIUS_CELLS,
  CATCH_SUCCESS,
  JUVENILE_SIZE_FACTOR,
  JUVENILE_STAGES,
  MAX_GRAZE_FRACTION,
  NEST_STAGES,
  SATIATION,
  catchSuitability,
  isActive,
  juvenileStageAt,
  type DerivedSpecies,
  usableMeal,
  breedingRoom,
} from './physiology';
import { countAt, type DayStats, type Population } from './population';
import type { Rng } from './rng';

/**
 * 近处的个体。用"结构数组"存：每个字段一个类型化数组，下标 0..count-1 有效。
 * 纯数据，可以快照、序列化、算校验和。
 */
export interface Individuals {
  count: number;
  species: Uint8Array;
  /** 位置（格，浮点；整数部分就是所在格）。 */
  x: Float64Array;
  y: Float64Array;
  /** 上一小时的移动方向（带惯性的随机游走）。 */
  vx: Float64Array;
  vy: Float64Array;
  /** 出生日（第几天；开局前出生的为负数）。年龄 = 今天 − 出生日。 */
  born: Int32Array;
  female: Uint8Array;
  /** 体内储备（够吃几天），低于 0 就开始挨饿。 */
  reserve: Float64Array;
  /** 今天已经吃到的量，占自己日需求的比例。 */
  fed: Float64Array;
}

export function createIndividuals(capacity = 256): Individuals {
  return {
    count: 0,
    species: new Uint8Array(capacity),
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    vx: new Float64Array(capacity),
    vy: new Float64Array(capacity),
    born: new Int32Array(capacity),
    female: new Uint8Array(capacity),
    reserve: new Float64Array(capacity),
    fed: new Float64Array(capacity),
  };
}

const FIELDS = ['species', 'x', 'y', 'vx', 'vy', 'born', 'female', 'reserve', 'fed'] as const;

function ensureCapacity(ind: Individuals, n: number): void {
  if (n <= ind.x.length) return;
  let cap = ind.x.length || 256;
  while (cap < n) cap *= 2;
  for (const f of FIELDS) {
    const old = ind[f];
    const grown = new (old.constructor as new (n: number) => typeof old)(cap);
    grown.set(old as never);
    (ind as unknown as Record<string, unknown>)[f] = grown;
  }
}

/** 第 born 天出生的个体到第 day 天是否还是幼体（和格子里的传送带同一条规则）。 */
export function isJuvenileAt(sp: DerivedSpecies, born: number, day: number): boolean {
  return juvenileStageAt(sp, born, day) < JUVENILE_STAGES;
}

/** 个体按体型折算：幼体算半只（食量、作为猎物的体重）。 */
function sizeOf(sp: DerivedSpecies, born: number, day: number): number {
  return isJuvenileAt(sp, born, day) ? JUVENILE_SIZE_FACTOR : 1;
}

function push(
  ind: Individuals,
  rng: Rng,
  s: number,
  x: number,
  y: number,
  born: number,
  reserve: number,
  fed = 0,
): void {
  ensureCapacity(ind, ind.count + 1);
  const i = ind.count++;
  ind.species[i] = s;
  ind.x[i] = x;
  ind.y[i] = y;
  ind.vx[i] = rng.nextFloat() * 2 - 1;
  ind.vy[i] = rng.nextFloat() * 2 - 1;
  ind.born[i] = born;
  ind.female[i] = rng.nextInt(2);
  ind.reserve[i] = reserve;
  ind.fed[i] = fed;
}

/**
 * 删除被标记的个体，保持其余个体的先后顺序（顺序影响随机数的消耗，必须确定）。
 */
function compact(ind: Individuals, removed: Uint8Array): void {
  const n = ind.count;
  let kept = 0;
  for (let r = 0; r < n; r++) if (!removed[r]) kept += 1;
  if (kept === n) return;
  // 逐个字段压缩：每个内层循环只碰一种数组，比逐个体搬九个字段快得多。
  for (const f of FIELDS) {
    const a = ind[f] as Float64Array;
    let w = 0;
    for (let r = 0; r < n; r++) {
      if (removed[r]) continue;
      if (w !== r) a[w] = a[r]!;
      w += 1;
    }
    a.fill(0, w, n);
  }
  ind.count = kept;
}

// ---------------------------------------------------------------- 展开与收拢

/**
 * 把一格里某物种的计数全部展开成个体，计数清零。
 * dayElapsed 是当天已经过去的比例：一天中途展开的个体，当作已经按时吃过这么多
 * （否则晚上结算时会按"一整天没吃"挨饿，镜头放大的时间点就会影响死亡数）。
 * 出生日按传送带反推：第 k 段的幼体出生在"传送带最近第 k 次挪段"那一段时间里，
 * 在其中均匀抽；成体出生在第 段数 次挪段之前，往前再抽两倍平均成体寿命的范围。
 * 收拢时用 juvenileStageAt 放回同一段，所以展开再收拢逐段相同。
 */
export function expandCell(
  ind: Individuals,
  species: readonly DerivedSpecies[],
  populations: Population[],
  width: number,
  c: number,
  rng: Rng,
  day: number,
  dayElapsed = 0,
): void {
  const cx = c % width;
  const cy = Math.floor(c / width);
  for (let s = 0; s < species.length; s++) {
    const sp = species[s]!;
    const pop = populations[s]!;
    const na = pop.adults[c]!;
    if (countAt(pop, c) === 0) continue;
    const sd = sp.stageDays;
    const fd = Math.floor(day / sd);
    for (let k = 0; k < JUVENILE_STAGES; k++) {
      const n = pop.juveniles[k]![c]!;
      // 第 k 段：出生日在 [(fd−k)·sd, (fd−k+1)·sd) 内，且不晚于今天。
      const bLo = (fd - k) * sd;
      const bHi = Math.min(day, (fd - k + 1) * sd - 1);
      for (let j = 0; j < n; j++) {
        const born = bLo + rng.nextInt(bHi - bLo + 1);
        push(ind, rng, s, cx + rng.nextFloat(), cy + rng.nextFloat(), born, sp.maxReserveDays / 2, dayElapsed);
      }
      pop.juveniles[k]![c] = 0;
    }
    // 成体：出生日不晚于 (fd − 段数 + 1)·sd − 1，往前抽，年龄不超过最长寿命。
    const latestAdultBirth = (fd - JUVENILE_STAGES + 1) * sd - 1;
    const minAdultAge = day - latestAdultBirth;
    const adultSpan = Math.max(1, Math.min(Math.round(2 / sp.adultDailyMortality), sp.maxAgeDays - minAdultAge));
    for (let k = 0; k < na; k++) {
      const born = latestAdultBirth - rng.nextInt(adultSpan);
      push(ind, rng, s, cx + rng.nextFloat(), cy + rng.nextFloat(), born, sp.maxReserveDays / 2, dayElapsed);
    }
    pop.adults[c] = 0;
  }
}

/**
 * 把第 i 个个体收拢进 into（按所在格和年龄归入幼体某一段或成体）。不删除，调用方负责。
 * 一天中途收拢的个体当天已经以个体身份吃过、捕过猎，收进"待合并"计数，
 * 等格子模型算完当天再并回去，免得同一天算两遍。
 */
function collapseOne(
  ind: Individuals,
  species: readonly DerivedSpecies[],
  populations: Population[],
  width: number,
  i: number,
  day: number,
): void {
  const s = ind.species[i]!;
  const c = Math.floor(ind.y[i]!) * width + Math.floor(ind.x[i]!);
  const pop = populations[s]!;
  const sp = species[s]!;
  const k = juvenileStageAt(sp, ind.born[i]!, day);
  if (k < JUVENILE_STAGES) {
    const stage = pop.juveniles[k]!;
    stage[c] = stage[c]! + 1;
  } else {
    pop.adults[c] = pop.adults[c]! + 1;
  }
}

/**
 * 换关注区：新关注区外的个体收拢进 collapseInto；新关注区里、旧关注区外的格子展开。
 * 两边都在的格子里的个体原样保留（年龄、储备、位置都不丢）。
 * dayElapsed 是当天已经过去的比例（见 expandCell）。
 */
export function applyFocus(
  ind: Individuals,
  species: readonly DerivedSpecies[],
  populations: Population[],
  collapseInto: Population[],
  grid: Grid,
  from: FocusRect | null,
  to: FocusRect | null,
  rng: Rng,
  day: number,
  dayElapsed = 0,
): void {
  const removed = new Uint8Array(ind.count);
  for (let i = 0; i < ind.count; i++) {
    if (!inFocus(to, Math.floor(ind.x[i]!), Math.floor(ind.y[i]!))) {
      collapseOne(ind, species, collapseInto, grid.width, i, day);
      removed[i] = 1;
    }
  }
  compact(ind, removed);
  if (!to) return;
  for (let y = to.y0; y < to.y1; y++) {
    for (let x = to.x0; x < to.x1; x++) {
      if (!inFocus(from, x, y)) expandCell(ind, species, populations, grid.width, y * grid.width + x, rng, day, dayElapsed);
    }
  }
}

/** 关注区里的格子如果又有了计数（从外面扩散进来的），展开成个体。 */
export function absorbImmigrants(
  ind: Individuals,
  species: readonly DerivedSpecies[],
  populations: Population[],
  grid: Grid,
  focus: FocusRect | null,
  rng: Rng,
  day: number,
): void {
  if (!focus) return;
  for (let y = focus.y0; y < focus.y1; y++) {
    for (let x = focus.x0; x < focus.x1; x++) {
      const c = y * grid.width + x;
      let has = false;
      for (const p of populations) if (countAt(p, c) > 0) has = true;
      if (has) expandCell(ind, species, populations, grid.width, c, rng, day);
    }
  }
}

export function countBySpecies(ind: Individuals, speciesCount: number): number[] {
  const out = new Array<number>(speciesCount).fill(0);
  for (let i = 0; i < ind.count; i++) out[ind.species[i]!]! += 1;
  return out;
}

// ---------------------------------------------------------------- 每小时

export interface HourlyContext {
  species: readonly DerivedSpecies[];
  /** 走出关注区的个体收进这里（待合并计数），当天格子模型算完后再并回去。 */
  emigrants: Population[];
  grid: Grid;
  focus: FocusRect;
  hour: number;
  /** 传送带的当前日（见 Sim.day），判断成年用。 */
  day: number;
  cellAreaM2: number;
  floorBiomass: number;
  rng: Rng;
  /** 当天累计的账目（被捕食的计入这里）。 */
  stats: DayStats[];
}

/**
 * 一小时：活动中的个体移动、食草动物吃草、捕食者在附近找活动中的猎物。
 * 走出关注区的个体立即收拢回所在格的计数。
 */
export function individualsHourly(ind: Individuals, ctx: HourlyContext): void {
  const { species, grid, focus, hour, rng } = ctx;
  const removed = new Uint8Array(ind.count);
  // 按物种预先算好这一小时的量，内层循环只查表。
  const active = Uint8Array.from(species, (sp) => (isActive(sp.params.activity, hour) ? 1 : 0));
  const xs = ind.x;
  const ys = ind.y;
  const { x0, y0, x1, y1 } = focus;

  // 移动与吃草。
  for (let i = 0; i < ind.count; i++) {
    const s = ind.species[i]!;
    if (!active[s]) continue;
    const sp = species[s]!;

    // 窝里的幼崽不走动（和格子模型里前几个年龄段不扩散一致），但照样吃东西。
    const nested = juvenileStageAt(sp, ind.born[i]!, ctx.day) < NEST_STAGES;
    if (nested) {
      if (sp.herbivore) graze(ind, i, sp, grid, ctx);
      continue;
    }

    // 带惯性的随机游走：七成沿用上一小时的方向，三成随机转向，步长固定。
    let vx = 0.7 * ind.vx[i]! + 0.3 * (rng.nextFloat() * 2 - 1);
    let vy = 0.7 * ind.vy[i]! + 0.3 * (rng.nextFloat() * 2 - 1);
    const len = Math.sqrt(vx * vx + vy * vy);
    if (len > 0) {
      vx /= len;
      vy /= len;
    }
    let nx = xs[i]! + vx * sp.hourlyStepCells;
    let ny = ys[i]! + vy * sp.hourlyStepCells;
    // 碰到地图边缘就反弹。
    if (nx < 0 || nx >= grid.width) {
      vx = -vx;
      nx = Math.min(grid.width - 1e-9, Math.max(0, ind.x[i]! + vx * sp.hourlyStepCells));
    }
    if (ny < 0 || ny >= grid.height) {
      vy = -vy;
      ny = Math.min(grid.height - 1e-9, Math.max(0, ind.y[i]! + vy * sp.hourlyStepCells));
    }
    // 走到水边就掉头，这一小时留在原地（不会游泳；一步走一格以上时，中途也不能过水）。
    if (crossesWater(grid.terrain, grid.width, xs[i]!, ys[i]!, nx, ny)) {
      vx = -vx;
      vy = -vy;
      nx = xs[i]!;
      ny = ys[i]!;
    }
    ind.x[i] = nx;
    ind.y[i] = ny;
    ind.vx[i] = vx;
    ind.vy[i] = vy;

    if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) {
      collapseOne(ind, species, ctx.emigrants, grid.width, i, ctx.day);
      removed[i] = 1;
      continue;
    }

    if (sp.herbivore) graze(ind, i, sp, grid, ctx);
  }

  hunt(ind, ctx, removed, active);
  compact(ind, removed);
}

/** 食草个体吃这一小时的份额（不超过所在格能啃的量）。 */
function graze(ind: Individuals, i: number, sp: DerivedSpecies, grid: Grid, ctx: HourlyContext): void {
  const c = Math.floor(ind.y[i]!) * grid.width + Math.floor(ind.x[i]!);
  const need = sp.dailyIntakeG * sizeOf(sp, ind.born[i]!, ctx.day);
  const available = Math.max(0, grid.vegetation[c]! - ctx.floorBiomass) * ctx.cellAreaM2 * MAX_GRAZE_FRACTION;
  const eaten = Math.min(need / sp.activeHours, available);
  grid.vegetation[c] = grid.vegetation[c]! - eaten / ctx.cellAreaM2;
  ind.fed[i] = ind.fed[i]! + eaten / need;
}

/**
 * 捕食：活动中的捕食者在 CATCH_RADIUS 内碰上活动中的猎物，按体型适合度 × 成功率抓。
 * 活动时段的重叠在这里自然体现（不活动的猎物碰不上），不再乘重叠系数。
 * 用按格的链表找附近的猎物。
 */
function hunt(ind: Individuals, ctx: HourlyContext, removed: Uint8Array, active: Uint8Array): void {
  const { species, focus, rng } = ctx;
  const hunting = Uint8Array.from(species, (sp, s) => (!sp.herbivore && active[s] ? 1 : 0));
  const predators: number[] = [];
  for (let i = 0; i < ind.count; i++) {
    if (!removed[i] && hunting[ind.species[i]!] && ind.fed[i]! < SATIATION) predators.push(i);
  }
  if (predators.length === 0) return;

  const fw = focus.x1 - focus.x0;
  const fh = focus.y1 - focus.y0;
  const head = new Int32Array(fw * fh).fill(-1);
  const next = new Int32Array(ind.count).fill(-1);
  for (let i = ind.count - 1; i >= 0; i--) {
    if (removed[i] || !active[ind.species[i]!]) continue;
    const lc = (Math.floor(ind.y[i]!) - focus.y0) * fw + (Math.floor(ind.x[i]!) - focus.x0);
    next[i] = head[lc]!;
    head[lc] = i;
  }

  const r2 = CATCH_RADIUS_CELLS * CATCH_RADIUS_CELLS;
  for (const p of predators) {
    if (removed[p]) continue;
    const ps = ind.species[p]!;
    const pred = species[ps]!;
    const predMass = pred.bodyMassG * sizeOf(pred, ind.born[p]!, ctx.day);
    const need = pred.dailyIntakeG * sizeOf(pred, ind.born[p]!, ctx.day);
    const px = ind.x[p]!;
    const py = ind.y[p]!;
    const lx = Math.floor(px) - focus.x0;
    const ly = Math.floor(py) - focus.y0;
    for (let dy = -1; dy <= 1 && ind.fed[p]! < SATIATION; dy++) {
      for (let dx = -1; dx <= 1 && ind.fed[p]! < SATIATION; dx++) {
        const gx = lx + dx;
        const gy = ly + dy;
        if (gx < 0 || gy < 0 || gx >= fw || gy >= fh) continue;
        for (let q = head[gy * fw + gx]!; q !== -1 && ind.fed[p]! < SATIATION; q = next[q]!) {
          if (q === p || removed[q]) continue;
          const qs = ind.species[q]!;
          if (qs === ps) continue;
          const ddx = ind.x[q]! - px;
          const ddy = ind.y[q]! - py;
          if (ddx * ddx + ddy * ddy > r2) continue;
          const prey = species[qs]!;
          const preyMass = prey.bodyMassG * sizeOf(prey, ind.born[q]!, ctx.day);
          const chance = catchSuitability(pred, prey, preyMass / predMass) * CATCH_SUCCESS;
          if (chance <= 0 || rng.nextFloat() >= chance) continue;
          removed[q] = 1;
          ctx.stats[qs]!.deathsPredation += 1;
          // 吃不完的浪费掉，按个体自己的需求折算。
          ind.fed[p] = ind.fed[p]! + usableMeal(pred, need, preyMass) / need;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 每天

export interface IndividualDailyContext {
  species: readonly DerivedSpecies[];
  width: number;
  /** 传送带的当前日（见 Sim.day），判断成年用。 */
  day: number;
  /** 当月各物种的繁殖期系数。 */
  breeding: readonly number[];
  /** 各物种各区块的拥挤程度。 */
  crowding: readonly Float64Array[];
  /** 每格属于哪个拥挤区块。 */
  blockOf: Int32Array;
  rng: Rng;
  stats: DayStats[];
}

/**
 * 一天：结算储备、死亡（基础、饥饿）、出生。年龄由出生日和当天推出，不用逐日加一。
 * 和格子模型一样没有"到最长寿命必死"：死亡率不随年龄变化，最长寿命只用来限制展开时分配的年龄。
 * 储备 = 上限内的（昨天储备 + 今天吃到的 − 1 天的需求）；低于 0 时按缺口挨饿。
 */
export function individualsDaily(ind: Individuals, ctx: IndividualDailyContext): void {
  const { species, rng, stats } = ctx;
  const removed = new Uint8Array(ind.count);
  const born: Array<[number, number, number]> = [];

  for (let i = 0; i < ind.count; i++) {
    const s = ind.species[i]!;
    const sp = species[s]!;
    const juvenile = isJuvenileAt(sp, ind.born[i]!, ctx.day);

    const reserve = Math.max(-1, Math.min(sp.maxReserveDays, ind.reserve[i]! + ind.fed[i]! - 1));
    ind.reserve[i] = reserve;
    ind.fed[i] = 0;

    const base = juvenile ? sp.juvenileDailyMortality : sp.adultDailyMortality;
    const starve = reserve < 0 ? sp.starvationRate * Math.min(1, -reserve) : 0;
    if (rng.nextFloat() < base + starve) {
      removed[i] = 1;
      // 和格子模型一样按两种死因的比重拆分。
      if (starve > 0 && rng.nextFloat() < starve / (base + starve)) stats[s]!.deathsStarvation += 1;
      else stats[s]!.deathsOther += 1;
      continue;
    }

    // 出生：繁殖期内的成年雌性；越拥挤、越饿生得越少。
    const breeding = ctx.breeding[s]!;
    if (!juvenile && ind.female[i] && breeding > 0) {
      const block = ctx.blockOf[Math.floor(ind.y[i]!) * ctx.width + Math.floor(ind.x[i]!)]!;
      const room = breedingRoom(sp, ctx.crowding[s]![block]!);
      const condition = reserve >= 0 ? 1 : 0.5;
      if (room > 0 && rng.nextFloat() < breeding * sp.litterRate * room * condition) {
        const size = sp.params.reproduction.litterSize;
        const n = Math.floor(size) + (rng.nextFloat() < size - Math.floor(size) ? 1 : 0);
        for (let k = 0; k < n; k++) born.push([s, ind.x[i]!, ind.y[i]!]);
        stats[s]!.births += n;
      }
    }
  }

  compact(ind, removed);
  for (const [s, x, y] of born) push(ind, rng, s, x, y, ctx.day, species[s]!.maxReserveDays / 2);
}
