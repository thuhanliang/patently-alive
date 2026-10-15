import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, worldFor, type WorldParams } from '../src/data';
import { CAUSE, Sim, TICKS_PER_DAY, recentByCause } from '../src/sim';
import { RECENT_HALF_LIFE_DAYS, causeCount, causeName, createLedger, decayLedger, recordDeaths } from '../src/sim/ledger';

const island = worldFor(scenarioLibrary.get('bird-island')!);
const small: WorldParams = { ...island, width: 48, height: 48 };

function lastDayCauses(sim: Sim, s: number): number[] {
  const l = sim.state.deaths;
  return Array.from(l.lastDay.slice(s * l.causes, (s + 1) * l.causes));
}

describe('死因账本', () => {
  it('每天的死因合计和当天的死亡账目对得上（格子和展开的个体都记）', () => {
    const sim = Sim.create({ seed: 3, world: small, species: speciesFor(small) });
    sim.setFocus({ x0: 8, y0: 8, x1: 32, y1: 32 });
    for (let d = 0; d < 60; d++) {
      sim.stepN(TICKS_PER_DAY);
      sim.state.lastDay.forEach((st, s) => {
        const byCause = lastDayCauses(sim, s);
        const total = byCause.reduce((a, b) => a + b, 0);
        expect(total).toBe(st.deathsPredation + st.deathsStarvation + st.deathsOther);
        const predation = byCause.slice(CAUSE.predation(0)).reduce((a, b) => a + b, 0);
        expect(predation).toBe(st.deathsPredation);
        expect(byCause[CAUSE.starvation]).toBe(st.deathsStarvation);
      });
    }
  });

  it('记下是谁吃的：鸟的蛋和雏鸟被鼠吃掉记作"巢失败（被船鼠吃掉）"', () => {
    const sim = Sim.create({ seed: 1, world: small, species: speciesFor(small) });
    sim.stepN(TICKS_PER_DAY * 120); // 过一个繁殖季
    const ids = sim.species.map((s) => s.params.id);
    const bird = ids.indexOf('dotterel');
    const rat = ids.indexOf('rat');
    const recent = recentByCause(sim.state.deaths, bird);
    expect(recent[CAUSE.nest(rat)]!).toBeGreaterThan(0);
    // 鼠不追会跑的猎物：没有"成鸟被鼠捕食"。
    expect(recent[CAUSE.predation(rat)]).toBe(0);
    const names = sim.species.map((s) => s.params.name);
    expect(causeName(CAUSE.nest(rat), names)).toBe('巢失败（被船鼠吃掉）');
    expect(causeName(CAUSE.predation(ids.indexOf('cat')), names)).toBe('被野猫捕食');
  });

  it('近期死亡按半衰期衰减', () => {
    const l = createLedger(2, 4);
    recordDeaths(l, 1, CAUSE.other, 3, 8);
    for (let d = 0; d < RECENT_HALF_LIFE_DAYS; d++) decayLedger(l);
    const i = (1 * l.causes + CAUSE.other) * l.blocks + 3;
    expect(l.recent[i]!).toBeCloseTo(4, 6);
  });

  it('身体撑不住的三种死因（阶段 3.5）：编号拆得回来，名字对', () => {
    expect(causeName(CAUSE.malnutrition, ['甲'])).toBe('营养不良');
    expect(causeName(CAUSE.fracture, ['甲'])).toBe('承重骨折');
    expect(causeName(CAUSE.dystocia, ['甲'])).toBe('难产');
    const seen = new Set<number>();
    for (const c of [CAUSE.starvation, CAUSE.other, CAUSE.removed, CAUSE.malnutrition, CAUSE.fracture, CAUSE.dystocia, CAUSE.predation(0), CAUSE.nest(0), CAUSE.predation(1), CAUSE.nest(1)]) seen.add(c);
    expect([...seen].sort((a, b) => a - b)).toEqual([...Array(causeCount(2)).keys()]);
  });

  it('不存在的死因直接报错，不会显示成"被 undefined 捕食"', () => {
    expect(() => causeName(CAUSE.predation(2), ['甲', '乙'])).toThrow(RangeError);
  });

  it('账本在快照里，存档恢复后继续记，结果一样', () => {
    const config = { seed: 4, world: small, species: speciesFor(small) };
    const a = Sim.create(config);
    a.stepN(TICKS_PER_DAY * 40);
    const b = new Sim(a.snapshot());
    a.stepN(TICKS_PER_DAY * 10);
    b.stepN(TICKS_PER_DAY * 10);
    expect(Array.from(b.state.deaths.recent)).toEqual(Array.from(a.state.deaths.recent));
  });
});
