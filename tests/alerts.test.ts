import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor, type WorldParams } from '../src/data';
import { Sim, TICKS_PER_DAY, type SimState } from '../src/sim';
import { alerts, DECLINE_WINDOW_DAYS, hotspot, LOW_SATISFACTION } from '../src/sim/alerts';
import { CAUSE, deathsByBlock, type DeathFilter } from '../src/sim/ledger';
import { crowdingBlocks } from '../src/sim/population';

const island = worldFor(scenarioLibrary.get('bird-island')!);
const small: WorldParams = { ...island, width: 64, height: 64 };

function islandSim(days: number): Sim {
  const sim = Sim.create({ seed: 3, world: small, species: speciesFor(small), tools });
  sim.stepN(TICKS_PER_DAY * days);
  return sim;
}

/** 把某天的状态改成"各物种开局 start 只、DECLINE_WINDOW_DAYS 天前 past 只、现在 now 只"。 */
function withTotals(state: SimState, start: number[], past: number[], now: number[]): SimState {
  const day = DECLINE_WINDOW_DAYS + 30;
  return {
    ...state,
    tick: day * TICKS_PER_DAY,
    census: [
      { day: 0, totals: start },
      { day: 30, totals: past },
      { day, totals: now },
    ],
    lastDay: state.lastDay.map((d, s) => ({ ...d, total: now[s]! })),
  };
}

describe('普查', () => {
  it('开局记一次，之后每 30 天一次', () => {
    const sim = islandSim(60);
    expect(sim.state.census.map((c) => c.day)).toEqual([0, 30, 60]);
    expect(sim.state.census[2]!.totals).toEqual(sim.state.lastDay.map((d) => d.total));
  });
});

describe('警报', () => {
  const sim = islandSim(40);
  const blockOf = crowdingBlocks(small.width, small.height, sim.state.grid.terrain).blockOf;
  const n = sim.state.populations.length;
  const flat = (v: number) => Array.from({ length: n }, () => v);

  it('数量平稳、资源充足时没有警报', () => {
    const state = withTotals(sim.snapshot(), flat(100), flat(100), flat(95));
    expect(alerts(state, { blockOf, resources: { budget: 1e6, satisfaction: 80, cheapestTool: 500 } })).toEqual([]);
  });

  it('三个月少了四成：骤减，数值是减少的比例', () => {
    const now = flat(100);
    now[0] = 60;
    const list = alerts(withTotals(sim.snapshot(), flat(100), flat(100), now), { blockOf });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'decline', species: 0 });
    expect(list[0]!.value).toBeCloseTo(0.4);
  });

  it('濒临消失比骤减和满意度低都响；最响的在前', () => {
    const now = flat(100);
    now[0] = 5;
    now[1] = 50;
    const list = alerts(withTotals(sim.snapshot(), flat(100), flat(100), now), {
      blockOf,
      resources: { budget: 0, satisfaction: LOW_SATISFACTION / 2, cheapestTool: 500 },
    });
    expect(list.map((a) => a.kind)).toEqual(['nearExtinct', 'lowSatisfaction', 'decline', 'lowBudget']);
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.severity).toBeGreaterThanOrEqual(list[i]!.severity);
  });

  it('给了本地物种时，外来物种减少不报警', () => {
    const now = flat(100);
    now[1] = 5;
    now[2] = 60;
    const native = Array.from({ length: n }, (_, s) => s === 0);
    expect(alerts(withTotals(sim.snapshot(), flat(100), flat(100), now), { blockOf, native })).toEqual([]);
    now[0] = 60;
    expect(alerts(withTotals(sim.snapshot(), flat(100), flat(100), now), { blockOf, native }).map((a) => a.species)).toEqual([0]);
  });

  it('骤减的地点是这个物种近期死得最多的区块', () => {
    const state = sim.snapshot();
    const l = state.deaths;
    const target = blockOf[32 * small.width + 32]!;
    expect(target).toBeGreaterThanOrEqual(0);
    l.recent.fill(0);
    l.recent[(0 * l.causes + CAUSE.starvation) * l.blocks + target] = 50;
    const at = hotspot(state, 0, blockOf)!;
    expect(blockOf[at.y * small.width + at.x]).toBe(target);
    // 人为移除不算。
    l.recent.fill(0);
    l.recent[(0 * l.causes + CAUSE.removed) * l.blocks + target] = 50;
    expect(hotspot(state, 0, blockOf)).toBeNull();
  });
});

describe('死亡热力', () => {
  it('按死因筛选的各层加起来等于全部死因', () => {
    const state = islandSim(120).state;
    for (let s = 0; s < state.populations.length; s++) {
      const all = deathsByBlock(state.deaths, s, 'all');
      const parts = (['predation', 'nest', 'starvation', 'other', 'malnutrition', 'fracture', 'dystocia'] as DeathFilter[]).map((f) => deathsByBlock(state.deaths, s, f));
      for (let b = 0; b < all.length; b++) {
        expect(parts.reduce((a, p) => a + p[b]!, 0)).toBeCloseTo(all[b]!, 9);
      }
    }
    expect(deathsByBlock(state.deaths, 0, 'all').some((v) => v > 0)).toBe(true);
  });
});
