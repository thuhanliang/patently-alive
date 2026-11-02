import { describe, expect, it } from 'vitest';
import { designTemplates, gaitRules, partLibrary, viabilityRules, type Design } from '../src/data';
import { partsOf } from '../src/sim';
import { bodyPlan } from '../src/render/puppet/plan';
import { fringe, inside, perimeter, teethFor } from '../src/render/puppet/fringe';

/** 毛边算子（设计台第 3 步 b）。 */
const square = [0, 0, 100, 0, 100, 100, 0, 100];
const planOf = (d: Design) => bodyPlan(d, partsOf(d, { parts: partLibrary }), d.parts.coat === 'feathers', viabilityRules, gaitRules);
const template = (s: string): Design => designTemplates.find((t) => t.species === s)!.design;

describe('毛边', () => {
  it('不长毛：原样返回同一个数组（短毛的纸偶不变）', () => {
    expect(fringe(square, 0, 0, { teeth: 8 })).toBe(square);
  });

  it('毛簇个数按原样的周长定；每簇 8 个点；都在轮廓外面', () => {
    expect(teethFor(square, 50)).toBe(8);
    const out = fringe(square, 10, 3, { teeth: 8 });
    expect(out.length).toBe(8 * 8 * 2);
    for (let k = 0; k < out.length; k += 2) {
      const x = out[k]!;
      const y = out[k + 1]!;
      const outsideOrOn = x <= 0.01 || x >= 99.99 || y <= 0.01 || y >= 99.99;
      expect(outsideOrOn).toBe(true);
    }
    expect(perimeter(out)).toBeGreaterThan(perimeter(square));
  });

  it('权重 0 的边不长毛簇', () => {
    const out = fringe(square, 10, 3, { teeth: 8, weights: [0, 0, 0, 0] });
    // 每个点都还在正方形的边上。
    const on = (v: number): boolean => Math.abs(v) < 1e-9 || Math.abs(v - 100) < 1e-9;
    for (let k = 0; k < out.length; k += 2) expect(on(out[k]!) || on(out[k + 1]!)).toBe(true);
  });

  it('点在多边形里', () => {
    expect(inside(square, 50, 50)).toBe(true);
    expect(inside(square, 150, 50)).toBe(false);
  });

  it('纸偶的毛长：设计写了用设计的，不写用体表卡的点，鸟是 0', () => {
    expect(planOf(template('cat')).fur).toBe(0);
    expect(planOf(template('fox')).fur).toBe(partLibrary.get('dense_fur')!.fur);
    expect(planOf({ ...template('cat'), shape: { fur: 0.5 } }).fur).toBe(0.5);
    expect(planOf({ ...template('cat'), shape: { fur: 9 } }).fur).toBe(viabilityRules.shape.furMax.value);
    expect(planOf(template('dotterel')).fur).toBe(0);
  });
});
