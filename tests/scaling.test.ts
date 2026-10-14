import { describe, expect, it } from 'vitest';
import { archiveLibrary, scalingLaws, speciesLibrary } from '../src/data';
import lawsJson from '../src/data/scaling/laws.json';
import { fitLaws } from '../scripts/data/fit-scaling.mjs';
import { applyLaw, errorFactor, scaleTraits, type ScaledTraits } from '../src/sim';

/** 真实物种当成"设计"：只给原因（体重、窝仔数、食性、鸟或兽、会不会飞），推导出的参数和数据比。 */
function predicted(id: string): ScaledTraits {
  const p = speciesLibrary.get(id)!;
  return scaleTraits(scalingLaws, {
    bodyMassKg: p.bodyMassKg,
    litterSize: p.reproduction.litterSize,
    diet: p.diet,
    bird: archiveLibrary.get(id)!.taxonomy.class === '鸟纲',
    flies: p.movement.flies === true,
  });
}

/** 野猫推导出的妊娠期、性成熟、最长寿命、存活率、家域，逐位钉死；重新拟合改了 laws.json 要跟着改。 */
const PINNED_CAT = [57.01694246119917, 344.25646611194, 9.71991530110317, 0.4344162421637947, 2.1810477469841363];

/** 预测和实际差几倍（≥ 1）。 */
const fold = (a: number, b: number): number => Math.max(a / b, b / a);

const COMPARED = [
  ['gestationDays', (p) => p.reproduction.gestationDays],
  ['ageAtMaturityDays', (p) => p.reproduction.ageAtMaturityDays],
  ['maxLifespanYears', (p) => p.maxLifespanYears],
  ['adultAnnualSurvival', (p) => p.survival.adultAnnual],
  ['dailyRangeM', (p) => p.movement.dailyRangeM],
] as const satisfies ReadonlyArray<readonly [keyof ScaledTraits, (p: NonNullable<ReturnType<typeof speciesLibrary.get>>) => number]>;

describe('体重缩放公式', () => {
  it('laws.json 和数据库重新拟合的结果一致（数据库或拟合脚本改了要重跑 npm run data:fit）', () => {
    // 经过一次 JSON 往返，和文件里一样（去掉 undefined 之类）。
    expect(JSON.parse(JSON.stringify(fitLaws()))).toEqual(lawsJson);
  });

  it('系数在生物学上说得通：越重越慢，生得越多越快', () => {
    for (const lh of [scalingLaws.mammal, scalingLaws.bird]) {
      for (const law of [lh.gestationDays, lh.ageAtMaturityDays, lh.maxLifespanYears]) {
        expect(law.terms.log10MassG).toBeGreaterThan(0);
        expect(law.terms.log10Litter).toBeLessThan(0);
      }
    }
    // 代谢率随体重的指数在 2/3 和 3/4 附近；吃动物的家域比吃草的大。
    expect(scalingLaws.mammal.basalMetabolismW.terms.log10MassG).toBeGreaterThan(0.65);
    expect(scalingLaws.mammal.basalMetabolismW.terms.log10MassG).toBeLessThan(0.8);
    expect(scalingLaws.mammal.homeRangeKm2.terms.trophicLevel).toBeGreaterThan(0);
  });

  it('现有技术条目当成设计：推导值大多落在公式误差倍数的平方以内', () => {
    // 鸟和兽各用各自公式的误差。存活率和每天活动范围是按这些条目校准的（样本内），误差倍数取校准时的离散程度。
    const tolerance = (bird: boolean): Record<string, number> => {
      const lh = bird ? scalingLaws.bird : scalingLaws.mammal;
      const sd = scalingLaws.survival.residualSdLog10;
      return {
        gestationDays: errorFactor(lh.gestationDays),
        ageAtMaturityDays: errorFactor(lh.ageAtMaturityDays),
        maxLifespanYears: errorFactor(lh.maxLifespanYears),
        adultAnnualSurvival: errorFactor({ residualSdLog10: bird ? sd.bird : sd.mammal }),
        dailyRangeM: errorFactor(scalingLaws.dailyRange),
      };
    };
    const misses: string[] = [];
    let total = 0;
    for (const id of speciesLibrary.keys()) {
      const pred = predicted(id);
      const tol = tolerance(archiveLibrary.get(id)!.taxonomy.class === '鸟纲');
      for (const [key, actual] of COMPARED) {
        total += 1;
        const a = actual(speciesLibrary.get(id)!);
        // 存活率按死亡率比（0.95 和 0.97 的差别在于死亡率差了快一倍）。
        const f = key === 'adultAnnualSurvival' ? fold(1 - pred[key], 1 - a) : fold(pred[key] as number, a);
        if (f > tol[key]! ** 2) misses.push(`${id}.${key}: 推导 ${(pred[key] as number).toPrecision(3)}，数据 ${a}`);
      }
    }
    // 真实动物各有特殊之处（鸮鹦鹉几年才繁殖一次，鼬类小而长寿），允许少数例外，但不能多。
    expect(misses.length / total, misses.join('\n')).toBeLessThan(0.1);
  });

  it('确定：推导走确定的数学函数，结果钉死（换成 Math.log 之类会在别的引擎上差最后一位）', () => {
    const cat = predicted('cat');
    expect([cat.gestationDays, cat.ageAtMaturityDays, cat.maxLifespanYears, cat.adultAnnualSurvival, cat.homeRangeKm2]).toEqual(PINNED_CAT);
  });

  it('公式要的自变量没给就报错，不悄悄当 0', () => {
    const law = { ...scalingLaws.mammal.gestationDays, terms: { renamed: 1 } };
    expect(() => applyLaw(law, { log10MassG: 3 })).toThrow(/renamed/);
  });

  it('飞行：超过最重飞鸟的体重就飞不起来；会飞的能量需求更高', () => {
    const c = { litterSize: 2, diet: { plant: 0, vertebrate: 0, invertebrate: 1 }, bird: true, flies: true };
    expect(scaleTraits(scalingLaws, { ...c, bodyMassKg: 1 }).tooHeavyToFly).toBe(false);
    expect(scaleTraits(scalingLaws, { ...c, bodyMassKg: scalingLaws.flight.maxMassKg * 1.5 }).tooHeavyToFly).toBe(true);
    expect(scaleTraits(scalingLaws, { ...c, bodyMassKg: 1 }).energyFactor).toBeGreaterThan(1);
    // 系数是全体鸟类的平均：不会飞的鸟也比同体重的兽耗能；不会飞的兽是 1。
    expect(scaleTraits(scalingLaws, { ...c, bodyMassKg: 1, flies: false }).energyFactor).toBeGreaterThan(1);
    expect(scaleTraits(scalingLaws, { ...c, bodyMassKg: 1, flies: false, bird: false }).energyFactor).toBe(1);
  });
});
