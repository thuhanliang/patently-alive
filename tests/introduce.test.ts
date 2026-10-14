import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, speciesLibrary, tools, worldFor, type WorldParams } from '../src/data';
import { checksum, costOf, deserialize, scenarioRules, serialize, Session, speciesOf, TICKS_PER_DAY, type Op, type Rules } from '../src/sim';
import { createLedger, growLedger, recordDeaths, recentByCause, CAUSE } from '../src/sim/ledger';
import { cellIndex } from '../src/sim';

/** 引种（introduce）：开局没有的物种也能运进来，日志、存档、守恒都照常。用 48×48 的小鸟岛（试验场），跑得快。 */
const scenario = scenarioLibrary.get('bird-island-small')!;
const world: WorldParams = worldFor(scenario);
const rules: Rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 } };
const config = { seed: 5, world, species: speciesFor(world), tools };
const mongoose = speciesLibrary.get('mongoose')!;

/** 地图中央附近的一格陆地。 */
function landNear(s: Session): { x: number; y: number } {
  const { grid } = s.sim.state;
  for (let r = 0; r < 24; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = 24 + dx;
        const y = 24 + dy;
        if (grid.terrain[cellIndex(grid, x, y)] !== 0) return { x, y };
      }
    }
  }
  throw new Error('没有陆地');
}

const introduce = (s: Session, count = 20, species = mongoose): Op => ({ type: 'introduce', species, ...landNear(s), count });

describe('引种', () => {
  it('引进开局没有的物种：排在后面，数量、账目、各项记录跟着加一项', () => {
    const s = new Session(config, rules);
    const before = s.sim.species.length;
    const op = introduce(s);
    const budget = s.resources.budget;
    expect(s.submit(op)).toEqual({ ok: true });
    expect(s.sim.species).toHaveLength(before + 1);
    expect(s.sim.species.at(-1)!.params.id).toBe('mongoose');
    expect(speciesOf(s.sim.state).map((p) => p.id)).toEqual([...config.species.map((p) => p.id), 'mongoose']);
    expect(s.sim.totals().at(-1)).toBe(20);
    expect(s.removed).toHaveLength(before + 1);
    expect(s.sim.state.deaths.species).toBe(before + 1);
    // 花费按工具数据：一批的固定费用 + 每只（含体重加价）；一支队伍忙几天。
    const cost = costOf(op, tools, world.cellSizeM);
    const t = tools.introduction!;
    expect(cost.budget).toBe(t.shipmentCost + 20 * (t.perAnimalCost + Math.round(t.perKgCost * mongoose.bodyMassKg)));
    expect(s.resources.budget).toBe(budget - cost.budget);
    expect(s.freeStaff()).toBe(rules.staff - 1);
    s.advance(TICKS_PER_DAY);
    expect(s.sim.state.lastDay.at(-1)!.released).toBe(20);
  });

  it('再引进同一种只是多放几只，不再加物种', () => {
    const s = new Session(config, { ...rules, staff: 3 });
    expect(s.submit(introduce(s, 10)).ok).toBe(true);
    const n = s.sim.species.length;
    expect(s.submit(introduce(s, 5)).ok).toBe(true);
    expect(s.sim.species).toHaveLength(n);
    expect(s.sim.totals().at(-1)).toBe(15);
  });

  it('不合规的引种被拒绝，什么都不变', () => {
    const closed = new Session(config, { ...rules, introduction: { allowed: false, banned: [], designs: false } });
    expect(closed.submit(introduce(closed)).ok).toBe(false);
    const banned = new Session(config, { ...rules, introduction: { allowed: true, banned: ['mongoose'], designs: false } });
    const r = banned.submit(introduce(banned));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('禁止');
    const s = new Session(config, rules);
    // 同一个 id、性状不同：是另一种动物。
    const r2 = s.submit(introduce(s, 5, { ...speciesLibrary.get('cat')!, bodyMassKg: 9 }));
    expect(r2.ok).toBe(false);
    // 一次太多、没钱、放到水里。
    expect(s.submit(introduce(s, tools.introduction!.maxAnimals + 1)).ok).toBe(false);
    const poor = new Session(config, { ...rules, budget: 100 });
    expect(poor.submit(introduce(poor)).ok).toBe(false);
    expect(s.submit({ ...introduce(s), x: 0, y: 0 }).ok).toBe(false);
    expect(s.sim.species).toHaveLength(config.species.length);
    expect(s.entries).toHaveLength(0);
  });

  it('引进的物种照常推演：守恒、展开成个体、会被陷阱抓', () => {
    const s = new Session(config, { ...rules, staff: 3 });
    const at = landNear(s);
    expect(s.submit({ type: 'setFocus', focus: { x0: 16, y0: 16, x1: 32, y1: 32 } }).ok).toBe(true);
    s.advance(3);
    expect(s.submit({ type: 'introduce', species: mongoose, ...at, count: 150 }).ok).toBe(true);
    const m = s.sim.species.length - 1;
    // 投放的那一格在关注区里：当场展开成个体。
    expect([...s.sim.state.individuals.species.slice(0, s.sim.state.individuals.count)].filter((x) => x === m).length).toBe(150);
    // 守恒：每天的总数 = 前一天 + 出生 + 投放 − 死亡 − 移除。
    // 前一天：开局时没有这个物种（今天的账目里记着投放的 150 只）。
    let prev = 0;
    expect(s.submit({ type: 'trap', trap: 'cat-cage', ...at, nights: 10, remove: ['mongoose'] }).ok).toBe(true);
    for (let d = 0; d < 12; d++) {
      s.advance(TICKS_PER_DAY);
      const st = s.sim.state.lastDay[m]!;
      const deaths = st.deathsPredation + st.deathsStarvation + st.deathsOther + st.removed;
      expect(st.total).toBe(prev + st.births + st.released - deaths);
      prev = st.total;
    }
    expect(s.removed[m]).toBeGreaterThan(0);
  }, 60_000);

  it('按日志回放、存档读档，和一口气玩下去逐位相同', () => {
    const s = new Session(config, { ...rules, staff: 3 });
    expect(s.submit({ type: 'setFocus', focus: { x0: 16, y0: 16, x1: 32, y1: 32 } }).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 3 + 5);
    expect(s.submit(introduce(s, 25)).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 40);
    expect(s.submit(introduce(s, 10, speciesLibrary.get('stoat')!)).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 60 + 3);
    const replayed = Session.replay(JSON.parse(JSON.stringify(s.exportLog())));
    expect(checksum(replayed.sim.state)).toBe(checksum(s.sim.state));
    const loaded = Session.restore(deserialize(serialize(s.save())));
    expect(checksum(loaded.sim.state)).toBe(checksum(s.sim.state));
    expect(loaded.removed).toEqual(s.removed);
    expect(loaded.quarters).toEqual(s.quarters);
    for (const x of [s, loaded]) x.advance(TICKS_PER_DAY * 30);
    expect(checksum(loaded.sim.state)).toBe(checksum(s.sim.state));
  }, 120_000);

  it('按物种排的状态数组都跟着加了一项', () => {
    const s = new Session(config, rules);
    const n = s.sim.species.length;
    const perSpecies = (st: object): string[] =>
      Object.entries(st)
        // 随机数状态碰巧也是 4 个数，不是按物种排的。
        .filter(([k, v]) => k !== 'rng' && Array.isArray(v) && v.length === n)
        .map(([k]) => k);
    const keys = perSpecies(s.sim.state);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    expect(s.submit(introduce(s)).ok).toBe(true);
    for (const k of keys) expect((s.sim.state as unknown as Record<string, unknown[]>)[k], k).toHaveLength(n + 1);
    for (const c of s.sim.state.census) expect(c.totals).toHaveLength(n + 1);
  });

  it('没有引种的工具数据时不能引种；存档里引进的物种和日志对不上时拒绝读档', () => {
    const noTools = new Session({ ...config, tools: { ...tools, introduction: undefined } }, rules);
    expect(noTools.submit(introduce(noTools)).ok).toBe(false);
    const s = new Session(config, rules);
    expect(s.submit(introduce(s)).ok).toBe(true);
    s.advance(TICKS_PER_DAY);
    const save = s.save();
    const state = { ...save.state, introduced: [{ ...mongoose, bodyMassKg: 2 }] };
    expect(() => Session.restore({ ...save, state })).toThrow('引进的物种');
  });

  it('账本换布局时旧账原样搬过去', () => {
    const l = createLedger(2, 3);
    recordDeaths(l, 0, CAUSE.predation(1), 2, 4);
    recordDeaths(l, 1, CAUSE.nest(0), 1, 2);
    const g = growLedger(l, 3);
    expect(g.species).toBe(3);
    expect(recentByCause(g, 0)[CAUSE.predation(1)]).toBe(4);
    expect(recentByCause(g, 1, 1)[CAUSE.nest(0)]).toBe(2);
    expect(recentByCause(g, 2).every((n) => n === 0)).toBe(true);
    expect(g.today[0 * g.causes + CAUSE.predation(1)]).toBe(4);
  });
});
