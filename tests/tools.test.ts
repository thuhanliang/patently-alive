import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, speciesLibrary, tools, worldFor, type WorldParams } from '../src/data';
import { CAUSE, SANDBOX_RULES, Session, TICKS_PER_DAY, checksum, scenarioRules, type Rules } from '../src/sim';
import { baitAppeal, catchmentRadius, fitsTrap } from '../src/sim/jobs';
import { deriveSpecies } from '../src/sim/physiology';
import { TERRAIN } from '../src/sim/terrain';

const scenario = scenarioLibrary.get('bird-island')!;
const island = worldFor(scenario);
const small: WorldParams = { ...island, width: 64, height: 64 };
const rules: Rules = scenarioRules(scenario);
const catCage = tools.traps.find((t) => t.id === 'cat-cage')!;
const ratCage = tools.traps.find((t) => t.id === 'rat-cage')!;

function newSession(seed = 1, r: Rules = rules): Session {
  return new Session({ seed, world: small, species: speciesFor(small), tools }, r);
}

/** 主岛中部的一格陆地（不是海岸）。 */
function inland(session: Session): { x: number; y: number } {
  const g = session.sim.state.grid;
  const cx = Math.floor(g.width / 2);
  const cy = Math.floor(g.height / 2);
  for (let r = 0; r < g.width; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const t = g.terrain[y * g.width + x];
        if (t === TERRAIN.grass || t === TERRAIN.shrub) return { x, y };
      }
    }
  }
  throw new Error('没有内陆');
}

const ids = (session: Session): string[] => session.sim.species.map((s) => s.params.id);

describe('陷阱抓到谁由性状推出', () => {
  const sp = (id: string) => deriveSpecies(speciesLibrary.get(id)!, island.cellSizeM);

  it('猫笼：鼠和鸟太轻踩不动机关；肉饵对猫最有吸引力', () => {
    expect(fitsTrap(catCage, sp('rat').params.bodyMassKg)).toBe(false);
    expect(fitsTrap(catCage, sp('dotterel').params.bodyMassKg)).toBe(false);
    expect(fitsTrap(catCage, sp('cat').params.bodyMassKg)).toBe(true);
    expect(baitAppeal(catCage, sp('cat'))).toBeGreaterThan(baitAppeal(catCage, sp('rabbit')) * 5);
  });

  it('鼠笼：鼠最爱花生酱；鸟踩得动，偶尔也进笼；猫钻不进', () => {
    expect(fitsTrap(ratCage, sp('rat').params.bodyMassKg)).toBe(true);
    expect(fitsTrap(ratCage, sp('dotterel').params.bodyMassKg)).toBe(true);
    expect(fitsTrap(ratCage, sp('cat').params.bodyMassKg)).toBe(false);
    expect(baitAppeal(ratCage, sp('dotterel'))).toBeGreaterThan(0);
    expect(baitAppeal(ratCage, sp('rat'))).toBeGreaterThan(baitAppeal(ratCage, sp('dotterel')));
  });

  it('走得远的动物从更远处被吸引过来：猫的范围比鼠大得多', () => {
    expect(catchmentRadius(sp('cat'), island.cellSizeM)).toBeGreaterThan(5 * catchmentRadius(sp('rat'), island.cellSizeM));
  });
});

describe('陷阱与搜捕', () => {
  it('布一组鼠笼：抓到的鼠移除，抓到的鸟放生；花费、人手、记账都对', () => {
    const s = newSession(2);
    const at = inland(s);
    s.advance(TICKS_PER_DAY * 40);
    const budget = s.resources.budget;
    const r = s.submit({ type: 'trap', trap: 'rat-cage', x: at.x, y: at.y, nights: 10, remove: ['rat'] });
    expect(r).toEqual({ ok: true });
    expect(s.resources.budget).toBe(budget - ratCage.setupCost - 10 * ratCage.nightlyCost);
    expect(s.freeStaff()).toBe(rules.staff - 1);

    const species = ids(s);
    const rat = species.indexOf('rat');
    let removed = 0;
    for (let d = 0; d < 10; d++) {
      s.advance(TICKS_PER_DAY);
      removed += s.sim.state.lastDay[rat]!.removed;
      // 账本里的"人为移除"和当天的移除数对得上。
      const l = s.sim.state.deaths;
      expect(l.lastDay[rat * l.causes + CAUSE.removed]).toBe(s.sim.state.lastDay[rat]!.removed);
    }
    const caps = s.sim.state.captures;
    expect(caps.length).toBeGreaterThan(5);
    expect(caps.every((c) => c.removed === (species[c.species] === 'rat'))).toBe(true);
    expect(removed).toBe(caps.filter((c) => c.removed).length);
    // 十晚之后队伍空出来，陷阱收走。
    expect(s.freeStaff()).toBe(rules.staff);
    expect(s.sim.state.jobs.length).toBe(0);
  });

  it('移除猫、扑杀鸟都扣满意度（按委托人在意的程度），移除鼠不扣', () => {
    const s = newSession(3);
    const at = inland(s);
    s.advance(TICKS_PER_DAY * 5);
    const before = s.resources.satisfaction;
    expect(s.submit({ type: 'cull', species: 'rat', x: at.x, y: at.y })).toEqual({ ok: true });
    s.advance(TICKS_PER_DAY);
    const rat = ids(s).indexOf('rat');
    expect(s.sim.state.lastDay[rat]!.removed).toBeGreaterThan(0);
    // 搜捕本身扣一点（工具数据），鼠的 sentiment 为 0。
    expect(s.resources.satisfaction).toBeCloseTo(before + tools.cull.satisfaction);

    const mid = s.resources.satisfaction;
    expect(s.submit({ type: 'cull', species: 'dotterel', x: at.x, y: at.y })).toEqual({ ok: true });
    s.advance(TICKS_PER_DAY);
    const killed = s.sim.state.lastDay[ids(s).indexOf('dotterel')]!.removed;
    expect(s.resources.satisfaction).toBeCloseTo(Math.max(0, mid + tools.cull.satisfaction - killed * scenario.sentiment.dotterel!));
  });

  it('人手不够、预算不够时拒绝，什么都不改变', () => {
    const s = newSession(4, { ...rules, staff: 1, budget: 5000 });
    const at = inland(s);
    expect(s.submit({ type: 'trap', trap: 'cat-cage', x: at.x, y: at.y, nights: 5, remove: ['cat'] })).toEqual({ ok: true });
    const before = checksum(s.sim.state);
    const busy = s.submit({ type: 'cull', species: 'cat', x: at.x, y: at.y });
    expect(busy.ok).toBe(false);
    s.advance(TICKS_PER_DAY * 5);
    const poor = s.submit({ type: 'trap', trap: 'cat-cage', x: at.x, y: at.y, nights: 30, remove: ['cat'] });
    expect(poor.ok).toBe(false);
    if (!poor.ok) expect(poor.reason).toMatch(/预算/);
    expect(s.entries.length).toBe(1);
    expect(checksum(s.sim.state)).not.toBe(before); // 时间走了；但被拒绝的操作没进日志
  });

  it('情景里的管理员不能投放动物；沙盒可以', () => {
    const s = newSession(5);
    const at = inland(s);
    const r = s.submit({ type: 'release', species: 'cat', x: at.x, y: at.y, count: 3 });
    expect(r.ok).toBe(false);
    const sandbox = newSession(5, SANDBOX_RULES);
    expect(sandbox.submit({ type: 'release', species: 'cat', x: at.x, y: at.y, count: 3 })).toEqual({ ok: true });
  });

  it('带陷阱、搜捕、展开个体的一局，存成日志再回放，结果逐位相同（资源也一样）', () => {
    const live = newSession(6);
    const at = inland(live);
    live.submit({ type: 'setFocus', focus: { x0: Math.floor(at.x / 8) * 8, y0: Math.floor(at.y / 8) * 8, x1: Math.floor(at.x / 8) * 8 + 16, y1: Math.floor(at.y / 8) * 8 + 16 } });
    live.advance(TICKS_PER_DAY * 3 + 7);
    live.submit({ type: 'trap', trap: 'rat-cage', x: at.x, y: at.y, nights: 6, remove: ['rat'] });
    live.advance(TICKS_PER_DAY * 2);
    live.submit({ type: 'cull', species: 'rabbit', x: at.x, y: at.y });
    live.advance(TICKS_PER_DAY * 8);
    const replayed = Session.replay(JSON.parse(JSON.stringify(live.exportLog())));
    expect(checksum(replayed.sim.state)).toBe(checksum(live.sim.state));
    expect(replayed.resources).toEqual(live.resources);
  });
});
