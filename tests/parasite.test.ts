import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor, type WorldParams } from '../src/data';
import { Rng, Sim, TICKS_PER_DAY, checksum, deserialize, serialize } from '../src/sim';
import { gammaUnit, mcMaster } from '../src/sim/exam';

const island = worldFor(scenarioLibrary.get('bird-island')!);
const small = (density: number): { world: WorldParams; species: ReturnType<typeof speciesFor> } => {
  const world: WorldParams = { ...island, width: 48, height: 48, species: ['rabbit'], mainIslandOnly: [] };
  return { world, species: speciesFor(world).map((s) => ({ ...s, initialDensityPerHa: density })) };
};
/** 兔子在全岛的平均感染率（按成体数加权）。 */
const prevalence = (sim: Sim): number => {
  const ps = sim.state.parasites![0]!;
  let p = 0;
  let n = 0;
  ps.prevalence[0]!.forEach((v, b) => {
    p += v * ps.adultsYesterday[0]![b]!;
    n += ps.adultsYesterday[0]![b]!;
  });
  return n > 0 ? p / n : 0;
};

describe('肠道线虫（寄生虫，MODEL 五之十八）', () => {
  it('没写寄生虫的世界里没有这一项（推演和以前一样）', () => {
    const sim = Sim.create({ seed: 1, world: { ...island, width: 32, height: 32, pathogens: [] }, species: speciesFor(island) });
    expect(sim.state.parasites).toBeUndefined();
  });

  it('密度制约：兔子越密，草上的幼虫越多，感染率越高', () => {
    const run = (density: number): number => {
      const { world, species } = small(density);
      const sim = Sim.create({ seed: 3, world, species });
      sim.stepN(TICKS_PER_DAY * 240);
      return prevalence(sim);
    };
    const sparse = run(1);
    const dense = run(12);
    expect(dense).toBeGreaterThan(sparse * 1.5);
  }, 60000);

  it('死于寄生虫的记进死因账本，写得出来', () => {
    const { world, species } = small(12);
    const sim = Sim.create({ seed: 5, world, species });
    sim.stepN(TICKS_PER_DAY * 200);
    let dead = 0;
    const l = sim.state.deaths;
    for (let b = 0; b < l.blocks; b++) dead += l.recent[(0 * l.causes + 6) * l.blocks + b]!;
    expect(dead).toBeGreaterThan(0);
  }, 60000);

  it('驱虫：那一带的感染率立刻大降', () => {
    const { world, species } = small(12);
    const sim = Sim.create({ seed: 7, world, species, tools });
    sim.stepN(TICKS_PER_DAY * 150);
    const b = sim.state.parasites![0]!;
    const before = [...b.prevalence[0]!];
    sim.deworm(0, 24, 24);
    const after = sim.state.parasites![0]!.prevalence[0]!;
    const changed = before.filter((v, i) => v > 0 && after[i]! < v * 0.5).length;
    expect(changed).toBeGreaterThan(0);
  }, 60000);

  it('带寄生虫的快照中途存档再恢复，结果逐位相同', () => {
    const { world, species } = small(8);
    const a = Sim.create({ seed: 11, world, species });
    a.stepN(TICKS_PER_DAY * 50);
    const b = new Sim(deserialize(serialize(a.state)));
    a.stepN(TICKS_PER_DAY * 30);
    b.stepN(TICKS_PER_DAY * 30);
    expect(checksum(b.state)).toBe(checksum(a.state));
  }, 60000);

  it('McMaster：读数是 50 的倍数，平均值接近真实的每克虫卵数；虫卵在宿主之间高度聚集', () => {
    const rng = Rng.fromSeed(1);
    const xs = Array.from({ length: 3000 }, () => mcMaster(rng, 600 * gammaUnit(rng, 0.6)));
    expect(xs.every((x) => x % 50 === 0)).toBe(true);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(600 * 0.85);
    expect(mean).toBeLessThan(600 * 1.15);
    // 聚集：方差远大于均值（负二项，k < 1）。
    const v = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length;
    expect(v).toBeGreaterThan(mean * 50 * 5);
  });
});
