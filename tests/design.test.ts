import { describe, expect, it } from 'vitest';
import {
  designSlots,
  designTemplates,
  hintTemplates,
  partLibrary,
  scalingLaws,
  scenarioLibrary,
  speciesFor,
  speciesLibrary,
  SpeciesSchema,
  tools,
  worldFor,
  type Design,
} from '../src/data';
import { HintTemplatesSchema } from '../src/data/schema/design';
import { cellIndex, checksum, compileDesign, makeDesignKit, scenarioRules, Session, TICKS_PER_DAY, DAYS_PER_YEAR } from '../src/sim';

const kit = makeDesignKit(
  partLibrary,
  scalingLaws,
  hintTemplates,
  designTemplates.map((t) => t.design),
);
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const compile = (d: Design) => compileDesign(d, kit);
const fold = (a: number, b: number): number => Math.max(a / b, b / a);

describe('部件与性状数据', () => {
  it('每个槽位至少两个可选部件，每个部件最多 3 个效果', () => {
    for (const slot of designSlots) {
      const parts = [...partLibrary.values()].filter((p) => p.slot === slot.id);
      expect(parts.length, slot.name).toBeGreaterThanOrEqual(2);
      for (const p of parts) expect(p.effects.length).toBeLessThanOrEqual(3);
    }
  });

  it('现有技术写成的设计都能编译成合法的物种参数', () => {
    for (const t of designTemplates) expect(() => SpeciesSchema.parse(compile(t.design).params), t.species).not.toThrow();
  });

  it('部件不存在或装错槽位时报错', () => {
    const d = template('cat');
    expect(() => compile({ ...d, parts: { ...d.parts, mouth: 'nope' } })).toThrow(/nope/);
    expect(() => compile({ ...d, parts: { ...d.parts, mouth: 'wings' } })).toThrow(/mouth/);
  });
});

describe('设计编译器', () => {
  it('现有技术当成设计：推导出的参数大多在真实值的 2.5 倍以内', () => {
    const misses: string[] = [];
    let total = 0;
    const check = (id: string, key: string, a: number, b: number): void => {
      total += 1;
      if (fold(a, b) > 2.5) misses.push(`${id}.${key}: 推导 ${a}，数据 ${b}`);
    };
    for (const t of designTemplates) {
      const c = compile(t.design).params;
      const p = speciesLibrary.get(t.species)!;
      check(t.species, 'gestation', c.reproduction.gestationDays, p.reproduction.gestationDays);
      check(t.species, 'maturity', c.reproduction.ageAtMaturityDays, p.reproduction.ageAtMaturityDays);
      if (p.reproduction.nestDays) check(t.species, 'nestDays', c.reproduction.nestDays!, p.reproduction.nestDays);
      // 存活率按死亡率比。
      check(t.species, 'mortality', 1 - c.survival.adultAnnual, 1 - p.survival.adultAnnual);
      check(t.species, 'dailyRange', c.movement.dailyRangeM, p.movement.dailyRangeM);
    }
    // 例外都有真实原因（帚尾袋貂是有袋类、鸮鹦鹉几年才繁殖一次、鼬类延迟着床……），不能多。
    expect(misses.length / total, misses.join('\n')).toBeLessThan(0.15);
  });

  it('现有动物的胃口都在 1 附近（推演的摄食公式是按它们定的）', () => {
    let logSum = 0;
    for (const t of designTemplates) {
      const a = compile(t.design).energy.appetite;
      expect(a, t.species).toBeGreaterThan(0.6);
      expect(a, t.species).toBeLessThan(1.6);
      logSum += Math.log(a);
    }
    expect(Math.exp(logSum / designTemplates.length)).toBeCloseTo(1, 6);
  });

  it('确定：同一份设计逐位相同；野猫模板的参数钉死', () => {
    expect(compile(template('cat'))).toEqual(compile(template('cat')));
    expect(checksum(compile(template('cat')).params)).toBe(PINNED_CAT_CHECKSUM);
  });

  it('只设计原因：一窝生得多 → 成熟早、活得短、胃口大', () => {
    const base = template('mongoose');
    const few = compile({ ...base, litterSize: 1 }).params;
    const many = compile({ ...base, litterSize: 8 }).params;
    expect(many.reproduction.ageAtMaturityDays).toBeLessThan(few.reproduction.ageAtMaturityDays);
    expect(many.survival.adultAnnual).toBeLessThan(few.survival.adultAnnual);
    expect(many.energyFactor!).toBeGreaterThan(few.energyFactor!);
  });

  it('奔跑长腿走得远也更能吃；早成的幼体离窝早', () => {
    const base = template('mongoose');
    const walk = compile(base).params;
    const run = compile({ ...base, parts: { ...base.parts, limbs: 'running_legs' } }).params;
    expect(run.movement.dailyRangeM).toBeGreaterThan(walk.movement.dailyRangeM);
    expect(run.energyFactor!).toBeGreaterThan(walk.energyFactor!);
    const pre = compile({ ...base, parts: { ...base.parts, rearing: 'precocial' } }).params;
    expect(pre.reproduction.nestDays!).toBeLessThan(walk.reproduction.nestDays!);
  });

  it('提示而不禁止：太重的鸟长了翅膀照样能编译，只是飞不起来，还得付翅膀的能量', () => {
    const d = { ...template('kiwi'), bodyMassKg: 20, parts: { ...template('kiwi').parts, limbs: 'wings' } };
    const c = compile(d);
    expect(c.tooHeavyToFly).toBe(true);
    expect(c.params.movement.flies).toBeUndefined();
    expect(c.hints.map((h) => h.id)).toContain('tooHeavyToFly');
    expect(c.energy.lines.some((l) => l.label.startsWith('翅膀'))).toBe(true);
    expect(() => SpeciesSchema.parse(c.params)).not.toThrow();
  });

  it('吃草却配了短直肠：提醒消化不了，胃口变大', () => {
    const base = template('rabbit');
    const good = compile(base);
    const bad = compile({ ...base, parts: { ...base.parts, digestion: 'short_gut' } });
    expect(bad.hints.map((h) => h.id)).toContain('dietMismatch');
    expect(bad.energy.appetite).toBeGreaterThan(good.energy.appetite * 2);
  });

  it('能量钩子的总倍数和收支各行一致', () => {
    const base = template('dotterel');
    const c = compile({ ...base, parts: { ...base.parts, limbs: 'wings', rearing: 'precocial' } });
    const [daily, ...rest] = c.energy.lines;
    const parts = rest.slice(0, -1).reduce((s, l) => s + l.kjPerDay, 0);
    expect(daily!.kjPerDay * c.multipliers.energy).toBeCloseTo(daily!.kjPerDay + parts, 9);
  });

  it('提醒模板缺一个、多一个都在载入时报错', () => {
    const { energyHigh: _, ...missing } = hintTemplates;
    expect(HintTemplatesSchema.safeParse(missing).success).toBe(false);
    expect(HintTemplatesSchema.safeParse({ ...hintTemplates, extra: 'x' }).success).toBe(false);
  });

  it('提醒都按模板拼出，没有没填的占位符', () => {
    for (const t of designTemplates) for (const h of compile(t.design).hints) expect(h.text, h.id).not.toMatch(/\{\w+\}/);
  });
});

describe('设计物种进推演', () => {
  it('编译出的物种可以引进小鸟岛，跑一年不出错，日志回放结果一致', () => {
    const scenario = scenarioLibrary.get('bird-island-small')!;
    const world = worldFor(scenario);
    const rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 } };
    const config = { seed: 3, world, species: speciesFor(world), tools };
    const design: Design = { ...template('mongoose'), id: 'd_ratcatcher', name: '捕鼠者', activity: 'nocturnal' };
    const species = compile(design).params;
    const run = (): Session => {
      const s = new Session(config, rules);
      const { grid } = s.sim.state;
      let at = { x: 24, y: 24 };
      for (let r = 0; grid.terrain[cellIndex(grid, at.x, at.y)] === 0; r++) at = { x: 24 + (r % 12), y: 24 - Math.floor(r / 12) };
      expect(s.submit({ type: 'introduce', species, ...at, count: 30 })).toEqual({ ok: true });
      s.advance(TICKS_PER_DAY * DAYS_PER_YEAR);
      return s;
    };
    const a = run();
    expect(a.sim.species.at(-1)!.params.id).toBe('d_ratcatcher');
    expect(checksum(run().sim.state)).toBe(checksum(a.sim.state));
  });
});

/** 野猫模板编译出的物种参数的校验和；改了公式、部件或模板要跟着改（先确认变化是有意的）。 */
const PINNED_CAT_CHECKSUM = 3204873826;
