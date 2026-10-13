import { describe, expect, it } from 'vitest';
import { Sim, TICKS_PER_DAY, checksum, countAt, deserialize, serialize, type FocusRect, type SimState } from '../src/sim';
import { applyFocus } from '../src/sim/individuals';
import { deriveAll } from '../src/sim/physiology';
import { Rng } from '../src/sim/rng';
import { makeSim } from './helpers';

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

    applyFocus(state.individuals, derived, state.populations, state.grid, null, FOCUS, rng);
    // 关注区里的计数全部清零，变成个体。
    let leftInFocus = 0;
    for (let y = FOCUS.y0; y < FOCUS.y1; y++)
      for (let x = FOCUS.x0; x < FOCUS.x1; x++)
        for (const p of state.populations) leftInFocus += countAt(p, y * state.grid.width + x);
    expect(leftInFocus).toBe(0);
    expect(state.individuals.count).toBeGreaterThan(100);

    applyFocus(state.individuals, derived, state.populations, state.grid, FOCUS, null, rng);
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
        if (ind.x[i]! >= 16 && ind.x[i]! < 24) out.push([ind.species[i], ind.x[i], ind.y[i], ind.age[i], ind.reserve[i]].join('/'));
      }
      return out.sort();
    };
    const before = overlap(st);
    expect(before.length).toBeGreaterThan(50);
    const totalsBefore = sim.totals();

    const { derived } = deriveAll(st.config.species, st.config.world.cellSizeM);
    applyFocus(st.individuals, derived, st.populations, st.grid, st.focus, to, Rng.fromSeed(2));
    expect(overlap(st)).toEqual(before);

    const totalAfter = st.populations.map((p, s) => {
      let t = 0;
      for (let c = 0; c < p.adults.length; c++) t += countAt(p, c);
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
        expect(d.total).toBe(dayStart[s]! + d.births - d.deathsPredation - d.deathsStarvation - d.deathsOther);
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
      if (!sp.herbivore) return;
      expect(Math.abs(b[s]! - a[s]!) / a[s]!, sp.params.id).toBeLessThan(0.15);
    });
  });
});
