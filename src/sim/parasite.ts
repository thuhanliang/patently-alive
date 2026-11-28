import type { Pathogen, WorldParams } from '../data/schema/world';
import { detExp } from './detmath';
import { CAUSE, recordDeaths, type DeathLedger } from './ledger';
import type { DerivedSpecies } from './physiology';
import type { DayStats, Population } from './population';
import type { Rng } from './rng';
import { binomial } from './sample';
import { TERRAIN } from './terrain';

/**
 * 寄生虫（2026-11-28，整体回顾 B 段：兽医的病从推演里来）。先只有一类：肠道线虫。
 * 见 docs/MODEL.md 五之十八。
 *
 * 生活史（真实的毛圆线虫、捻转血矛线虫一类）：感染的动物随粪便排出虫卵 → 卵在草上孵成幼虫 →
 * 吃草的动物吃进幼虫被感染 → 在肠里长成虫、再排卵。所以：
 * - 宿主由性状推出（铁律 5）：食谱里植物的比例到了 hostMinPlantDiet 才会吃进幼虫，吃得越多越容易被感染；
 * - 密度越大，草上的幼虫越多，感染率越高：这是"设计的动物太挤"留下的烂摊子，也是课本里的密度制约因素（U4 5.13）。
 *
 * 按拥挤区块（8×8 格）记：每个区块草上的幼虫量（0–1 的污染指数），每个物种在每个区块的成体感染率。
 * 简化（写进 MODEL.md）：
 * - 成体和出了窝的幼体会被感染（窝里的还在吃奶）；新出窝的是干净的，按区块里只数的增加摊薄感染率；
 * - 别的死因（被吃、饿死）对感染的和没感染的一视同仁，所以不改感染率；
 * - 动物在区块之间走动时不带走感染率（区块是 400 米见方，比一般小兽的家域大）；
 * - 展开成个体的动物不单独记感染（体检时按所在区块的感染率抽）。
 */
export interface ParasiteState {
  id: string;
  /** 各区块草上的幼虫量（0–1.5）。 */
  larvae: Float64Array;
  /** 各物种（和 populations 同序）在各区块的成体感染率（0–1）。 */
  prevalence: Float64Array[];
  /** 昨天结束时各物种各区块会被感染的只数（成体和出了窝的幼体；算新来的摊薄用）。 */
  adultsYesterday: Float64Array[];
}

export function isHost(pathogen: Pathogen, sp: DerivedSpecies): boolean {
  return sp.params.diet.plant >= pathogen.hostMinPlantDiet;
}

/** 会被感染的：成体和出了窝、自己吃草的幼体（窝里的还在吃奶）。 */
function hostsByBlock(pop: Population, nestStages: number, blockOf: Int32Array, blocks: number): Float64Array {
  const out = new Float64Array(blocks);
  for (let c = 0; c < pop.adults.length; c++) {
    let n = pop.adults[c]!;
    for (let k = nestStages; k < pop.juveniles.length; k++) n += pop.juveniles[k]![c]!;
    out[blockOf[c]!] = out[blockOf[c]!]! + n;
  }
  return out;
}

/** 开局：草地格所在的区块有 larvae 的幼虫，各物种按 prevalence 感染。世界没写寄生虫时返回 undefined。 */
export function createParasites(
  world: WorldParams,
  species: readonly DerivedSpecies[],
  populations: readonly Population[],
  terrain: Uint8Array,
  blockOf: Int32Array,
  blocks: number,
): ParasiteState[] | undefined {
  if (!world.pathogens || world.pathogens.length === 0) return undefined;
  return world.pathogens.map((pg) => {
    const grassy = new Float64Array(blocks);
    const cells = new Float64Array(blocks);
    for (let c = 0; c < terrain.length; c++) {
      if (terrain[c] === TERRAIN.water) continue;
      cells[blockOf[c]!] = cells[blockOf[c]!]! + 1;
      if (terrain[c] === TERRAIN.grass) grassy[blockOf[c]!] = grassy[blockOf[c]!]! + 1;
    }
    const larvae = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) larvae[b] = cells[b]! > 0 ? (pg.larvae * grassy[b]!) / cells[b]! : 0;
    return {
      id: pg.id,
      larvae,
      prevalence: species.map((sp) => new Float64Array(blocks).fill(isHost(pg, sp) ? (pg.prevalence[sp.params.id] ?? 0) : 0)),
      adultsYesterday: populations.map((p, i) => hostsByBlock(p, species[i]!.nestStages, blockOf, blocks)),
    };
  });
}

/** 引进了新物种：它的感染率从 0 开始（事务所繁育的、或检疫过的动物是干净的）。 */
export function growParasites(ps: ParasiteState[] | undefined, blocks: number): void {
  if (!ps) return;
  for (const p of ps) {
    p.prevalence.push(new Float64Array(blocks));
    p.adultsYesterday.push(new Float64Array(blocks));
  }
}

export interface ParasiteContext {
  world: WorldParams;
  species: readonly DerivedSpecies[];
  populations: Population[];
  blockOf: Int32Array;
  cellsIn: Float64Array;
  cellAreaM2: number;
  rng: Rng;
  ledger: DeathLedger;
  /** 当天的账（额外的死亡记进 deathsOther）。 */
  stats: DayStats[];
}

/** 一天：摊薄、额外死亡、感染和清除、排卵、幼虫死亡。 */
export function parasiteDaily(ps: ParasiteState[], ctx: ParasiteContext): void {
  const blocks = ctx.cellsIn.length;
  ps.forEach((st) => {
    const pg = ctx.world.pathogens!.find((p) => p.id === st.id);
    if (!pg) return;
    const shed = new Float64Array(blocks);
    ctx.species.forEach((sp, s) => {
      const prev = st.prevalence[s]!;
      const pop = ctx.populations[s]!;
      const now = hostsByBlock(pop, sp.nestStages, ctx.blockOf, blocks);
      const yest = st.adultsYesterday[s]!;
      if (!isHost(pg, sp)) {
        st.adultsYesterday[s] = now;
        return;
      }
      // 1. 新长成（或新放进来）的成体是干净的：成体多出来的部分摊薄感染率。
      for (let b = 0; b < blocks; b++) if (now[b]! > yest[b]! && now[b]! > 0) prev[b] = (prev[b]! * yest[b]!) / now[b]!;
      // 2. 额外的死亡：每格先抽有几只感染的，再抽其中几只今天死。
      const died = new Float64Array(blocks);
      const kill = (arr: Int32Array, c: number, b: number): void => {
        const n = arr[c]!;
        if (n === 0) return;
        const inf = binomial(ctx.rng, n, prev[b]!);
        const d = inf > 0 ? binomial(ctx.rng, inf, pg.deathPerDay) : 0;
        if (d === 0) return;
        arr[c] = n - d;
        died[b] = died[b]! + d;
        recordDeaths(ctx.ledger, s, CAUSE.parasite, b, d);
        ctx.stats[s]!.deathsOther += d;
      };
      for (let c = 0; c < pop.adults.length; c++) {
        const b = ctx.blockOf[c]!;
        if (prev[b]! <= 0) continue;
        kill(pop.adults, c, b);
        for (let k = sp.nestStages; k < pop.juveniles.length; k++) kill(pop.juveniles[k]!, c, b);
      }
      for (let b = 0; b < blocks; b++) {
        const N = now[b]!;
        if (N <= 0) {
          prev[b] = 0;
          continue;
        }
        // 死掉的都是感染的：感染率按剩下的算。
        const left = N - died[b]!;
        let p = left > 0 ? Math.max(0, (prev[b]! * N - died[b]!) / left) : 0;
        // 3. 感染：吃进草上的幼虫（吃得越多的植物，吃进越多）；自己清掉一部分。
        const lam = pg.infectRate * st.larvae[b]! * sp.params.diet.plant;
        p += (1 - p) * (1 - detExp(-lam));
        p *= 1 - pg.clearPerDay;
        prev[b] = Math.min(1, p);
        now[b] = left;
        // 4. 排卵：每平方米有多少只感染的成体。
        const area = ctx.cellsIn[b]! * ctx.cellAreaM2;
        if (area > 0) shed[b] = shed[b]! + (prev[b]! * left) / area;
      }
      st.adultsYesterday[s] = now;
    });
    // 5. 幼虫：新排的加上，旧的按寿命死掉。
    const keep = detExp(-1 / pg.larvaeDays);
    for (let b = 0; b < blocks; b++) st.larvae[b] = Math.min(1.5, st.larvae[b]! * keep + pg.shedPerHostDensity * shed[b]!);
  });
}

/** 驱虫：在 (x, y) 周围 radius 格的区块里，给物种 s 投药饵，感染率降到 (1 − efficacy) 倍。草上的幼虫不受影响（会再感染）。 */
export function deworm(ps: ParasiteState[] | undefined, s: number, x: number, y: number, radius: number, efficacy: number, width: number, height: number, blockOf: Int32Array): void {
  if (!ps) return;
  const hit = new Set<number>();
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height || dx * dx + dy * dy > radius * radius) continue;
      hit.add(blockOf[cy * width + cx]!);
    }
  for (const st of ps) {
    const prev = st.prevalence[s];
    if (!prev) continue;
    for (const b of hit) prev[b] = prev[b]! * (1 - efficacy);
  }
}

/** 一个物种在一个区块的感染率（所有寄生虫里最高的那个；没有寄生虫是 0）。 */
export function prevalenceAt(ps: ParasiteState[] | undefined, s: number, b: number): { p: number; id: string } | null {
  if (!ps) return null;
  let best: { p: number; id: string } | null = null;
  for (const st of ps) {
    const p = st.prevalence[s]?.[b] ?? 0;
    if (!best || p > best.p) best = { p, id: st.id };
  }
  return best;
}
