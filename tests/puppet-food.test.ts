import { describe, expect, it } from 'vitest';
import { designTemplates, gaitRules, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { compileDesign, makeDesignKit } from '../src/sim';
import { dailyFood, gramText, heapRadiusM } from '../src/proto/desk/food';

/** 一天的饭量（设计台第 3 步 c）。 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const template = (s: string): Design => designTemplates.find((t) => t.species === s)!.design;
const foodOf = (d: Design, temperatureC?: number) => {
  const c = compileDesign(d, kit, temperatureC === undefined ? undefined : { climate: { temperatureC } });
  return dailyFood(c, partLibrary.get(d.parts.mouth)!.selective === true, gaitRules.food);
};
const total = (g: Record<string, number>): number => Object.values(g).reduce((a, b) => a + b, 0);

describe('一天的饭量', () => {
  it('量级对得上：猫一天几百克肉，兔几百克草，小鼠几克', () => {
    const cat = foodOf(template('cat')).grams;
    expect(cat.vertebrate).toBeGreaterThan(150);
    expect(cat.vertebrate).toBeLessThan(500);
    const rabbit = foodOf(template('rabbit')).grams;
    expect(rabbit.plant).toBeGreaterThan(200);
    expect(rabbit.plant).toBeLessThan(800);
    expect(total(foodOf(template('mouse')).grams)).toBeLessThan(20);
  });

  it('越重吃得越多；冷了多吃，不冷不多吃', () => {
    const cat = template('cat');
    expect(total(foodOf({ ...cat, bodyMassKg: 100 }).grams)).toBeGreaterThan(total(foodOf(cat).grams) * 10);
    expect(foodOf(cat).cold).toBe(0);
    expect(foodOf(cat, 20).cold).toBe(0);
    const bare = { ...cat, shape: { fur: -1 } };
    // 不试冷热时不多吃；裸的猫在 0 °C 要多吃很多。
    const warm = foodOf(bare);
    const cold = foodOf(bare, 0);
    expect(cold.cold).toBeGreaterThan(0);
    expect(total(cold.grams)).toBeCloseTo(total(warm.grams) * (1 + cold.cold), 6);
  });

  it('堆的体积 = 克数；克数的写法', () => {
    const r = heapRadiusM(1000) * 100;
    expect((2 / 3) * Math.PI * r ** 3).toBeCloseTo(1000, 6);
    expect(gramText(3.42)).toBe('3.4 克');
    expect(gramText(296.4)).toBe('296 克');
    expect(gramText(18000)).toBe('18 千克');
  });
});
