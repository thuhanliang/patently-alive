import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor, type WorldParams } from '../src/data';
import { checksum, scenarioRules, Session, TICKS_PER_DAY, type Rules } from '../src/sim';
import { SimHost, type DayRecord } from '../src/runtime/host';
import { QUARTER_DAYS } from '../src/sim/score';

const scenario = scenarioLibrary.get('bird-island')!;
const world: WorldParams = { ...worldFor(scenario), width: 48, height: 48 };
const rules: Rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 } };
const config = { seed: 4, world, species: speciesFor(world), tools };

/** 推进 n 个 tick：1 倍速下一个 tick 50 毫秒，每次给足时间、不设期限。 */
function runTicks(host: SimHost, n: number): void {
  for (let i = 0; i < n; i++) host.run(50, () => 0, Infinity);
}

describe('推演宿主（Worker 里跑的那一层）', () => {
  it('按真实时间推进、经统一操作接口提交操作，结果和直接用 Session 逐位相同', () => {
    const host = new SimHost(config, rules, { speed: 1, held: false });
    const direct = new Session(config, rules);
    direct.submit({ type: 'setSpeed', speed: 1 });
    runTicks(host, 30);
    direct.advance(30);
    const op = { type: 'necropsy' as const, species: null, x: 24, y: 24 };
    expect(host.handle({ t: 'submit', id: 1, op })).toEqual({ t: 'submitted', id: 1, result: { ok: true } });
    direct.submit(op);
    runTicks(host, 100);
    direct.advance(100);
    const v = host.view();
    expect(v.tick).toBe(direct.sim.tick);
    expect(checksum(v.state)).toBe(checksum(direct.sim.state));
    expect(v.entries).toBe(direct.entries.length);
    expect(v.money).toEqual(direct.money);
  });

  it('挂起和速度 0 时不走；时刻没变时视图不重发推演状态', () => {
    const host = new SimHost(config, rules, { speed: 1, held: true });
    runTicks(host, 10);
    const v1 = host.view();
    expect(v1.tick).toBe(0);
    expect(v1.state).not.toBeNull();
    expect(host.view().state).toBeNull();
    // 停着的时候提交的操作，下一份视图也要带上新状态（不然画面停在旧的）。
    host.handle({ t: 'submit', id: 9, op: { type: 'setFocus', focus: { x0: 8, y0: 8, x1: 24, y1: 24 } } });
    expect(host.view().state?.requestedFocus).toEqual({ x0: 8, y0: 8, x1: 24, y1: 24 });
    host.handle({ t: 'hold', on: false });
    runTicks(host, 10);
    expect(host.view().tick).toBe(10);
    host.handle({ t: 'submit', id: 2, op: { type: 'setSpeed', speed: 0 } });
    runTicks(host, 10);
    expect(host.view().tick).toBe(10);
  });

  it('结算一季后自己挂起，等主线程看完结算单；每天的曲线数据一天不落', () => {
    const host = new SimHost(config, rules, { speed: 1000, held: false });
    const days: DayRecord[] = [...host.view().days];
    for (let i = 0; i < 400; i++) {
      host.run(1000, () => 0, Infinity);
      days.push(...host.view().days);
    }
    const v = host.view();
    expect(v.quarters).toHaveLength(1);
    expect(v.held).toBe(true);
    expect(v.tick).toBe(QUARTER_DAYS * TICKS_PER_DAY);
    expect(days.map((d) => d.day)).toEqual(Array.from({ length: QUARTER_DAYS + 1 }, (_, i) => i));
    host.handle({ t: 'hold', on: false });
    host.run(1000, () => 0, Infinity);
    expect(host.view().tick).toBeGreaterThan(QUARTER_DAYS * TICKS_PER_DAY);
  });

  it('存档、读档、单步一天、换种子', () => {
    const a = new SimHost(config, rules, { speed: 1, held: false });
    runTicks(a, 50);
    const saved = a.handle({ t: 'save', id: 3 });
    expect(saved?.t).toBe('text');
    const text = saved?.t === 'text' ? saved.text : '';
    const b = new SimHost(config, rules, { speed: 1, held: false });
    const loaded = b.handle({ t: 'load', id: 4, text });
    expect(loaded).toMatchObject({ t: 'loaded', ok: true });
    const va = a.view();
    const vb = b.view();
    expect(vb.generation).toBe(1);
    expect(vb.tick).toBe(va.tick);
    expect(checksum(vb.state)).toBe(checksum(va.state));
    // 读档不改日志、不改倍速。
    expect(vb.speed).toBe(va.speed);
    expect(vb.entries).toBe(va.entries);

    b.handle({ t: 'stepDay' });
    expect(b.view().tick).toBe(TICKS_PER_DAY * 3);

    const other = new SimHost({ ...config, world: { ...world, width: 40 } }, rules, { speed: 1, held: false });
    expect(other.handle({ t: 'load', id: 5, text })).toMatchObject({ ok: false });
    expect(other.handle({ t: 'load', id: 6, text: '{"format":"x"}' })).toMatchObject({ ok: false, message: expect.stringContaining('不认识') });

    b.handle({ t: 'reseed', seed: 99 });
    const vr = b.view();
    expect(vr.generation).toBe(2);
    expect(vr.tick).toBe(0);
    expect(vr.state?.config.seed).toBe(99);
  });
});
