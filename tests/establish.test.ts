import { describe, expect, it } from 'vitest';
import { type Design, designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, scenarioLibrary, speciesFor, tools, viabilityRules, worldFor } from '../src/data';
import { Session, checksum, deserialize, serialize, TICKS_PER_DAY, QUARTER_DAYS, cellIndex, compileDesign, designDataOf, makeDesignKit, scenarioRules, type SpeciesQuarter } from '../src/sim';

/**
 * "立足"型的委托（花园岛，2026-11-10）：考核的是事务所投放的设计物种住没住下来；每季结算带各物种的账目（验收单）。
 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const scenario = scenarioLibrary.get('garden-island')!;
const world = worldFor(scenario);
const config = { seed: scenario.seed, world, species: speciesFor(world), tools, design: designDataOf(kit) };
const tpl = (id: string): Design => designTemplates.find((t) => t.species === id)!.design;

function start(): Session {
  return new Session(config, scenarioRules(scenario));
}
function landNearCentre(s: Session): { x: number; y: number } {
  const { grid } = s.sim.state;
  let at = { x: grid.width >> 1, y: grid.height >> 1 };
  for (let r = 0; grid.terrain[cellIndex(grid, at.x, at.y)] === 0; r++) at = { x: (grid.width >> 1) + (r % 12), y: (grid.height >> 1) - Math.floor(r / 12) };
  return at;
}
function release(s: Session, template: string, count: number, id = 'd_test'): void {
  const design = { ...tpl(template), id, name: '试验' };
  expect(s.submit({ type: 'introduce', species: compileDesign(design, kit).params, design, ...landNearCentre(s), count })).toEqual({ ok: true });
}
const days = (s: Session, n: number): void => s.advance(TICKS_PER_DAY * n);
const dead = (q: SpeciesQuarter): number => q.deaths.reduce((a, [, n]) => a + n, 0);

describe('立足型委托', () => {
  it('还没投放：立足 0 分；投放够数：100 分；不超过上限：不泛滥 100 分', () => {
    const s = start();
    expect(s.currentScore()!.scores.recovery).toBe(0);
    release(s, 'rabbit', 20);
    // 投放要几天（检疫、放归），到了才算。
    days(s, 10);
    expect(s.designTotal()).toBeGreaterThanOrEqual(15);
    const now = s.currentScore()!;
    expect(now.scores.recovery).toBeGreaterThanOrEqual(75);
    expect(now.scores.stability).toBe(100);
    expect(now.detail.boom).toEqual({ species: -1, ratio: s.designTotal() / scenario.goal.establish!.ceiling });
  });

  it('每季的账目守恒：季末 = 季初 + 出生 + 投放 − 移除 − 各种死因', () => {
    const s = start();
    release(s, 'rabbit', 20);
    days(s, QUARTER_DAYS * 4);
    expect(s.quarters).toHaveLength(4);
    for (const q of s.quarters) {
      expect(q.species!.map((x) => x.id)).toEqual(['dotterel', 'd_test']);
      for (const x of q.species!) expect(x.end, `第 ${q.index} 季 ${x.id}`).toBe(x.start + x.births + x.released - x.removed - dead(x));
    }
    // 上一季的季末就是下一季的季初；第一季投放的 20 只记在 released。
    expect(s.quarters[0]!.species![1]!.released).toBe(20);
    for (let i = 1; i < 4; i++) expect(s.quarters[i]!.species!.map((x) => x.start)).toEqual(s.quarters[i - 1]!.species!.map((x) => x.end));
    expect(s.quarters[3]!.targetCount).toBe(s.designTotal());
  });

  it('季中存档再读回来，这一季的账目和一口气跑完的一样', () => {
    const a = start();
    release(a, 'vole', 30);
    days(a, 40);
    const b = Session.restore(deserialize(serialize(a.save())));
    days(a, QUARTER_DAYS - 40);
    days(b, QUARTER_DAYS - 40);
    expect(b.quarters[0]!.species).toEqual(a.quarters[0]!.species);
    expect(checksum(b.sim.state)).toBe(checksum(a.sim.state));
  });

  it('食肉的设计放上去：没有可抓的东西，吃了鸟，最后饿死，账上写得出来', () => {
    const s = start();
    release(s, 'stoat', 10);
    days(s, QUARTER_DAYS * 4);
    expect(s.designTotal()).toBe(0);
    const all = s.quarters.flatMap((q) => q.species!);
    const mine = all.filter((x) => x.id === 'd_test');
    const birds = all.filter((x) => x.id === 'dotterel');
    const sum = (rows: SpeciesQuarter[], cause: number): number => rows.reduce((a, x) => a + (x.deaths.find(([c]) => c === cause)?.[1] ?? 0), 0);
    // 死因 0 = 饿死；6 + 2×1 = 被 1 号物种（投放的设计）捕食。
    expect(sum(mine, 0)).toBeGreaterThan(5);
    expect(sum(birds, 8)).toBeGreaterThan(10);
  });
});
