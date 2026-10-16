import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { biasOfLitter, compileDesign, errorFactor, litterFromBias, makeDesignKit, partsOf, typicalLitterSize } from '../src/sim';

const kit = makeDesignKit(
  partLibrary,
  scalingLaws,
  hintTemplates,
  viabilityRules,
  [...plantLibrary.values()],
  designTemplates.map((t) => t.design),
);
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
/** 设计台的做法：在模板自己的体型下，把仔数换成"比一般多多少"。 */
function relative(d: Design): Design {
  const parts = partsOf(d, kit);
  return { ...d, litterBias: biasOfLitter(scalingLaws, d.bodyMassKg, parts.mouth.diet!, parts.coat.bodyPlan === 'bird', d.litterSize) };
}
const fold = (a: number, b: number): number => Math.max(a / b, b / a);

/**
 * 真实值：PanTHERIA 1.0（Jones et al. 2009）。体重 克；仔数；妊娠期、胎间隔、性成熟 天；新生体重 克。
 * 胎间隔数据库里一年一窝的记作 365。
 */
const REAL = {
  lynx: { massG: 19300, litter: 2.3, gestation: 67, interbirth: 365, maturity: 740, neonateG: 289 },
  cheetah: { massG: 50578, litter: 3.28, gestation: 92, interbirth: 548, maturity: 742, neonateG: 442 },
  leopard: { massG: 52400, litter: 2.14, gestation: 97, interbirth: 476, maturity: 811, neonateG: 553 },
  puma: { massG: 53954, litter: 2.76, gestation: 92, interbirth: 578, maturity: 1035, neonateG: 410 },
  jaguar: { massG: 83943, litter: 1.96, gestation: 102, interbirth: 365, maturity: 1184, neonateG: 817 },
  lion: { massG: 158624, litter: 2.75, gestation: 109, interbirth: 730, maturity: 988, neonateG: 1292 },
  tiger: { massG: 161915, litter: 2.6, gestation: 105, interbirth: 821, maturity: 1523, neonateG: 1314 },
  wolf: { massG: 31757, litter: 4.98, gestation: 64, interbirth: 365, maturity: 679, neonateG: 412 },
} as const;

/** 把一个模板直接放大到真实物种的体重，别的都不改：推出来的生养节奏要落在公式的典型误差里。 */
function expectLike(from: string, to: keyof typeof REAL): void {
  const real = REAL[to];
  const c = compileDesign({ ...relative(template(from)), bodyMassKg: real.massG / 1000 }, kit);
  const r = c.params.reproduction;
  const neonateG = c.viability.find((v) => v.id === 'reproduction')!.evidence.neonateG!;
  const yearsPerLitter = 365 / Math.min(1, c.littersPerYear);
  const m = scalingLaws.mammal;
  // 仔数：一般值的误差。
  expect(fold(r.litterSize, real.litter), `${to} 仔数 ${r.litterSize}`).toBeLessThan(errorFactor(scalingLaws.pace.typicalLitter));
  expect(fold(r.gestationDays, real.gestation), `${to} 妊娠 ${r.gestationDays}`).toBeLessThan(errorFactor(m.gestationDays));
  expect(fold(yearsPerLitter, real.interbirth), `${to} 胎间隔 ${yearsPerLitter}`).toBeLessThan(errorFactor(scalingLaws.pace.interbirthDays));
  expect(fold(r.ageAtMaturityDays, real.maturity), `${to} 性成熟 ${r.ageAtMaturityDays}`).toBeLessThan(errorFactor(m.ageAtMaturityDays));
  expect(fold(neonateG, real.neonateG), `${to} 新生 ${Math.round(neonateG)}`).toBeLessThan(errorFactor(scalingLaws.reproduction.mammal.neonateMassG));
}

describe('繁殖节奏：仔数写成"比一般多多少"（阶段 3.5）', () => {
  it('每个现有技术在自己的体型下换算回去，仔数不变', () => {
    for (const t of designTemplates) {
      const c0 = compileDesign(t.design, kit);
      const c1 = compileDesign(relative(t.design), kit);
      expect(c1.params, t.species).toEqual(c0.params);
    }
  });

  it('"自动"就是写 0', () => {
    const cat = template('cat');
    for (const kg of [0.02, 3.3, 160, 4000]) {
      const auto = compileDesign({ ...cat, bodyMassKg: kg, litterAuto: true }, kit).params.reproduction.litterSize;
      const zero = compileDesign({ ...cat, bodyMassKg: kg, litterBias: 0 }, kit).params.reproduction.litterSize;
      expect(zero).toBe(auto);
      expect(zero).toBe(typicalLitterSize(scalingLaws, kg, compileDesign(cat, kit).params.diet, false));
    }
  });

  it('体型变大，仔数跟着变少；写了 litterBias 就不看 litterSize', () => {
    const cat = relative(template('cat'));
    const at = (kg: number) => compileDesign({ ...cat, bodyMassKg: kg, litterSize: 16 }, kit).params.reproduction.litterSize;
    expect(at(3.3)).toBe(template('cat').litterSize);
    expect(at(160)).toBeLessThan(at(3.3));
    expect(litterFromBias(scalingLaws, 3.3, compileDesign(cat, kit).params.diet, false, 5)).toBe(16);
  });

  // 验收（用户 2026-10-16）："拿一只猫直接放大体型稍微改改，能不能改出一只老虎？"
  for (const big of ['lynx', 'cheetah', 'leopard', 'puma', 'jaguar', 'lion', 'tiger'] as const) {
    it(`家猫直接放大成${big}的体重，生养节奏像${big}`, () => expectLike('cat', big));
  }
  // 不是只对猫科调出来的：狐狸放大成狼。
  it('赤狐直接放大成狼的体重，生养节奏像狼', () => expectLike('fox', 'wolf'));
});
