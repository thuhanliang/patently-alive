import { describe, expect, it } from 'vitest';
import { archiveLibrary, scenarioLibrary, speciesFor, speciesLibrary, tools, worldFor, type WorldParams } from '../src/data';
import { checksum, deserialize, scenarioRules, serialize, Session, speciesOf, TICKS_PER_DAY, countAt, type Rules } from '../src/sim';
import { applyFocus } from '../src/sim/individuals';
import { baitAppeal } from '../src/sim/jobs';
import { deriveAll, deriveSpecies } from '../src/sim/physiology';
import { shoreSupplyByBlock } from '../src/sim/population';
import { Rng } from '../src/sim/rng';
import { TERRAIN } from '../src/sim/terrain';

/** 欧亚水獭和水边的食物（2026-10-22）：用 48×48 的小鸟岛（试验场）。 */
const scenario = scenarioLibrary.get('bird-island-small')!;
const world: WorldParams = worldFor(scenario);
const rules: Rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 }, staff: 10, budget: 10_000_000 };
const otter = speciesLibrary.get('otter')!;

/** 主岛上的海岸格，按下标顺序。 */
function coastCells(s: Session): { x: number; y: number }[] {
  const g = s.sim.state.grid;
  const out: { x: number; y: number }[] = [];
  for (let c = 0; c < g.terrain.length; c++) if (g.terrain[c] === TERRAIN.coast && g.island[c] === 1) out.push({ x: c % g.width, y: Math.floor(c / g.width) });
  return out;
}

/** 在海岸上放 4 批水獭，返回会话和水獭的物种下标。 */
function withOtters(w: WorldParams = world, seed = 3): { s: Session; o: number } {
  const s = new Session({ seed, world: w, species: speciesFor(w), tools }, rules);
  const coast = coastCells(s);
  for (const f of [0, 0.25, 0.5, 0.75]) expect(s.submit({ type: 'introduce', species: otter, ...coast[Math.floor(f * coast.length)]!, count: 5 }).ok).toBe(true);
  return { s, o: s.sim.species.length - 1 };
}

/** 水獭成体的平均吃饱程度（按 fedLast）。 */
function meanFed(s: Session, o: number): number {
  const pop = s.sim.state.populations[o]!;
  const fed = s.sim.state.fedLast[o]!;
  let f = 0;
  let n = 0;
  for (let c = 0; c < fed.length; c++) {
    const k = pop.adults[c]!;
    f += fed[c]! * k;
    n += k;
  }
  return n > 0 ? f / n : NaN;
}

describe('欧亚水獭', () => {
  it('数据：进档案馆；九成五吃水里的，偶尔掏窝，不追捕会跑的猎物', () => {
    expect(archiveLibrary.has('otter')).toBe(true);
    const d = deriveSpecies(otter, 50);
    expect(d.fisher).toBe(true);
    expect(d.predator).toBe(true);
    expect(d.carnivore).toBe(false);
    // 每天约 1.1 千克鱼蟹（吃肉的系数 230·M^0.75，8 千克）。
    expect(d.aquaticIntakeG).toBeGreaterThan(1000);
    expect(d.aquaticIntakeG).toBeLessThan(1100);
    // 每天走 4 公里，够得着两公里内（5 个 400 米的区块）的海岸。
    expect(d.shoreReachBlocks).toBe(5);
    // 鱼饵、肉饵引得来水獭。
    const meat = tools.traps.find((t) => t.bait.vertebrate > 0)!;
    expect(baitAppeal(meat, d)).toBeGreaterThan(0.5 * meat.bait.vertebrate);
  });

  it('别的物种都不在水边捞吃：不多算水边的食物', () => {
    for (const [id, p] of speciesLibrary) if (id !== 'otter') expect(deriveSpecies(p, 50).fisher).toBe(false);
  });

  it('水边的食物 = 区块里的海岸格数 × 每格面积 × 产量；世界没写 shore 就没有', () => {
    const s = new Session({ seed: 3, world, species: speciesFor(world), tools }, rules);
    const g = s.sim.state.grid;
    const blockOf = new Int32Array(g.terrain.length).map((_, c) => Math.floor((c % g.width) / 8) + Math.floor(Math.floor(c / g.width) / 8) * 6);
    const supply = shoreSupplyByBlock(g, blockOf, 36, 2500, world.shore!.aquaticPerM2)!;
    const total = supply.reduce((a, b) => a + b, 0);
    const coast = g.terrain.filter((t) => t === TERRAIN.coast).length;
    expect(total).toBeCloseTo(coast * 2500 * world.shore!.aquaticPerM2, 6);
    expect(shoreSupplyByBlock(g, blockOf, 36, 2500, undefined)).toBeNull();
  });

  it('岛上有水边的食物：放下去的水獭吃得饱，一年后还在', () => {
    const { s, o } = withOtters();
    s.advance(TICKS_PER_DAY * 30);
    expect(meanFed(s, o)).toBeGreaterThan(0.6);
    s.advance(TICKS_PER_DAY * 335);
    expect(s.sim.totals()[o]).toBeGreaterThan(0);
  });

  it('没有水边的食物：只吃得到那一点肉，饿死', () => {
    const { shore: _, ...dry } = world;
    const { s, o } = withOtters(dry);
    s.advance(TICKS_PER_DAY * 30);
    expect(meanFed(s, o)).toBeLessThan(0.1);
    let starved = 0;
    for (let d = 0; d < 120; d++) {
      s.advance(TICKS_PER_DAY);
      starved += s.sim.state.lastDay[o]!.deathsStarvation;
    }
    expect(starved).toBeGreaterThan(0);
  });

  it('体检：胃里是鱼鳞蟹壳（水生猎物），别的物种的胃不写这一项', () => {
    const { s, o } = withOtters();
    s.advance(TICKS_PER_DAY * 10);
    const pop = s.sim.state.populations[o]!;
    const g = s.sim.state.grid;
    let best = 0;
    for (let c = 1; c < g.terrain.length; c++) if (countAt(pop, c) > countAt(pop, best)) best = c;
    expect(s.submit({ type: 'sample', species: 'otter', x: best % g.width, y: Math.floor(best / g.width) })).toEqual({ ok: true });
    expect(s.submit({ type: 'sample', species: 'rat', x: best % g.width, y: Math.floor(best / g.width) })).toEqual({ ok: true });
    s.advance(TICKS_PER_DAY * 2);
    const caps = s.sim.state.captures;
    const otters = caps.filter((c) => c.species === o && c.stomach.fullness > 0.1);
    expect(otters.length).toBeGreaterThan(0);
    for (const c of otters) expect(c.stomach.aquatic!).toBeGreaterThan(0.5);
    for (const c of caps.filter((c) => c.species !== o)) expect(c.stomach.aquatic).toBeUndefined();
  });

  it('展开后立刻收拢：水獭的每格每个年龄段的数量逐一相同', () => {
    const { s, o } = withOtters();
    s.advance(TICKS_PER_DAY * 120);
    const state = s.sim.snapshot();
    const before = JSON.stringify(state.populations.map((p) => [p.juveniles.map((st) => Array.from(st)), Array.from(p.adults)]));
    const { derived } = deriveAll(speciesOf(state), state.config.world.cellSizeM);
    const focus = { x0: 0, y0: 0, x1: 48, y1: 48 };
    applyFocus(state.individuals, derived, state.populations, state.populations, state.grid, null, focus, Rng.fromSeed(9), s.sim.day);
    let ottersOut = 0;
    for (let i = 0; i < state.individuals.count; i++) if (state.individuals.species[i] === o) ottersOut++;
    expect(ottersOut).toBeGreaterThan(0);
    applyFocus(state.individuals, derived, state.populations, state.populations, state.grid, focus, null, Rng.fromSeed(9), s.sim.day);
    expect(JSON.stringify(state.populations.map((p) => [p.juveniles.map((st) => Array.from(st)), Array.from(p.adults)]))).toBe(before);
  });

  it('关注区里有水獭时：存档读档后接着跑，和一直跑的结果逐位相同', () => {
    const run = (): Session => {
      const { s } = withOtters();
      s.advance(TICKS_PER_DAY * 20);
      // 关注区对齐到 8 格，盖住水獭最多的那一格。
      const pop = s.sim.state.populations[s.sim.species.length - 1]!;
      let best = 0;
      for (let c = 1; c < pop.adults.length; c++) if (countAt(pop, c) > countAt(pop, best)) best = c;
      const x0 = Math.min(32, Math.floor((best % 48) / 8) * 8);
      const y0 = Math.min(32, Math.floor(Math.floor(best / 48) / 8) * 8);
      expect(s.submit({ type: 'setFocus', focus: { x0, y0, x1: x0 + 16, y1: y0 + 16 } }).ok).toBe(true);
      s.advance(TICKS_PER_DAY * 3 + 7);
      return s;
    };
    const a = run();
    expect(a.sim.state.individuals.count).toBeGreaterThan(0);
    const loaded = Session.restore(deserialize(serialize(a.save())));
    expect(checksum(loaded.sim.state)).toBe(checksum(a.sim.state));
    for (const x of [a, loaded]) x.advance(TICKS_PER_DAY * 5 + 3);
    expect(checksum(loaded.sim.state)).toBe(checksum(a.sim.state));
    expect(Session.replay(JSON.parse(JSON.stringify(a.exportLog()))).sim.state.tick).toBe(a.sim.state.tick);
  });
});
