import { describe, expect, it } from 'vitest';
import { Sim, TICKS_PER_DAY, checksum, countAt, deserialize, serialize, type FocusRect, type SimState } from '../src/sim';
import { applyFocus } from '../src/sim/individuals';
import { deriveAll, juvenileStageAt } from '../src/sim/physiology';
import { Rng } from '../src/sim/rng';
import { makeConfig, makeSim } from './helpers';
import { scenarioLibrary, speciesFor, worldFor } from '../src/data';

const FOCUS: FocusRect = { x0: 8, y0: 8, x1: 24, y1: 24 };

/** 各物种各格的（幼体, 成体）计数，加上个体按年龄折回去的数，用于比较。 */
function cellCounts(state: Readonly<SimState>): string {
  const pops = state.populations.map((p) => ({ j: p.juveniles.map((st) => Array.from(st)), a: Array.from(p.adults) }));
  return JSON.stringify(pops);
}

describe('展开与收拢守恒', () => {
  it('展开后立刻收拢：每格每个年龄段的数量逐一相同', () => {
    const sim = makeSim(5);
    sim.stepN(TICKS_PER_DAY * 60); // 先跑一段，让幼体、成体都有
    const state = sim.snapshot();
    const before = cellCounts(state);
    const { derived } = deriveAll(state.config.species, state.config.world.cellSizeM);
    const rng = Rng.fromSeed(1);

    applyFocus(state.individuals, derived, state.populations, state.populations, state.grid, null, FOCUS, rng, sim.day);
    // 关注区里的计数全部清零，变成个体。
    let leftInFocus = 0;
    for (let y = FOCUS.y0; y < FOCUS.y1; y++)
      for (let x = FOCUS.x0; x < FOCUS.x1; x++)
        for (const p of state.populations) leftInFocus += countAt(p, y * state.grid.width + x);
    expect(leftInFocus).toBe(0);
    expect(state.individuals.count).toBeGreaterThan(100);

    applyFocus(state.individuals, derived, state.populations, state.populations, state.grid, FOCUS, null, rng, sim.day);
    expect(state.individuals.count).toBe(0);
    expect(cellCounts(state)).toBe(before);
  });

  it('关注区移动：两边都在的格子里的个体原样保留，总数不变', () => {
    const sim = makeSim(6);
    sim.setFocus(FOCUS);
    sim.stepN(TICKS_PER_DAY * 3 + 5);
    const st = sim.snapshot();
    const to: FocusRect = { x0: 16, y0: 8, x1: 32, y1: 24 };
    // 重叠区是 x ∈ [16, 24)。记下里面每个个体的（物种, 位置, 年龄, 储备）。
    const overlap = (s: Readonly<SimState>): string[] => {
      const out: string[] = [];
      const ind = s.individuals;
      for (let i = 0; i < ind.count; i++) {
        if (ind.x[i]! >= 16 && ind.x[i]! < 24) out.push([ind.species[i], ind.x[i], ind.y[i], ind.born[i], ind.reserve[i]].join('/'));
      }
      return out.sort();
    };
    const before = overlap(st);
    expect(before.length).toBeGreaterThan(50);
    const totalsBefore = sim.totals();

    const { derived } = deriveAll(st.config.species, st.config.world.cellSizeM);
    applyFocus(st.individuals, derived, st.populations, st.emigrants, st.grid, st.focus, to, Rng.fromSeed(2), sim.day);
    expect(overlap(st)).toEqual(before);

    const totalAfter = st.populations.map((p, s) => {
      let t = 0;
      for (let c = 0; c < p.adults.length; c++) t += countAt(p, c) + countAt(st.emigrants[s]!, c);
      for (let i = 0; i < st.individuals.count; i++) if (st.individuals.species[i] === s) t += 1;
      return t;
    });
    expect(totalAfter).toEqual(totalsBefore);
  });

  it('开着关注区跑：每个小时总数只因被捕食而减少，每天满足记账恒等式', () => {
    const sim = makeSim(42);
    sim.setFocus(FOCUS);
    for (let day = 0; day < 60; day++) {
      const dayStart = sim.totals();
      for (let h = 1; h < TICKS_PER_DAY; h++) {
        sim.step();
        const now = sim.totals();
        now.forEach((n, s) => expect(n).toBe(dayStart[s]! - sim.state.dayAccum[s]!.deathsPredation));
      }
      sim.step(); // 换天
      sim.state.lastDay.forEach((d, s) => {
        expect(d.total).toBe(sim.totals()[s]);
        expect(d.total).toBe(dayStart[s]! + d.births + d.released - d.deathsPredation - d.deathsStarvation - d.deathsOther - d.removed);
      });
      // 中途换几次关注区，包括全部收拢。
      if (day === 20) sim.setFocus({ x0: 0, y0: 0, x1: 16, y1: 16 });
      if (day === 35) sim.setFocus(null);
      if (day === 45) sim.setFocus(FOCUS);
    }
  }, 60_000);

  it('个体都在关注区里，计数非负', () => {
    const sim = makeSim(9);
    sim.setFocus(FOCUS);
    sim.stepN(TICKS_PER_DAY * 30 + 7);
    const { individuals: ind, focus } = sim.state;
    for (let i = 0; i < ind.count; i++) {
      expect(ind.x[i]!).toBeGreaterThanOrEqual(focus!.x0);
      expect(ind.x[i]!).toBeLessThan(focus!.x1);
      expect(ind.y[i]!).toBeGreaterThanOrEqual(focus!.y0);
      expect(ind.y[i]!).toBeLessThan(focus!.y1);
    }
    for (const p of sim.state.populations) {
      expect(p.adults.every((n) => n >= 0)).toBe(true);
      for (const st of p.juveniles) expect(st.every((n) => n >= 0)).toBe(true);
    }
  });
});

describe('带关注区的确定性', () => {
  const run = (): Sim => {
    const sim = makeSim(2026);
    sim.stepN(100);
    sim.setFocus(FOCUS);
    sim.stepN(TICKS_PER_DAY * 8);
    sim.setFocus({ x0: 0, y0: 8, x1: 16, y1: 24 });
    sim.stepN(TICKS_PER_DAY * 4 + 5);
    return sim;
  };

  it('同种子、同样的关注区安排，结果逐位相同', () => {
    expect(checksum(run().state)).toBe(checksum(run().state));
  }, 60_000);

  it('一天中途存档（带个体）再恢复，继续推进的结果一样', () => {
    const straight = run();
    straight.stepN(TICKS_PER_DAY * 5);
    const resumed = new Sim(deserialize<SimState>(serialize(run().snapshot())));
    resumed.stepN(TICKS_PER_DAY * 5);
    expect(serialize(resumed.snapshot())).toBe(serialize(straight.snapshot()));
  }, 60_000);
});

describe('个体模型和格子模型的一致性', () => {
  it('同一片地全部展开成个体，30 天后各食草动物总数与格子模型相差不到 15%', () => {
    // 放大看不应该改变结果：两种表示的规则在期望上要一致。
    // （捕食者数量太少，偶然性大，不在这里比。）
    const world = { ...makeSim(1).state.config.world, width: 24, height: 24 };
    const cells = makeSim(1, world);
    const expanded = makeSim(1, world);
    expanded.setFocus({ x0: 0, y0: 0, x1: 24, y1: 24 });
    cells.stepN(TICKS_PER_DAY * 30);
    expanded.stepN(TICKS_PER_DAY * 30);
    const a = cells.totals();
    const b = expanded.totals();
    cells.species.forEach((sp, s) => {
      if (sp.predator) return;
      expect(Math.abs(b[s]! - a[s]!) / a[s]!, sp.params.id).toBeLessThan(0.15);
    });
  });
});

describe('个体模型和格子模型的一致性（鸟岛）', () => {
  it('同一座岛全部展开成个体，30 天后鼠、兔、鸟的总数与格子模型相差不到 15%', () => {
    // 鼠吃蛋、兔子啃灌丛、鸟吃虫、窝的掩护：两边按同一套规则。
    // 不放猫：32×32 的小岛上只有几只猫，展开后常常饿死（个体要自己跑遍家域找猎物），
    // 猫的有无会把鸟的差别带偏，这里只比鼠、兔、鸟这一层。
    const island = worldFor(scenarioLibrary.get('bird-island')!);
    const world = { ...island, width: 32, height: 32, terrain: { ...island.terrain!, islets: { ...island.terrain!.islets, count: 0 } } };
    // 鸟只有二三十只，单个种子的偶然性很大（窝被找到是一窝一窝地丢），所以多跑几个种子。
    const results = [3, 4, 5, 6, 7, 8, 9, 10, 11].map((seed) => {
      const species = speciesFor(world).map((sp) => (sp.id === 'cat' ? { ...sp, initialDensityPerHa: 0 } : sp));
      const config = { seed, world, species };
      const cells = Sim.create(config);
      const expanded = Sim.create(config);
      expanded.setFocus({ x0: 0, y0: 0, x1: 32, y1: 32 });
      cells.stepN(TICKS_PER_DAY * 30);
      expanded.stepN(TICKS_PER_DAY * 30);
      return { ids: cells.species.map((s) => s.params.id), a: cells.totals(), b: expanded.totals() };
    });
    // 几个种子加起来比，减小偶然性。
    const sum = (k: 'a' | 'b', s: number): number => results.reduce((t, r) => t + r[k][s]!, 0);
    results[0]!.ids.forEach((id, s) => {
      if (id === 'cat') return;
      expect(Math.abs(sum('b', s) - sum('a', s)) / sum('a', s), id).toBeLessThan(0.15);
    });
  }, 300_000);
});

describe('关注区的校验和时机', () => {
  it('不合法的关注区直接拒绝', () => {
    const sim = makeSim(1);
    const bad: FocusRect[] = [
      { x0: 24, y0: 0, x1: 40, y1: 16 }, // 超出地图（宽 32）
      { x0: 8, y0: 8, x1: 8, y1: 16 }, // 宽为 0
      { x0: 3, y0: 0, x1: 11, y1: 8 }, // 没对齐
      { x0: 0, y0: 0, x1: 40, y1: 8 }, // 太宽
    ];
    for (const f of bad) expect(() => sim.setFocus(f)).toThrow(RangeError);
  });

  it('一天中途展开不会让个体当晚挨饿', () => {
    const sim = makeSim(4);
    sim.stepN(TICKS_PER_DAY * 20 + 20); // 晚上 8 点
    sim.setFocus(FOCUS);
    sim.stepN(TICKS_PER_DAY - 20); // 到换天
    expect(sim.state.lastDay.reduce((a, d) => a + d.deathsStarvation, 0)).toBe(0);
  });
});

describe('幼体传送带：个体和格子的年龄段始终对齐', () => {
  /**
   * 关掉一切生死（存活率 1、不繁殖、没有捕食者），总数和年龄结构只受传送带支配，结果是确定的：
   * 展开成个体的那部分，每个年龄段的数量必须和全部按格子算时逐一相同——
   * 跨过挪段日、个体在第 24 个小时走出关注区、一天中途换关注区都一样。
   */
  const immortal = (id: string) => {
    const base = makeConfig(1).species.find((s) => s.id === id)!;
    return {
      ...base,
      survival: { adultAnnual: 1 },
      reproduction: { ...base.reproduction, breedingByMonth: new Array<number>(12).fill(0) },
    };
  };

  function stageTotals(sim: Sim): number[][] {
    const st = sim.state;
    const day = sim.day;
    return sim.species.map((sp, s) => {
      const out = new Array<number>(sp.juvenileStages + 1).fill(0);
      for (const pops of [st.populations, st.emigrants]) {
        const p = pops[s]!;
        p.juveniles.forEach((stage, k) => (out[k]! += stage.reduce((a, b) => a + b, 0)));
        out[sp.juvenileStages]! += p.adults.reduce((a, b) => a + b, 0);
      }
      const ind = st.individuals;
      for (let i = 0; i < ind.count; i++) if (ind.species[i] === s) out[juvenileStageAt(sp, ind.born[i]!, day)]! += 1;
      return out;
    });
  }

  it('部分展开、来回移动关注区，各年龄段总数与纯格子推演逐一相同', () => {
    const base = makeConfig(3);
    const world = { ...base.world, width: 24, height: 24, species: ['vole', 'rabbit'] };
    const config = { ...base, world, species: [immortal('vole'), immortal('rabbit')] };
    // 开局先让纯格子推演跑一段，产生各年龄段的幼体（出生期间开着繁殖）。
    const seeded = { ...config, species: config.species.map((s) => ({ ...s, reproduction: { ...s.reproduction, breedingByMonth: new Array<number>(12).fill(1) } })) };
    const warm = Sim.create(seeded);
    warm.stepN(TICKS_PER_DAY * 25);
    // 从同一个快照出发，换成"不生不死"的物种参数，一份全部按格子，一份部分展开。
    const snap = { ...warm.snapshot(), config };
    const cells = new Sim(snap);
    const mixed = new Sim(snap);
    mixed.setFocus({ x0: 0, y0: 0, x1: 16, y1: 16 });

    for (let t = 1; t <= TICKS_PER_DAY * 70; t++) {
      cells.step();
      mixed.step();
      if (t % 97 === 0) mixed.setFocus(t % 2 === 0 ? { x0: 8, y0: 8, x1: 24, y1: 24 } : { x0: 0, y0: 8, x1: 16, y1: 24 });
      if (t % 13 === 0 || t % TICKS_PER_DAY === 0 || t % TICKS_PER_DAY === TICKS_PER_DAY - 1) {
        expect(stageTotals(mixed), `第 ${t} 个 tick`).toEqual(stageTotals(cells));
      }
    }
  });
});
