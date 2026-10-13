import { describe, expect, it } from 'vitest';
import { grasslandSpecies, speciesLibrary } from '../src/data';
import { TICKS_PER_DAY, populationTotal } from '../src/sim';
import { deriveSpecies, preyMatrix, sizeSuitability } from '../src/sim/physiology';
import { makeSim, smallWorld } from './helpers';

const byId = (id: string) => {
  const s = speciesLibrary.get(id);
  if (!s) throw new Error(id);
  return s;
};

describe('从性状推导的参数', () => {
  const cell = smallWorld.cellSizeM;

  it('日食量符合代谢体重缩放的数量级', () => {
    // 兔每天约 100 克干物质，田鼠约 5 克，白鼬约 80 克猎物（约体重的三分之一）。
    expect(deriveSpecies(byId('rabbit'), cell).dailyIntakeG).toBeGreaterThan(80);
    expect(deriveSpecies(byId('rabbit'), cell).dailyIntakeG).toBeLessThan(130);
    expect(deriveSpecies(byId('vole'), cell).dailyIntakeG).toBeLessThan(8);
    const stoat = deriveSpecies(byId('stoat'), cell);
    expect(stoat.dailyIntakeG / stoat.bodyMassG).toBeGreaterThan(0.2);
    expect(stoat.dailyIntakeG / stoat.bodyMassG).toBeLessThan(0.5);
  });

  it('日死亡率与年存活率一致', () => {
    const rabbit = deriveSpecies(byId('rabbit'), cell);
    expect(Math.pow(1 - rabbit.adultDailyMortality, 360)).toBeCloseTo(0.45, 6);
  });

  it('小动物比大动物更快饿死，拥挤上限更高', () => {
    const vole = deriveSpecies(byId('vole'), cell);
    const rabbit = deriveSpecies(byId('rabbit'), cell);
    expect(vole.starvationRate).toBeGreaterThan(rabbit.starvationRate);
    expect(vole.crowdingCapacity).toBeGreaterThan(rabbit.crowdingCapacity * 5);
  });

  it('繁殖季比两窝间隔还短时，整个繁殖季约一窝', () => {
    // 白鼬一年一窝、繁殖季一个月：每天的产窝概率约 1/30，而不是 1/360。
    expect(deriveSpecies(byId('stoat'), cell).litterRate).toBeCloseTo(1 / 30, 6);
  });

  it('两段分开的繁殖季各算各的：每段都比间隔短时，每段约一窝', () => {
    const base = byId('rabbit');
    const split = {
      ...base,
      reproduction: { ...base.reproduction, litterIntervalDays: 35, breedingByMonth: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0] },
    };
    // 最长一段只有 30 天，比 35 天的间隔短：每天产窝概率按 1/30 算，而不是两段合计 60 天后的 1/35。
    expect(deriveSpecies(split, cell).litterRate).toBeCloseTo(1 / 30, 6);
    // 跨年连续的繁殖期（12 月 + 1、2 月）算一段。
    const wrap = { ...base, reproduction: { ...base.reproduction, breedingByMonth: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1] } };
    expect(deriveSpecies(wrap, cell).litterRate).toBeCloseTo(1 / 35, 6);
  });

  it('体型适合度：太小、太大都难抓', () => {
    expect(sizeSuitability(0.001)).toBe(0);
    expect(sizeSuitability(0.1)).toBe(1);
    expect(sizeSuitability(2)).toBeLessThan(0.5);
    expect(sizeSuitability(10)).toBe(0);
  });

  it('谁吃谁由性状推出：白鼬主要吃田鼠，偶尔吃兔；食草动物不吃任何动物；不吃同类', () => {
    const derived = grasslandSpecies.map((s) => deriveSpecies(s, cell));
    const m = preyMatrix(derived);
    const idx = (id: string) => grasslandSpecies.findIndex((s) => s.id === id);
    const [vole, rabbit, stoat] = [idx('vole'), idx('rabbit'), idx('stoat')];
    expect(m[stoat]![vole]!).toBeGreaterThan(0.5);
    expect(m[stoat]![rabbit]!).toBeGreaterThan(0);
    expect(m[stoat]![rabbit]!).toBeLessThan(m[stoat]![vole]!);
    expect(m[stoat]![stoat]!).toBe(0);
    expect(m[vole]!.every((x) => x === 0)).toBe(true);
    expect(m[rabbit]!.every((x) => x === 0)).toBe(true);
  });
});

describe('按格子的种群推演', () => {
  it('记账恒等：今天 = 昨天 + 出生 − 各种死亡（扩散不增不减）', () => {
    const sim = makeSim(42);
    for (let day = 0; day < 400; day++) {
      const before = sim.state.populations.map(populationTotal);
      sim.stepN(TICKS_PER_DAY);
      sim.state.lastDay.forEach((d, s) => {
        const after = populationTotal(sim.state.populations[s]!);
        expect(d.total).toBe(after);
        expect(after).toBe(before[s]! + d.births - d.deathsPredation - d.deathsStarvation - d.deathsOther);
      });
    }
  });

  it('计数永远是非负整数', () => {
    const sim = makeSim(7);
    sim.stepN(TICKS_PER_DAY * 200);
    for (const p of sim.state.populations) {
      expect(p.adults.every((n) => n >= 0)).toBe(true);
      expect(p.juveniles.every((n) => n >= 0)).toBe(true);
    }
  });

  it('没有植被时食草动物饿死，没有猎物时捕食者饿死', () => {
    const barren = {
      ...smallWorld,
      fertility: { ...smallWorld.fertility, min: 0, max: 0 },
      vegetation: { ...smallWorld.vegetation, floorBiomass: 0 },
    };
    const sim = makeSim(3, barren);
    sim.stepN(TICKS_PER_DAY * 120);
    expect(sim.state.lastDay.every((d) => d.total === 0)).toBe(true);
  });

  it('有吃有住时各物种头两年都活着', () => {
    const sim = makeSim(1, { ...smallWorld, width: 48, height: 48 });
    sim.stepN(TICKS_PER_DAY * 360 * 2);
    for (const d of sim.state.lastDay) expect(d.total).toBeGreaterThan(0);
  });
});
