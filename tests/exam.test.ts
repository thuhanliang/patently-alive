import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor, type WorldParams } from '../src/data';
import { CAUSE, Rng, Session, Sim, TICKS_PER_DAY, type Rules } from '../src/sim';
import { blockCounter, EMPTY_STOMACH, examine, type ExamContext } from '../src/sim/exam';
import { meanCi, summarize, wilson } from '../src/sim/inference';
import { crowdingBlocks } from '../src/sim/population';
import { TERRAIN } from '../src/sim/terrain';

const scenario = scenarioLibrary.get('bird-island')!;
const island = worldFor(scenario);
const small: WorldParams = { ...island, width: 64, height: 64 };
const rules: Rules = { scenario: scenario.id, ...scenario.resources, allowRelease: false, sentiment: scenario.sentiment };

describe('置信区间', () => {
  it('Wilson：0/10 的上限约 28%，5/10 约 24%–76%，不越出 0–1', () => {
    const zero = wilson(0, 10);
    expect(zero.lo).toBe(0);
    expect(zero.hi).toBeCloseTo(0.2775, 3);
    const half = wilson(5, 10);
    expect(half.lo).toBeCloseTo(0.2366, 3);
    expect(half.hi).toBeCloseTo(0.7634, 3);
    const all = wilson(10, 10);
    expect(all.hi).toBe(1);
    expect(wilson(0, 0)).toMatchObject({ lo: 0, hi: 1 });
  });

  it('平均值：均值 ± 1.96 × 标准误', () => {
    const m = meanCi([1, 2, 3, 4, 5]);
    expect(m.mean).toBe(3);
    expect(m.hi - m.mean).toBeCloseTo(1.96 * Math.sqrt(2.5 / 5), 10);
  });
});

describe('体检由动物的真实状态推出', () => {
  const sim = Sim.create({ seed: 5, world: small, species: speciesFor(small), tools });
  const st = sim.snapshot();
  const blocks = crowdingBlocks(st.grid.width, st.grid.height, st.grid.terrain);
  const ids = sim.species.map((s) => s.params.id);
  const land = st.grid.terrain.findIndex((t) => t === TERRAIN.grass);
  const ctx = (fed: number, rng = Rng.fromSeed(1)): ExamContext => ({
    species: sim.species,
    populations: st.populations,
    individuals: st.individuals,
    fedLast: st.fedLast.map((a) => new Float64Array(a.length).fill(fed)),
    ledger: st.deaths,
    blockOf: blocks.blockOf,
    width: st.grid.width,
    day: 100,
    rng,
    countInBlock: blockCounter(st.populations, st.individuals, blocks.blockOf, st.grid.width),
  });

  it('吃不饱的体况评分低、体重轻', () => {
    const rat = ids.indexOf('rat');
    const many = (fed: number) => {
      const c = ctx(fed);
      return Array.from({ length: 200 }, () => examine({ kind: 'cohort', s: rat, c: land, stage: -1 }, c));
    };
    const fat = many(1);
    const thin = many(0.05);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(fat.map((e) => e.bcs))).toBeGreaterThan(avg(thin.map((e) => e.bcs)) + 1.5);
    expect(avg(fat.map((e) => e.massKg))).toBeGreaterThan(avg(thin.map((e) => e.massKg)) * 1.2);
    for (const e of [...fat, ...thin]) {
      expect(e.bcs).toBeGreaterThanOrEqual(1);
      expect(e.bcs).toBeLessThanOrEqual(5);
      expect(e.bcs * 2).toBe(Math.round(e.bcs * 2));
    }
    expect(avg(thin.map((e) => e.stomach.fullness))).toBeLessThan(0.1);
    // 空胃里看不出任何东西（检查卡和抽样推断说法一致）。
    for (const e of thin) {
      if (e.stomach.fullness < EMPTY_STOMACH) expect(e.stomach).toMatchObject({ prey: -1, plant: 0, invertebrate: 0, vertebrate: 0 });
    }
  });

  it('幼体比成体轻；成体年龄不小于成熟年龄、不超过最长寿命', () => {
    const rabbit = ids.indexOf('rabbit');
    const sp = sim.species[rabbit]!;
    const c = ctx(1);
    const juv = examine({ kind: 'cohort', s: rabbit, c: land, stage: sp.nestStages }, c);
    expect(juv.juvenile).toBe(true);
    expect(juv.massKg).toBeLessThan(sp.params.bodyMassKg * 0.8);
    let atMax = 0;
    for (let k = 0; k < 400; k++) {
      const a = examine({ kind: 'cohort', s: rabbit, c: land, stage: -1 }, c);
      expect(a.juvenile).toBe(false);
      expect(a.ageDays).toBeGreaterThanOrEqual(sp.juvenileStages * sp.stageDays);
      expect(a.ageDays).toBeLessThanOrEqual(sp.maxAgeDays);
      if (a.ageDays === sp.maxAgeDays) atMax += 1;
    }
    // 截断的指数分布：不会都堆在寿命上限。
    expect(atMax).toBeLessThan(10);
  });

  it('胃里的残骸来自死因账本：这一片最近猫吃鸟，猫胃里才有鸟', () => {
    const cat = ids.indexOf('cat');
    const bird = ids.indexOf('dotterel');
    const block = blocks.blockOf[land]!;
    const l = st.deaths;
    l.recent.fill(0);
    const none = examine({ kind: 'cohort', s: cat, c: land, stage: -1 }, ctx(1));
    expect(none.stomach.prey).toBe(-1);
    // 区块里只有一只猫，最近每天吃掉一只鸟。
    for (const pop of st.populations) {
      for (let c = 0; c < pop.adults.length; c++) if (blocks.blockOf[c] === block) pop.adults[c] = 0;
    }
    st.populations[cat]!.adults[land] = 1;
    l.recent[(bird * l.causes + CAUSE.predation(cat)) * l.blocks + block] = 50;
    const c = ctx(1);
    const exams = Array.from({ length: 50 }, () => examine({ kind: 'cohort', s: cat, c: land, stage: -1 }, c));
    expect(exams.filter((e) => e.stomach.prey === bird).length).toBeGreaterThan(40);
    for (const e of exams) if (e.stomach.prey >= 0) expect(e.stomach.preyNest).toBe(false);
  });
});

describe('体检采样', () => {
  it('抓到的检查后放生：不算移除，记进捕获记录（trap = −1），不超过上限', () => {
    const s = new Session({ seed: 2, world: small, species: speciesFor(small), tools }, rules);
    s.advance(TICKS_PER_DAY * 30);
    const g = s.sim.state.grid;
    const c = g.terrain.findIndex((t, i) => t === TERRAIN.grass && Math.abs((i % g.width) - 32) < 8 && Math.abs(Math.floor(i / g.width) - 32) < 8);
    const budget = s.resources.budget;
    expect(s.submit({ type: 'sample', species: 'rat', x: c % g.width, y: Math.floor(c / g.width) })).toEqual({ ok: true });
    expect(s.resources.budget).toBe(budget - tools.sample.cost);
    s.advance(TICKS_PER_DAY);
    const rat = s.sim.species.findIndex((x) => x.params.id === 'rat');
    const recs = s.sim.state.captures.filter((r) => r.trap === -1);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(tools.sample.maxAnimals);
    for (const r of recs) {
      expect(r.species).toBe(rat);
      expect(r.removed).toBe(false);
    }
    expect(s.sim.state.lastDay[rat]!.removed).toBe(0);
    const sum = summarize(s.sim.state.captures, rat);
    expect(sum.n).toBe(recs.length);
    expect(sum.fromSampling).toBe(recs.length);
  });

  it('陷阱抓到的也有检查结果；回放出同样的检查记录', () => {
    const s = new Session({ seed: 3, world: small, species: speciesFor(small), tools }, rules);
    s.advance(TICKS_PER_DAY * 20);
    const g = s.sim.state.grid;
    const c = g.terrain.findIndex((t, i) => t === TERRAIN.grass && Math.abs((i % g.width) - 32) < 8 && Math.abs(Math.floor(i / g.width) - 32) < 8);
    expect(s.submit({ type: 'trap', trap: 'rat-cage', x: c % g.width, y: Math.floor(c / g.width), nights: 3, remove: ['rat'] }).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 4);
    const caps = s.sim.state.captures;
    expect(caps.length).toBeGreaterThan(0);
    for (const r of caps) {
      expect(r.massKg).toBeGreaterThan(0);
      expect(r.bcs).toBeGreaterThanOrEqual(1);
    }
    const replayed = Session.replay(JSON.parse(JSON.stringify(s.exportLog())));
    expect(replayed.sim.state.captures).toEqual(caps);
  });
});
