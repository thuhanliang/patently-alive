import { describe, expect, it } from 'vitest';
import { dentitionTypes, scenarioLibrary, speciesFor, speciesLibrary, tools, worldFor } from '../src/data';
import { checksum, deserialize, serialize, Session, TICKS_PER_DAY, scenarioRules, type Rules } from '../src/sim';
import { caseLocation, dailyDecline, lostDayOf, wildFed } from '../src/sim/cases';
import { RulesSchema } from '../src/sim/ops';
import { TERRAIN } from '../src/sim/terrain';

/** 个案动物（2026-10-22）：鸟岛上的无牙小猫。用 48×48 的小鸟岛跑，个案数据取鸟岛的。 */
const kitten = scenarioLibrary.get('bird-island')!.cases![0]!;
const small = scenarioLibrary.get('bird-island-small')!;
const world = worldFor(small);
const base: Rules = { ...scenarioRules(small), goal: { ...small.goal, years: 1 } };
const rules: Rules = { ...base, cases: [kitten] };
const cat = speciesLibrary.get('cat')!;
const config = (seed = 4) => ({ seed, world, species: speciesFor(world), tools });
const rescue = { type: 'rescue', case: kitten.id } as const;
const status = (s: Session) => s.cases()[0]!;

describe('无牙小猫', () => {
  it('数据：牙齿换成了能吃下去的比例；牙齿齐全的饿不着，没有牙的在野外吃不饱', () => {
    expect(kitten.edible).toEqual(dentitionTypes['none']!.edible);
    const full = { ...kitten, edible: dentitionTypes['full']!.edible };
    expect(wildFed(full, cat)).toBeCloseTo(1, 9);
    expect(dailyDecline(full, cat)).toBe(0);
    expect(lostDayOf(full, cat)).toBeNull();
    expect(wildFed(kitten, cat)).toBeLessThan(0.6);
    expect(dailyDecline(kitten, cat)).toBeGreaterThan(0);
    // 撑得了几个星期：够玩家注意到、派人去，但不是无限期。
    const days = lostDayOf(kitten, cat)! - kitten.appearsDay;
    expect(days).toBeGreaterThan(14);
    expect(days).toBeLessThan(45);
  });

  it('在哪：离 anchor 最近的灌丛，换种子也落在陆地上', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = new Session(config(seed), rules);
      const g = s.sim.state.grid;
      const at = caseLocation(kitten, g);
      expect(g.terrain[at.y * g.width + at.x]).toBe(TERRAIN.shrub);
      expect(status(s)).toMatchObject({ x: at.x, y: at.y });
    }
  });

  it('时间线：没看见 → 野外（体况一天天往下掉）→ 没来得及', () => {
    const s = new Session(config(), rules);
    expect(status(s).phase).toBe('hidden');
    s.advance(TICKS_PER_DAY * kitten.appearsDay);
    expect(status(s)).toMatchObject({ phase: 'wild', condition: kitten.condition });
    const lost = lostDayOf(kitten, cat)!;
    expect(status(s).daysLeft).toBe(lost - kitten.appearsDay);
    let last = status(s).condition;
    for (let d = kitten.appearsDay + 1; d < lost; d++) {
      s.advance(TICKS_PER_DAY);
      expect(status(s).phase).toBe('wild');
      expect(status(s).condition).toBeLessThan(last);
      last = status(s).condition;
    }
    s.advance(TICKS_PER_DAY);
    expect(status(s)).toMatchObject({ phase: 'lost', condition: 0 });
    expect(s.submit(rescue)).toEqual({ ok: false, reason: '来不及了：已经找不到它了' });
  });

  it('带回事务所：看见之前不行；花钱、占一支队伍；养好了成了事务所的猫；不能再带一次', () => {
    const s = new Session(config(), rules);
    expect(s.submit(rescue)).toEqual({ ok: false, reason: '还没有人见过它' });
    expect(s.submit({ type: 'rescue', case: 'nobody' }).ok).toBe(false);
    s.advance(TICKS_PER_DAY * (kitten.appearsDay + 5));
    const budget = s.resources.budget;
    const staff = s.freeStaff();
    expect(s.submit(rescue)).toEqual({ ok: true });
    expect(s.resources.budget).toBe(budget - kitten.rescue.cost);
    expect(s.freeStaff()).toBe(staff - 1);
    expect(status(s).phase).toBe('rescued');
    expect(s.submit(rescue)).toEqual({ ok: false, reason: `${kitten.name}已经在事务所了` });
    s.advance(TICKS_PER_DAY * kitten.rescue.recoveryDays);
    expect(status(s)).toMatchObject({ phase: 'office', condition: 1 });
    // 过了原本会没的日子也还好好的。
    s.advance(TICKS_PER_DAY * 60);
    expect(status(s).phase).toBe('office');
  });

  it('个案不碰推演：同样的种子和操作，有没有个案，推演状态逐位相同', () => {
    const ops = [
      { at: 3, op: { type: 'trap', trap: tools.traps[0]!.id, x: 20, y: 20, nights: 3, remove: ['cat'] } },
      { at: 40, op: { type: 'sample', species: 'rat', x: 24, y: 24 } },
    ];
    const run = (r: Rules): Session => {
      const s = new Session(config(), r);
      for (const { at, op } of ops) {
        s.advance(TICKS_PER_DAY * at - s.sim.tick);
        s.submit(op);
      }
      s.advance(TICKS_PER_DAY * 70 - s.sim.tick);
      return s;
    };
    const a = run(base);
    const b = run(rules);
    expect(checksum(b.sim.state)).toBe(checksum(a.sim.state));
    expect(a.cases()).toEqual([]);
  });

  it('救下来以后读档、回放：状态和一直玩的一样（从日志推出来）', () => {
    const s = new Session(config(), rules);
    s.advance(TICKS_PER_DAY * (kitten.appearsDay + 3) + 5);
    expect(s.submit(rescue).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 4);
    const loaded = Session.restore(deserialize(serialize(s.save())));
    expect(loaded.cases()).toEqual(s.cases());
    const replayed = Session.replay(JSON.parse(JSON.stringify(s.exportLog())));
    expect(replayed.cases()).toEqual(s.cases());
    for (const x of [s, loaded, replayed]) x.advance(TICKS_PER_DAY * kitten.rescue.recoveryDays);
    expect(loaded.cases()).toEqual(s.cases());
    expect(replayed.cases()).toEqual(s.cases());
    expect(status(s).phase).toBe('office');
  });

  it('野外时读档：照样接着往下掉', () => {
    const s = new Session(config(), rules);
    s.advance(TICKS_PER_DAY * (kitten.appearsDay + 2));
    const loaded = Session.restore(deserialize(serialize(s.save())));
    for (const x of [s, loaded]) x.advance(TICKS_PER_DAY * 3);
    expect(loaded.cases()).toEqual(s.cases());
    expect(status(loaded).phase).toBe('wild');
  });

  it('旧日志没有 cases：规则照样读得出，没有个案', () => {
    const { cases: _, ...old } = rules;
    expect(RulesSchema.parse(old).cases).toBeUndefined();
    expect(new Session(config(), RulesSchema.parse(old)).cases()).toEqual([]);
  });
});
