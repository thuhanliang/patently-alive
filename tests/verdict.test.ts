import { describe, expect, it } from 'vitest';
import { scenarioLibrary } from '../src/data';
import type { SpeciesQuarter } from '../src/sim';
import { guideText } from '../src/ui/guide';
import { mainCause, oneLine, replyKeyOf, wishesOf } from '../src/ui/verdict';

/** 验收单的措辞和委托人回哪封信（2026-11-10）。数由引擎给，这里只测"怎么说"。 */
const names = ['双斑鸻', '圆圆'];
const q = (o: Partial<SpeciesQuarter>): SpeciesQuarter => ({ id: 'd_x', start: 0, end: 0, births: 0, released: 0, removed: 0, deaths: [], ...o });
const goal = scenarioLibrary.get('garden-island')!.goal;
const detail = { targetRatio: 1, boom: null, nativesLow: [] as number[], habitat: 1, spentShare: 0, sufferingShare: 0 };

describe('验收单的一句话', () => {
  it('放上去全饿死：说一只不剩、是饿死的、为什么', () => {
    const t = oneLine(q({ released: 20, deaths: [[0, 19], [3, 1]] }), names);
    expect(t).toContain('一只都不剩了');
    expect(t).toContain('饿死');
    expect(t).toContain('找不到足够它吃的东西');
  });
  it('放上去以后变多了：不说"剩"', () => {
    expect(oneLine(q({ released: 20, births: 20, end: 30, deaths: [[1, 10]] }), names)).toBe('放上岛 20 只，生了 20 只，死了 10 只，季末有 30 只。');
  });
  it('生得不够快：没饿着也没被吃，说是补不上', () => {
    expect(oneLine(q({ start: 14, end: 12, births: 2, deaths: [[1, 4]] }), names)).toContain('补不上老死病死的');
  });
  it('被吃掉的写出是谁吃的', () => {
    const birds = q({ id: 'dotterel', start: 87, end: 49, births: 27, deaths: [[8, 60], [1, 5]] });
    expect(mainCause(birds)).toBe(8);
    expect(oneLine(birds, names)).toContain('被圆圆吃掉');
  });
});

describe('委托人回哪封信', () => {
  const at = (targetCount: number, d: Partial<typeof detail> = {}) => ({ targetCount, detail: { ...detail, ...d } });
  it('按最要紧的一条挑', () => {
    expect(replyKeyOf(at(0), goal)).toBe('gone');
    expect(replyKeyOf(at(50, { nativesLow: [0] }), goal)).toBe('natives');
    expect(replyKeyOf(at(50, { habitat: 0.3 }), goal)).toBe('habitat');
    expect(replyKeyOf(at(goal.establish!.ceiling + 1), goal)).toBe('swarm');
    expect(replyKeyOf(at(goal.establish!.settle - 1), goal)).toBe('few');
    expect(replyKeyOf(at(goal.establish!.settle), goal)).toBe('success');
  });
  it('每一种结果情景里都写了回信', () => {
    const replies = scenarioLibrary.get('garden-island')!.client.replies!;
    for (const k of ['success', 'gone', 'few', 'swarm', 'natives', 'habitat'] as const) expect(replies[k]!.length).toBeGreaterThan(0);
  });
  it('四件事对应四个勾', () => {
    expect(wishesOf(at(30), goal, names).map((w) => w.ok)).toEqual([true, true, true, true]);
    expect(wishesOf(at(5, { nativesLow: [0] }), goal, names).map((w) => w.ok)).toEqual([false, true, false, true]);
  });
});

describe('引导便签：永远只说下一件事', () => {
  const g = { placing: null, mine: [], season: { released: 0, births: 0, dead: 0 }, arrivingInDays: null, paused: false, daysToQuarter: 40, ended: false };
  it('还没有动物：去设计台', () => expect(guideText(g).action).toBe('desk'));
  it('等着点地图：说放几只、叫什么', () => expect(guideText({ ...g, placing: { count: 20, name: '圆圆' } }).text).toContain('20 只圆圆'));
  it('在跑：只说只数和什么时候出验收单，可以快进', () => {
    const r = guideText({ ...g, mine: [{ name: '圆圆', count: 22 }], season: { released: 20, births: 5, dead: 3 } });
    expect(r.text).toContain('圆圆 22 只');
    expect(r.action).toBe('fast');
  });
  it('停着：让时间走', () => expect(guideText({ ...g, mine: [{ name: '圆圆', count: 22 }], paused: true }).action).toBe('play'));
});

describe('活的图层：真实总数 → 画几只演员', () => {
  it('没有就不画；少的时候有几只画几只；多了封顶', async () => {
    const { actorCount } = await import('../src/render/paper/liveLayer');
    expect(actorCount(0, true)).toBe(0);
    expect(actorCount(1, true)).toBe(1);
    expect(actorCount(2, true)).toBe(2);
    expect(actorCount(20, true)).toBe(8);
    expect(actorCount(5000, true)).toBe(14);
    expect(actorCount(5000, false)).toBe(12);
    // 越多画得越多（不减）。
    for (let n = 1; n < 400; n++) expect(actorCount(n + 1, true)).toBeGreaterThanOrEqual(actorCount(n, true));
  });
});
