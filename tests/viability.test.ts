import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, scalingLaws, scenarioLibrary, speciesFor, speciesLibrary, tools, viabilityRules, worldFor, type Design } from '../src/data';
import { ViabilityRulesSchema } from '../src/data/schema/viability';
import { DesignSchema } from '../src/data/schema/design';
import { allocateBody, compileDesign, deserialize, designDataOf, makeDesignKit, scenarioRules, serialize, Session, skeletonEffects, skeletonSafety, TICKS_PER_DAY } from '../src/sim';
import { chaseFactor, deriveSpecies, preyMatrix } from '../src/sim/physiology';
import { CAUSE, recentByCause } from '../src/sim/ledger';
import viabilityJson from '../src/data/scaling/viability.json';

const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, designTemplates.map((t) => t.design));
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const withAlloc = (d: Design, allocation: Design['allocation']): Design => ({ ...d, allocation });
/** 骨头最少、其余全给满。 */
const BRITTLE = { skeleton: 0.5, muscle: 2, gut: 2, heart: 2, fat: 2 };

describe('可行性阈值数据', () => {
  it('每个数都要写依据、置信度和出处', () => {
    const bad = structuredClone(viabilityJson) as { skeleton: { cannotRun: Record<string, unknown> } };
    delete bad.skeleton.cannotRun.basis;
    expect(ViabilityRulesSchema.safeParse(bad).success).toBe(false);
    const extra = structuredClone(viabilityJson) as { skeleton: Record<string, unknown> };
    extra.skeleton.magic = { value: 1, basis: 'law', confidence: '1', source: 'x' };
    expect(ViabilityRulesSchema.safeParse(extra).success).toBe(false);
  });
});

describe('体重分配', () => {
  it('不写分配时每个系统的实际倍数正好是 1', () => {
    for (const t of designTemplates) {
      const body = allocateBody(t.design, partLibrary.get(t.design.parts.coat)!.bodyPlan === 'bird', viabilityRules);
      for (const v of Object.values(body.relative)) expect(v).toBe(1);
    }
  });

  it('此消彼长：多给骨头，其余系统按比例变少，总量不变', () => {
    const d = template('cat');
    const base = allocateBody(d, false, viabilityRules);
    const more = allocateBody(withAlloc(d, { skeleton: 2 }), false, viabilityRules);
    expect(more.relative.skeleton).toBeGreaterThan(1);
    expect(more.relative.muscle).toBeLessThan(1);
    const sum = (b: typeof base) => Object.values(b.share).reduce((s, x) => s + x, 0);
    expect(sum(more)).toBeCloseTo(sum(base), 12);
  });

  it('倍数夹在允许的范围里', () => {
    const d = template('cat');
    const a = allocateBody(withAlloc(d, { skeleton: 99 }), false, viabilityRules);
    const b = allocateBody(withAlloc(d, { skeleton: viabilityRules.body.maxRelative.value }), false, viabilityRules);
    expect(a.relative.skeleton).toBe(b.relative.skeleton);
  });

  it('不写分配的设计，内容和以前一样（设计的 id 来自内容的校验和，所以不变）', () => {
    const d = DesignSchema.parse(template('cat'));
    expect('allocation' in d).toBe(false);
  });
});

describe('骨骼检查', () => {
  it('17 条现有技术全部能跑能走', () => {
    for (const t of designTemplates) {
      const c = compileDesign(t.design, kit);
      expect(c.viability.every((r) => r.grade === 'ok'), t.species).toBe(true);
      expect(c.hints.some((h) => h.id.startsWith('bone')), t.species).toBe(false);
    }
  });

  it('骨头越少越危险：跑不动 → 走不动 → 站不住', () => {
    const d = { ...template('cat'), parts: { ...template('cat').parts, limbs: 'running_legs' } };
    const grade = (skeleton: number) => compileDesign(withAlloc(d, { skeleton }), kit).viability.find((r) => r.id === 'skeleton')!.grade;
    expect(grade(1)).toBe('ok');
    expect(grade(0.5)).toBe('strained');
  });

  it('超过站姿极限后，越重安全系数越低（平方–立方定律）', () => {
    const d = template('cat');
    const parts = { limbs: partLibrary.get('walking_legs')! } as never;
    const body = { relative: { skeleton: 1 } } as never;
    const at = (m: number) => skeletonSafety({ design: { ...d, bodyMassKg: m }, parts, body, rules: viabilityRules });
    expect(at(100)).toBe(at(1));
    const limit = viabilityRules.skeleton.postureLimitKg.value;
    expect(at(limit * 8)).toBeCloseTo(at(1) * 8 ** -viabilityRules.skeleton.stressExp.value, 6);
  });

  it('撑得住的设计参数和以前一样；撑不住的才在参数里写上后果', () => {
    const d = template('cat');
    expect('body' in compileDesign(d, kit).params).toBe(false);
    const weak = compileDesign(withAlloc(d, BRITTLE), kit).params;
    expect(weak.body).toBeDefined();
    expect(weak.body!.runFactor).toBeLessThan(1);
  });

  it('环境输入只给预览，不影响物种参数', () => {
    const d = template('rabbit');
    expect(compileDesign(d, kit, { forage: [], climate: {} }).params).toEqual(compileDesign(d, kit).params);
  });
});

/** 骨头最少、其余全给满：小于 100 千克也能做出"走不动""站不住"。 */
const brittle = (limbs: string): Design => ({
  ...template('rabbit'),
  id: `d_brittle_${limbs}`,
  name: '脆骨兔',
  parts: { ...template('rabbit').parts, limbs },
  allocation: BRITTLE,
});

describe('骨骼接进推演（阶段 3.5 第 3 步）', () => {
  it('安全系数 → 后果：跑不动只打折奔跑；走不动以下开始骨折，越低越多', () => {
    const r = viabilityRules.skeleton;
    const e = (s: number) => skeletonEffects(s, viabilityRules);
    expect(e(r.cannotRun.value)).toMatchObject({ runFactor: 1, walkFactor: 1, fractureDaily: 0 });
    expect(e(1.2).fractureDaily).toBe(0);
    expect(e(1.2).runFactor).toBeLessThan(1);
    expect(e(r.cannotStand.value).fractureDaily).toBeCloseTo(r.fractureDailyAtStand.value, 6);
    expect(e(0.5).fractureDaily).toBeGreaterThan(e(0.85).fractureDaily);
  });

  it('只靠体重分配就能做出走不动、站不住', () => {
    const grade = (limbs: string) => compileDesign(brittle(limbs), kit).viability.find((x) => x.id === 'skeleton')!.grade;
    expect(grade('walking_legs')).toBe('failing');
    expect(grade('running_legs')).toBe('fatal');
  });

  it('真实物种没有这些后果：奔跑能力 1、骨折 0', () => {
    for (const p of speciesLibrary.values()) {
      const d = deriveSpecies(p, 50);
      expect(d.runFactor).toBe(1);
      expect(d.fractureDaily).toBe(0);
    }
  });

  it('跑不动的捕食者抓到的少，跑不动的猎物被抓的多，走得也慢', () => {
    const stoatDesign = { ...template('stoat'), id: 'd_slow', name: '慢鼬' };
    const normal = deriveSpecies(compileDesign(stoatDesign, kit).params, 50);
    const slow = deriveSpecies(compileDesign(withAlloc(stoatDesign, BRITTLE), kit).params, 50);
    expect(slow.runFactor).toBeLessThan(1);
    const vole = deriveSpecies(speciesLibrary.get('vole')!, 50);
    expect(preyMatrix([slow, vole]).mobile[0]![1]!).toBeLessThan(preyMatrix([normal, vole]).mobile[0]![1]!);
    const weasel = deriveSpecies(speciesLibrary.get('weasel')!, 50);
    const preyD = { ...template('vole'), id: 'd_prey', name: '慢鼠' };
    const fine = deriveSpecies(compileDesign(preyD, kit).params, 50);
    const weak = deriveSpecies(compileDesign(withAlloc(preyD, BRITTLE), kit).params, 50);
    expect(preyMatrix([weasel, weak]).mobile[0]![1]!).toBeGreaterThan(preyMatrix([weasel, fine]).mobile[0]![1]!);
    expect(slow.hourlyStepCells).toBeLessThan(normal.hourlyStepCells);
  });

  it('会飞的猎物靠飞逃，腿骨不影响', () => {
    const weasel = deriveSpecies(speciesLibrary.get('weasel')!, 50);
    const flyer = { ...deriveSpecies(speciesLibrary.get('vole')!, 50), flies: true, runFactor: 0.4 };
    expect(chaseFactor(weasel, flyer)).toBe(1);
    expect(chaseFactor(weasel, { ...flyer, flies: false })).toBeCloseTo(1.6, 12);
  });

  it('站不住的设计投放后死于承重骨折，尸检账本里看得到；存档读回来后果还在', () => {
    const scenario = scenarioLibrary.get('bird-island-small')!;
    const world = worldFor(scenario);
    const config = { seed: 4, world, species: speciesFor(world), tools, design: designDataOf(kit) };
    const s = new Session(config, scenarioRules(scenario));
    const design = brittle('running_legs');
    const species = compileDesign(design, kit).params;
    const { grid } = s.sim.state;
    let at = { x: 0, y: 0 };
    for (let i = 0; i < grid.terrain.length; i++) if (grid.terrain[i] !== 0) { at = { x: i % grid.width, y: Math.floor(i / grid.width) }; break; }
    expect(s.submit({ type: 'introduce', species, design, ...at, count: 40 })).toEqual({ ok: true });
    s.advance(TICKS_PER_DAY * 30);
    const idx = s.sim.species.length - 1;
    expect(recentByCause(s.sim.state.deaths, idx)[CAUSE.fracture]!).toBeGreaterThan(0);
    const back = Session.restore(deserialize(serialize(s.save())));
    expect(back.sim.species[idx]!.params.body).toEqual(species.body);
    expect(back.sim.species[idx]!.fractureDaily).toBeGreaterThan(0);
  }, 60_000);
});
