import { describe, expect, it } from 'vitest';
import { grassland } from '../src/data';
import { DAYS_PER_YEAR, TICKS_PER_DAY, calendar } from '../src/sim';
import { makeSim, smallWorld } from './helpers';

function mean(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s / a.length;
}

describe('格子地图与植被', () => {
  it('地图尺寸来自数据，不写死', () => {
    const sim = makeSim(1, { ...smallWorld, width: 7, height: 3 });
    expect(sim.state.grid.vegetation.length).toBe(21);
    expect(sim.state.grid.fertility.length).toBe(21);
  });

  it('肥力落在数据给的范围内，并且有斑块起伏', () => {
    const { fertility } = makeSim(3, grassland).state.grid;
    let lo = Infinity;
    let hi = -Infinity;
    for (const f of fertility) {
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(lo).toBeGreaterThanOrEqual(grassland.fertility.min);
    expect(hi).toBeLessThanOrEqual(grassland.fertility.max);
    expect(hi - lo).toBeGreaterThan(0.3);
  });

  it('跑三年：植被始终在 [下限, 上限] 内，没有 NaN', () => {
    const sim = makeSim(11);
    const { maxBiomass, floorBiomass } = smallWorld.vegetation;
    const bad: string[] = [];
    for (let day = 0; day < DAYS_PER_YEAR * 3 && bad.length === 0; day++) {
      sim.stepN(TICKS_PER_DAY);
      const { vegetation, fertility } = sim.state.grid;
      for (let i = 0; i < vegetation.length; i++) {
        const v = vegetation[i]!;
        const ok = Number.isFinite(v) && v >= floorBiomass && v <= maxBiomass * fertility[i]! + 1e-9;
        if (!ok) bad.push(`第 ${day} 天第 ${i} 格：${v}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('有季节起伏：春夏长、冬季落', () => {
    const sim = makeSim(5);
    const bySeason = [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    // 第一年当作预热，看第二年。
    sim.stepN(TICKS_PER_DAY * DAYS_PER_YEAR);
    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      sim.stepN(TICKS_PER_DAY);
      const s = calendar(sim.tick).season;
      bySeason[s]! += mean(sim.state.grid.vegetation);
      counts[s]! += 1;
    }
    const avg = bySeason.map((v, i) => v / counts[i]!);
    const [spring, summer, , winter] = avg as [number, number, number, number];
    expect(summer).toBeGreaterThan(winter * 1.2);
    expect(spring).toBeGreaterThan(winter);
  });

  it('植被只在每天开始时更新，一天之内不变', () => {
    const sim = makeSim(9);
    sim.stepN(TICKS_PER_DAY);
    const at = sim.state.grid.vegetation.slice();
    sim.stepN(TICKS_PER_DAY - 1);
    expect(Array.from(sim.state.grid.vegetation)).toEqual(Array.from(at));
    sim.step();
    expect(Array.from(sim.state.grid.vegetation)).not.toEqual(Array.from(at));
  });
});

describe('格子地图的边界情况', () => {
  it('肥力为 0、下限为 0 时也不出 NaN', () => {
    const world = {
      ...smallWorld,
      fertility: { ...smallWorld.fertility, min: 0, max: 0 },
      vegetation: { ...smallWorld.vegetation, floorBiomass: 0 },
    };
    const sim = makeSim(1, world);
    sim.stepN(TICKS_PER_DAY * 30);
    expect(Array.from(sim.state.grid.vegetation).every((v) => v === 0)).toBe(true);
  });
});
