import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor, type WorldParams } from '../src/data';
import { checksum, deserialize, scenarioRules, serialize, Session, TICKS_PER_DAY, type Rules } from '../src/sim';

const scenario = scenarioLibrary.get('bird-island')!;
const world: WorldParams = { ...worldFor(scenario), width: 48, height: 48 };
const rules: Rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 } };
const config = { seed: 11, world, species: speciesFor(world), tools };

/** 一局：有关注区（展开的个体）、陷阱、尸检、围栏，停在一天中途、第一次结算之后。 */
function played(): Session {
  const s = new Session(config, rules);
  expect(s.submit({ type: 'setFocus', focus: { x0: 8, y0: 8, x1: 32, y1: 32 } }).ok).toBe(true);
  s.advance(TICKS_PER_DAY * 5);
  expect(s.submit({ type: 'trap', trap: tools.traps[0]!.id, x: 20, y: 20, nights: 3, remove: ['cat'] }).ok).toBe(true);
  expect(s.submit({ type: 'necropsy', species: null, x: 24, y: 24 }).ok).toBe(true);
  expect(s.submit({ type: 'fence', fence: tools.fences[0]!.id, x0: 10, y0: 10, x1: 10, y1: 20 }).ok).toBe(true);
  s.advance(TICKS_PER_DAY * 95 + 7);
  expect(s.quarters).toHaveLength(1);
  return s;
}

function same(a: Session, b: Session): void {
  expect(checksum(b.sim.state)).toBe(checksum(a.sim.state));
  expect(b.resources).toEqual(a.resources);
  expect(b.quarters).toEqual(a.quarters);
  expect(b.money).toEqual(a.money);
  expect(b.removed).toEqual(a.removed);
  expect(b.entries).toEqual(a.entries);
  expect(b.speed).toBe(a.speed);
}

describe('存档与读档', () => {
  it('存档写成文件再读回来，接着玩，和一口气玩下去逐位相同', () => {
    const straight = played();
    const text = serialize(straight.save());
    const loaded = Session.restore(deserialize(text));
    same(straight, loaded);
    for (const s of [straight, loaded]) {
      s.advance(TICKS_PER_DAY * 100);
      expect(s.submit({ type: 'cull', species: 'cat', x: 20, y: 20 }).ok).toBe(true);
      s.advance(TICKS_PER_DAY * 30);
    }
    same(straight, loaded);
  }, 60_000);

  it('读档的结果和按日志回放到同一刻逐位相同', () => {
    const s = played();
    same(Session.replay(s.exportLog()), Session.restore(s.save()));
  }, 60_000);

  it('快照和日志对不上的存档被拒绝', () => {
    const s = played();
    const save = s.save();
    expect(() => Session.restore({ ...save, log: { ...save.log, endTick: save.log.endTick + 1 } })).toThrow('对不上');
    const other = { ...save, log: { ...save.log, config: { ...save.log.config, seed: 12 } } };
    expect(() => Session.restore(other)).toThrow('不是同一个世界');
    expect(() => Session.restore({ ...save, version: 99 })).toThrow();
    // 旧版本的快照：少了字段、格子数组长度不对。
    const { fences: _, ...stale } = save.state;
    expect(() => Session.restore({ ...save, state: stale })).toThrow('fences');
    const grid = save.state.grid as Record<string, unknown>;
    const plants = grid.plants as Float64Array[];
    const short = { ...save.state, grid: { ...grid, plants: [new Float64Array(10), ...plants.slice(1)] } };
    expect(() => Session.restore({ ...save, state: short })).toThrow('plants[0]');
    const missing = { ...save.state, grid: { ...grid, plants: plants.slice(1) } };
    expect(() => Session.restore({ ...save, state: missing })).toThrow('plants');
  }, 60_000);

  it('文件里的 __proto__ 键被拒绝', () => {
    expect(() => deserialize('{"a":1,"__proto__":{"b":2}}')).toThrow('__proto__');
  });
});
