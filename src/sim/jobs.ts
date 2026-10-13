import type { CullParams, NecropsyParams, TrapType } from '../data/schema/tools';
import type { Fence } from './fence';
import type { Grid } from './grid';
import type { Individuals } from './individuals';
import { JUVENILE_SIZE_FACTOR, juvenileStageAt, type DerivedSpecies } from './physiology';
import type { DayStats, Population } from './population';
import { CAUSE, FRESH_DAYS, freshIndex, freshSlotAgo, recordDeaths, type DeathLedger } from './ledger';
import type { Rng } from './rng';
import { binomial } from './sample';
import { TERRAIN } from './terrain';

/**
 * 兽医队在野外的活：陷阱线、夜间搜捕、找尸体、架围栏。每晚（每日结算结束前）执行一次。
 *
 * 陷阱抓到谁由性状推出：
 * - 动物在陷阱附近多大范围内会碰上它：每天走的距离的一半（catchmentRadius），猫远、鼠近；
 * - 一晚找到陷阱的概率：TRAP_ENCOUNTER / 吸引范围的半径——走得远的动物附近只数多，但每只路过陷阱的机会小；
 * - 找到之后进不进笼：诱饵的吸引力（按食谱）× 能不能触发机关（体重在范围内）；
 * - 一个笼子一晚最多关一只，进笼的比笼子多时随机挑。
 * 抓到的按玩家给的名单处理：名单上的物种移除（记作"人为移除"），其余当场放生，都记进捕获记录。
 */

/**
 * 吸引范围半径为 1 格、诱饵吸引力为 1、体重合适的动物，一晚进笼的概率；半径越大越小（÷ 半径）。
 * 取 1：一组鼠笼头几晚每晚约十只鼠，之后附近的鼠被抓少了就慢下来；一组猫笼约四晚抓到一只猫。假设值，见 docs/MODEL.md。
 */
export const TRAP_ENCOUNTER = 1;
/** 陷阱的吸引范围最大多少格（限制计算量）。 */
export const MAX_CATCHMENT_CELLS = 25;
/** 捕获记录最多留多少条（最近的）。 */
export const CAPTURE_LOG = 300;
/** 尸检记录最多留多少次搜寻（最近的）。 */
export const NECROPSY_LOG = 50;

export interface TrapJob {
  kind: 'trap';
  id: number;
  /** 陷阱类型在 tools.traps 里的下标。 */
  trap: number;
  x: number;
  y: number;
  nightsLeft: number;
  /** 抓到就移除的物种（下标）；其余放生。 */
  remove: number[];
}

export interface CullJob {
  kind: 'cull';
  id: number;
  x: number;
  y: number;
  nightsLeft: number;
  species: number;
}

/** 找尸体：在 (x, y) 一带搜一天；species 为 −1 时什么物种的都要。 */
export interface NecropsyJob {
  kind: 'necropsy';
  id: number;
  x: number;
  y: number;
  nightsLeft: number;
  species: number;
}

/** 架围栏：最后一晚完工，之后才挡得住动物。 */
export interface FenceJob {
  kind: 'fence';
  id: number;
  /** 批注画在起点。 */
  x: number;
  y: number;
  nightsLeft: number;
  fence: Fence;
}

export type Job = TrapJob | CullJob | NecropsyJob | FenceJob;

/** 找到的一具尸体：哪个物种、死因（引擎记账，见 ledger.ts）、在哪一格、死了几天。 */
export interface Carcass {
  species: number;
  cause: number;
  x: number;
  y: number;
  /** 0 = 当天死的。 */
  daysDead: number;
}

/** 一次找尸体的结果（可能一具也没找到）。 */
export interface NecropsySearch {
  day: number;
  job: number;
  x: number;
  y: number;
  /** 要找的物种，−1 = 不限。 */
  species: number;
  found: Carcass[];
}

/** 一条捕获记录：哪天、哪组陷阱、抓到什么、怎么处理的。 */
export interface Capture {
  day: number;
  job: number;
  /** 陷阱类型（tools.traps 的下标）。 */
  trap: number;
  species: number;
  x: number;
  y: number;
  juvenile: boolean;
  female: boolean;
  removed: boolean;
}

export interface JobContext {
  species: readonly DerivedSpecies[];
  traps: readonly TrapType[];
  cull: CullParams | undefined;
  necropsy: NecropsyParams | undefined;
  populations: Population[];
  individuals: Individuals;
  grid: Grid;
  cellSizeM: number;
  day: number;
  rng: Rng;
  stats: DayStats[];
  ledger: DeathLedger;
  blockOf: Int32Array;
  captures: Capture[];
  necropsies: NecropsySearch[];
  /** 每个区块有几格陆地。 */
  blockCells: Float64Array;
  /** 完工的围栏加进这里。 */
  fences: Fence[];
  /** 被移除的个体在这里标记，调用方负责压缩。 */
  removedIndividuals: Uint8Array;
}

/** 动物会在多大范围内碰上陷阱（格）：每天走的距离的一半，夹在 1 到 MAX_CATCHMENT_CELLS 之间。 */
export function catchmentRadius(sp: DerivedSpecies, cellSizeM: number): number {
  return Math.max(1, Math.min(MAX_CATCHMENT_CELLS, Math.round(sp.params.movement.dailyRangeM / cellSizeM / 2)));
}

/** 诱饵对一个物种的吸引力：Σ 诱饵对这类食物的吸引力 × 食谱里这一类的比例。 */
export function baitAppeal(trap: TrapType, sp: DerivedSpecies): number {
  const d = sp.params.diet;
  return trap.bait.plant * d.plant + trap.bait.vertebrate * d.vertebrate + trap.bait.invertebrate * d.invertebrate;
}

/** 一只体重为 massKg 的动物能不能触发这种陷阱。 */
export function fitsTrap(trap: TrapType, massKg: number): boolean {
  return massKg >= trap.minMassKg && massKg <= trap.maxMassKg;
}

/** 进笼的候选：格子里的一批（某物种某年龄段），或一只展开的个体。 */
interface Visitor {
  s: number;
  c: number;
  /** 年龄段下标；−1 是成体；−2 是展开的个体（见 ind）。 */
  stage: number;
  ind: number;
  n: number;
}

/** 以 (x, y) 为中心、半径 r 的圆里的陆地格。 */
function landWithin(grid: Grid, x: number, y: number, r: number): number[] {
  const out: number[] = [];
  for (let cy = Math.max(0, y - r); cy <= Math.min(grid.height - 1, y + r); cy++) {
    for (let cx = Math.max(0, x - r); cx <= Math.min(grid.width - 1, x + r); cx++) {
      const c = cy * grid.width + cx;
      if (grid.terrain[c] === TERRAIN.water) continue;
      if ((cx - x) * (cx - x) + (cy - y) * (cy - y) <= r * r) out.push(c);
    }
  }
  return out;
}

/** 一晚：所有进行中的活各做一次，做完的移出列表。 */
export function runJobs(jobs: Job[], ctx: JobContext): Job[] {
  for (const job of jobs) {
    if (job.kind === 'trap') trapNight(job, ctx);
    else if (job.kind === 'cull') cullNight(job, ctx);
    else if (job.kind === 'necropsy') necropsyDay(job, ctx);
    else if (job.nightsLeft === 1) ctx.fences.push({ ...job.fence });
    job.nightsLeft -= 1;
  }
  return jobs.filter((j) => j.nightsLeft > 0);
}

function trapNight(job: TrapJob, ctx: JobContext): void {
  const trap = ctx.traps[job.trap]!;
  const { species, populations, individuals: ind, grid, rng } = ctx;
  const visitors: Visitor[] = [];
  species.forEach((sp, s) => {
    const appeal = baitAppeal(trap, sp);
    if (appeal <= 0) return;
    const r = catchmentRadius(sp, ctx.cellSizeM);
    const p = Math.min(1, (TRAP_ENCOUNTER * appeal) / r);
    const adultP = fitsTrap(trap, sp.params.bodyMassKg) ? p : 0;
    const juvP = fitsTrap(trap, sp.params.bodyMassKg * JUVENILE_SIZE_FACTOR) ? p : 0;
    if (adultP === 0 && juvP === 0) return;
    const pop = populations[s]!;
    for (const c of landWithin(grid, job.x, job.y, r)) {
      // 窝里的幼体不出窝，碰不上陷阱。
      const na = binomial(rng, pop.adults[c]!, adultP);
      if (na > 0) visitors.push({ s, c, stage: -1, ind: -1, n: na });
      for (let k = sp.nestStages; k < pop.juveniles.length; k++) {
        const nj = binomial(rng, pop.juveniles[k]![c]!, juvP);
        if (nj > 0) visitors.push({ s, c, stage: k, ind: -1, n: nj });
      }
    }
    // 展开的个体：在范围里的逐只抽。
    for (let i = 0; i < ind.count; i++) {
      if (ind.species[i] !== s || ctx.removedIndividuals[i]) continue;
      const dx = ind.x[i]! - (job.x + 0.5);
      const dy = ind.y[i]! - (job.y + 0.5);
      if (dx * dx + dy * dy > r * r) continue;
      const k = juvenileStageAt(sp, ind.born[i]!, ctx.day);
      if (k < sp.nestStages) continue;
      const pi = k >= sp.juvenileStages ? adultP : juvP;
      if (pi > 0 && rng.nextFloat() < pi) {
        visitors.push({ s, c: Math.floor(ind.y[i]!) * grid.width + Math.floor(ind.x[i]!), stage: -2, ind: i, n: 1 });
      }
    }
  });

  // 笼子比进笼的少时，随机挑哪些被关住。
  let total = visitors.reduce((a, v) => a + v.n, 0);
  for (let cage = 0; cage < trap.cages && total > 0; cage++) {
    let pick = rng.nextInt(total);
    let v = visitors[0]!;
    for (const cand of visitors) {
      if (pick < cand.n) {
        v = cand;
        break;
      }
      pick -= cand.n;
    }
    v.n -= 1;
    total -= 1;
    catchOne(job, v, ctx);
  }
}

function catchOne(job: TrapJob, v: Visitor, ctx: JobContext): void {
  const { species, populations, rng, grid } = ctx;
  const remove = job.remove.includes(v.s);
  const sp = species[v.s]!;
  const juvenile = v.stage >= 0 || (v.stage === -2 && juvenileStageAt(sp, ctx.individuals.born[v.ind]!, ctx.day) < sp.juvenileStages);
  const female = v.stage === -2 ? ctx.individuals.female[v.ind] === 1 : rng.nextInt(2) === 1;
  if (remove) {
    const pop = populations[v.s]!;
    if (v.stage === -1) pop.adults[v.c] = pop.adults[v.c]! - 1;
    else if (v.stage >= 0) pop.juveniles[v.stage]![v.c] = pop.juveniles[v.stage]![v.c]! - 1;
    else ctx.removedIndividuals[v.ind] = 1;
    ctx.stats[v.s]!.removed += 1;
    recordDeaths(ctx.ledger, v.s, CAUSE.removed, ctx.blockOf[v.c]!, 1);
  }
  ctx.captures.push({ day: ctx.day, job: job.id, trap: job.trap, species: v.s, x: v.c % grid.width, y: Math.floor(v.c / grid.width), juvenile, female, removed: remove });
  if (ctx.captures.length > CAPTURE_LOG) ctx.captures.splice(0, ctx.captures.length - CAPTURE_LOG);
}

/** 夜间搜捕：范围里目标物种的成体和出了窝的幼体，每只以 success 的概率被找到、移除。 */
function cullNight(job: CullJob, ctx: JobContext): void {
  const params = ctx.cull;
  if (!params) return;
  const { populations, individuals: ind, grid, rng } = ctx;
  const s = job.species;
  const sp = ctx.species[s]!;
  const pop = populations[s]!;
  for (const c of landWithin(grid, job.x, job.y, params.radiusCells)) {
    let n = binomial(rng, pop.adults[c]!, params.success);
    pop.adults[c] = pop.adults[c]! - n;
    for (let k = sp.nestStages; k < pop.juveniles.length; k++) {
      const nj = binomial(rng, pop.juveniles[k]![c]!, params.success);
      pop.juveniles[k]![c] = pop.juveniles[k]![c]! - nj;
      n += nj;
    }
    ctx.stats[s]!.removed += n;
    recordDeaths(ctx.ledger, s, CAUSE.removed, ctx.blockOf[c]!, n);
  }
  const r2 = params.radiusCells * params.radiusCells;
  for (let i = 0; i < ind.count; i++) {
    if (ind.species[i] !== s || ctx.removedIndividuals[i]) continue;
    const dx = ind.x[i]! - (job.x + 0.5);
    const dy = ind.y[i]! - (job.y + 0.5);
    if (dx * dx + dy * dy > r2) continue;
    if (juvenileStageAt(sp, ind.born[i]!, ctx.day) < sp.nestStages) continue;
    if (rng.nextFloat() < params.success) {
      ctx.removedIndividuals[i] = 1;
      ctx.stats[s]!.removed += 1;
      recordDeaths(ctx.ledger, s, CAUSE.removed, ctx.blockOf[Math.floor(ind.y[i]!) * grid.width + Math.floor(ind.x[i]!)]!, 1);
    }
  }
}

/**
 * 找尸体：范围里每具新鲜尸体以 detection 的概率被找到，最多带回 maxCarcasses 具（多了随机挑）。
 * 尸体按区块记账，范围只盖住区块的一部分时按盖住的陆地格比例算；找到的那具在区块和范围重叠的格子里随机定一格。
 * 带回来的从新鲜尸体里拿走。
 */
function necropsyDay(job: NecropsyJob, ctx: JobContext): void {
  const params = ctx.necropsy;
  if (!params) return;
  const { ledger, grid, rng } = ctx;
  // 范围里的陆地格按区块分组（区块编号从小到大，结果与遍历顺序无关）。
  const byBlock = new Map<number, number[]>();
  for (const c of landWithin(grid, job.x, job.y, params.radiusCells)) {
    const b = ctx.blockOf[c]!;
    const list = byBlock.get(b);
    if (list) list.push(c);
    else byBlock.set(b, [c]);
  }
  const blocks = [...byBlock.keys()].sort((a, b) => a - b);

  const seen: { s: number; cause: number; block: number; ago: number; n: number }[] = [];
  for (const block of blocks) {
    const p = params.detection * Math.min(1, byBlock.get(block)!.length / ctx.blockCells[block]!);
    for (let s = 0; s < ledger.species; s++) {
      if (job.species >= 0 && s !== job.species) continue;
      for (let cause = 0; cause < ledger.causes; cause++) {
        if (cause === CAUSE.removed) continue;
        for (let ago = 0; ago < FRESH_DAYS; ago++) {
          const n = Math.floor(ledger.fresh[freshIndex(ledger, freshSlotAgo(ledger, ago), s, cause, block)]!);
          const k = n > 0 ? binomial(rng, n, p) : 0;
          if (k > 0) seen.push({ s, cause, block, ago, n: k });
        }
      }
    }
  }

  const found: Carcass[] = [];
  let total = seen.reduce((a, v) => a + v.n, 0);
  while (found.length < params.maxCarcasses && total > 0) {
    let pick = rng.nextInt(total);
    let v = seen[0]!;
    for (const cand of seen) {
      if (pick < cand.n) {
        v = cand;
        break;
      }
      pick -= cand.n;
    }
    v.n -= 1;
    total -= 1;
    const i = freshIndex(ledger, freshSlotAgo(ledger, v.ago), v.s, v.cause, v.block);
    ledger.fresh[i] = ledger.fresh[i]! - 1;
    const cells = byBlock.get(v.block)!;
    const c = cells[rng.nextInt(cells.length)]!;
    found.push({ species: v.s, cause: v.cause, x: c % grid.width, y: Math.floor(c / grid.width), daysDead: v.ago });
  }
  ctx.necropsies.push({ day: ctx.day, job: job.id, x: job.x, y: job.y, species: job.species, found });
  if (ctx.necropsies.length > NECROPSY_LOG) ctx.necropsies.splice(0, ctx.necropsies.length - NECROPSY_LOG);
}
