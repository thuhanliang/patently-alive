import { describe, expect, it } from 'vitest';
import { Session, TICKS_PER_DAY, checksum, type Op } from '../src/sim';
import { makeConfig } from './helpers';

/** 模拟一个玩家：在不同时间点提交一串操作，中间推进时间。 */
function play(session: Session): void {
  const at = (ticks: number, op: Op): void => {
    session.advance(ticks);
    expect(session.submit(op)).toEqual({ ok: true });
  };
  at(0, { type: 'setSpeed', speed: 10 });
  at(TICKS_PER_DAY * 3 + 5, { type: 'release', species: 'stoat', x: 5, y: 6, count: 20 });
  at(TICKS_PER_DAY * 2, { type: 'setFocus', focus: { x0: 0, y0: 0, x1: 16, y1: 16 } });
  at(17, { type: 'release', species: 'rabbit', x: 3, y: 3, count: 50 }); // 关注区里投放：直接展开成个体
  at(TICKS_PER_DAY * 4, { type: 'setSpeed', speed: 0 });
  at(0, { type: 'setFocus', focus: { x0: 8, y0: 8, x1: 24, y1: 24 } });
  at(TICKS_PER_DAY * 5 + 11, { type: 'setFocus', focus: null });
  session.advance(TICKS_PER_DAY * 2);
}

describe('统一操作接口与操作日志', () => {
  it('同种子 + 同一串操作，跑两次结果逐位相同', () => {
    const a = new Session(makeConfig(77));
    const b = new Session(makeConfig(77));
    play(a);
    play(b);
    expect(checksum(a.sim.state)).toBe(checksum(b.sim.state));
    expect(a.entries).toEqual(b.entries);
  });

  it('导出日志存成文本，再回放到同一个 tick，结果逐位相同', () => {
    const live = new Session(makeConfig(78));
    play(live);
    const text = JSON.stringify(live.exportLog());
    const replayed = Session.replay(JSON.parse(text), live.sim.tick);
    expect(replayed.sim.tick).toBe(live.sim.tick);
    expect(checksum(replayed.sim.state)).toBe(checksum(live.sim.state));
    // 回放出的局里，日志也一模一样。
    expect(replayed.entries).toEqual(live.entries);
  });

  it('调速和暂停不影响推演结果', () => {
    const a = new Session(makeConfig(79));
    const b = new Session(makeConfig(79));
    a.advance(100);
    b.submit({ type: 'setSpeed', speed: 0 });
    b.submit({ type: 'setSpeed', speed: 100 });
    b.advance(100);
    expect(checksum(a.sim.state)).toBe(checksum(b.sim.state));
    expect(b.entries.length).toBe(2);
    expect(b.speed).toBe(100);
  });

  it('不合法的操作被拒绝，说明原因，不进日志、不改状态', () => {
    const s = new Session(makeConfig(80));
    s.advance(30);
    const before = checksum(s.sim.state);
    const bad: unknown[] = [
      { type: 'release', species: 'unicorn', x: 1, y: 1, count: 5 },
      { type: 'release', species: 'vole', x: -1, y: 1, count: 5 },
      { type: 'release', species: 'vole', x: 1, y: 999, count: 5 },
      { type: 'release', species: 'vole', x: 1, y: 1, count: 0 },
      { type: 'release', species: 'vole', x: 1.5, y: 1, count: 3 },
      { type: 'setFocus', focus: { x0: 3, y0: 0, x1: 11, y1: 8 } },
      { type: 'setSpeed', speed: -1 },
      { type: 'teleport' },
      'release 5 voles',
    ];
    for (const op of bad) {
      const r = s.submit(op);
      expect(r.ok, JSON.stringify(op)).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
    expect(s.entries.length).toBe(0);
    expect(checksum(s.sim.state)).toBe(before);
  });

  it('投放的数量计入总数和当天账目，记账恒等式照样成立', () => {
    const s = new Session(makeConfig(81));
    s.advance(TICKS_PER_DAY);
    const before = s.sim.totals();
    s.advance(5);
    s.submit({ type: 'release', species: 'rabbit', x: 10, y: 10, count: 40 });
    s.advance(TICKS_PER_DAY - 5);
    const day = s.sim.state.lastDay;
    const rabbit = s.sim.species.findIndex((d) => d.params.id === 'rabbit');
    expect(day[rabbit]!.released).toBe(40);
    day.forEach((d, i) => {
      expect(d.total).toBe(before[i]! + d.births + d.released - d.deathsPredation - d.deathsStarvation - d.deathsOther);
    });
  });

  it('回放时日志被改动（操作不合法）会明确报错', () => {
    const s = new Session(makeConfig(82));
    s.submit({ type: 'release', species: 'vole', x: 1, y: 1, count: 3 });
    const log = s.exportLog();
    log.entries[0]!.op = { type: 'release', species: 'vole', x: 1, y: 9999, count: 3 };
    expect(() => Session.replay(log)).toThrow(/回放失败/);
    expect(() => Session.replay({ ...log, entries: [{ tick: 5, op: log.entries[0]!.op }, { tick: 1, op: log.entries[0]!.op }] })).toThrow();
  });
});
