import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor, type WorldParams } from '../src/data';
import { scenarioRules, Session, Sim, TICKS_PER_DAY, type Rules, type SimState } from '../src/sim';
import { CAUSE } from '../src/sim/ledger';
import { baselineOf, QUARTER_DAYS, satisfactionChange, score, STABILITY_MIN_COUNT, type ScoreGoal } from '../src/sim/score';

const scenario = scenarioLibrary.get('bird-island')!;
const island = worldFor(scenario);
const small: WorldParams = { ...island, width: 64, height: 64 };
const species = speciesFor(small);
// 鸟岛：双斑鸻（本地、目标）、船鼠、穴兔、野猫。
const goal: ScoreGoal = { target: 0, recovery: 1.5, native: [true, false, false, false] };
const money = { spent: 0, received: 100 };

function state(days: number): SimState {
  const sim = Sim.create({ seed: 3, world: small, species, tools });
  sim.stepN(TICKS_PER_DAY * days);
  return sim.snapshot();
}

/** 把现在的总数改成 now，一年前那次普查改成 yearAgo。 */
function withTotals(s: SimState, now: number[], yearAgo: number[]): SimState {
  const day = 400;
  return {
    ...s,
    tick: day * TICKS_PER_DAY,
    census: [
      { day: 0, totals: yearAgo },
      { day: 30, totals: yearAgo },
    ],
    lastDay: s.lastDay.map((d, k) => ({ ...d, total: now[k]! })),
  };
}

describe('评分公式', () => {
  const s0 = state(10);
  const base = baselineOf(s0);

  it('恢复：和第一年同季比，持平 50 分，达到目标倍数 100 分，一半以下 0 分；第一年不评', () => {
    const at = (n: number, ref: number | null) => score(withTotals(s0, [n, 100, 100, 20], [100, 100, 100, 20]), goal, base, money, ref).scores.recovery;
    expect(at(100, null)).toBeNull();
    expect(at(100, 100)).toBe(50);
    expect(at(150, 100)).toBe(100);
    expect(at(300, 100)).toBe(100);
    expect(at(50, 100)).toBe(0);
    expect(at(125, 100)).toBe(75);
    expect(at(75, 100)).toBe(25);
    // 第一年同季一只没有：按 1 只算，回来了就看得见。
    expect(at(5, 0)).toBe(100);
  });

  it('恢复：目标倍数不同时，持平仍是 50 分', () => {
    const at = (n: number) =>
      score(withTotals(s0, [n, 100, 100, 20], [100, 100, 100, 20]), { ...goal, recovery: 2 }, base, money, 100).scores.recovery;
    expect(at(100)).toBe(50);
    expect(at(150)).toBe(75);
    expect(at(200)).toBe(100);
  });

  it('稳定度：外来物种翻倍 0 分、没涨 100 分；本地物种涨不算；很少的按至少 20 只算', () => {
    const at = (now: number[], before: number[]) => score(withTotals(s0, now, before), goal, base, money, 100).scores.stability;
    expect(at([100, 100, 100, 20], [100, 100, 100, 20])).toBe(100);
    expect(at([100, 200, 100, 20], [100, 100, 100, 20])).toBe(0);
    expect(at([500, 100, 100, 20], [100, 100, 100, 20])).toBe(100);
    expect(at([100, Math.round(100 * Math.SQRT2), 100, 20], [100, 100, 100, 20])).toBe(50);
    // 猫从 12 只到 20 只：一年前按 20 只算，不算暴涨。
    expect(at([100, 100, 100, STABILITY_MIN_COUNT], [100, 100, 100, 12])).toBe(100);
    // 没有一年前的普查：不评。
    expect(score({ ...s0, census: [{ day: 0, totals: [1, 1, 1, 1] }] }, goal, base, money, null).scores.stability).toBeNull();
  });

  it('多样性：本地物种不到开局一半、灌丛被啃掉都扣分', () => {
    const start = base.totals;
    const at = (bird: number, shrubFactor: number) => {
      const s = withTotals(s0, [bird, 1, 1, 1], [1, 1, 1, 1]);
      s.grid = { ...s.grid, plants: s.grid.plants.map((b, k) => (k === 1 ? b.map((v) => v * shrubFactor) : b)) };
      return score(s, goal, base, money, 1);
    };
    expect(at(start[0]!, 1).scores.diversity).toBe(100);
    const low = at(Math.floor(start[0]! * 0.25), 1);
    expect(low.detail.nativesLow).toEqual([0]);
    // 只数取整后略少于开局的四分之一：75 分或差 1 分。
    expect(low.scores.diversity).toBeGreaterThanOrEqual(74);
    expect(low.scores.diversity).toBeLessThanOrEqual(75);
    expect(at(start[0]!, 0.5).scores.diversity).toBe(75);
  });

  it('花费与福利', () => {
    expect(score(s0, goal, base, { spent: 30, received: 100 }, null).scores.cost).toBe(70);
    const s = state(10);
    s.deaths.recent.fill(0);
    const l = s.deaths;
    // 只有鸟有死亡：一半饿死、一半被捕食。
    l.recent[(0 * l.causes + CAUSE.starvation) * l.blocks] = 10;
    l.recent[(0 * l.causes + CAUSE.other) * l.blocks] = 10;
    expect(score(s, goal, base, money, null).scores.welfare).toBe(50);
  });

  it('满意度按恢复分变：50 分不变，第一年不变', () => {
    const scores = { recovery: 50, stability: null, diversity: 100, cost: 100, welfare: 100 };
    expect(satisfactionChange(scores)).toBe(0);
    expect(satisfactionChange({ ...scores, recovery: null })).toBe(0);
    expect(satisfactionChange({ ...scores, recovery: 100 })).toBeGreaterThan(0);
    expect(satisfactionChange({ ...scores, recovery: 0 })).toBeLessThan(0);
  });
});

describe('季度结算', () => {
  // 一年期的委托，小地图，跑得快。
  const rules: Rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 } };
  const make = () => new Session({ seed: 5, world: small, species, tools }, rules);

  it('每 90 天结算一次，按满意度拨款；最后一季结束委托，之后不能再动手', () => {
    const s = make();
    expect(s.totalQuarters).toBe(4);
    s.advance(TICKS_PER_DAY * QUARTER_DAYS - 1);
    expect(s.quarters).toHaveLength(0);
    s.advance(1);
    expect(s.quarters).toHaveLength(1);
    const q1 = s.quarters[0]!;
    expect(q1.day).toBe(QUARTER_DAYS);
    expect(q1.grant).toBe(Math.round((scenario.goal.quarterlyBudget * q1.satisfaction) / 100));
    expect(s.resources.budget).toBe(scenario.resources.budget + q1.grant);
    expect(s.money.received).toBe(scenario.resources.budget + q1.grant);

    s.advance(TICKS_PER_DAY * QUARTER_DAYS * 3);
    expect(s.quarters).toHaveLength(4);
    expect(s.quarters[3]!.final).toBe(true);
    expect(s.quarters[3]!.grant).toBe(0);
    expect(s.ended).toBe(true);
    const r = s.submit({ type: 'necropsy', species: null, x: 32, y: 32 });
    expect(r.ok).toBe(false);
    expect(s.submit({ type: 'setSpeed', speed: 0 }).ok).toBe(true);
    // 结束后不再结算。
    s.advance(TICKS_PER_DAY * QUARTER_DAYS);
    expect(s.quarters).toHaveLength(4);
  });

  it('委托目标里写错的物种 id 直接报错', () => {
    const bad: Rules = { ...rules, goal: { ...rules.goal!, native: ['doterel'] } };
    expect(() => new Session({ seed: 5, world: small, species, tools }, bad)).toThrow('doterel');
  });

  it('满意度的变化记的是夹在 0–100 之后实际变的', () => {
    const s = new Session({ seed: 5, world: small, species, tools }, { ...rules, satisfaction: 100 });
    s.advance(TICKS_PER_DAY * QUARTER_DAYS * 4);
    for (const q of s.quarters) expect(q.satisfaction - q.satisfactionDelta).toBeGreaterThanOrEqual(0);
    const all = s.quarters;
    for (let i = 1; i < all.length; i++) expect(all[i]!.satisfaction - all[i]!.satisfactionDelta).toBe(all[i - 1]!.satisfaction);
  });

  it('沙盒没有委托，不结算', () => {
    const s = new Session({ seed: 5, world: small, species, tools });
    s.advance(TICKS_PER_DAY * QUARTER_DAYS);
    expect(s.totalQuarters).toBe(0);
    expect(s.quarters).toHaveLength(0);
  });

  it('回放出同样的结算（花费也一样）', () => {
    const s = make();
    s.advance(TICKS_PER_DAY * 20);
    expect(s.submit({ type: 'necropsy', species: null, x: 32, y: 32 }).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 200);
    const again = Session.replay(s.exportLog());
    expect(again.quarters).toEqual(s.quarters);
    expect(again.money).toEqual(s.money);
    expect(s.money.spent).toBe(tools.necropsy.cost);
  });
});
