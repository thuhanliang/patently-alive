import { describe, expect, it } from 'vitest';
import { boneWarp, mapPoly, regionStretch } from '../src/render/puppet/fit';

// 零件贴骨头（DECISIONS"纸偶的部件抽象"）：关节的圆头不变形、骨头末端落到新的长度上。
describe('零件贴骨头', () => {
  const bone = { end: [100, 0] as [number, number], rA: 20, rB: 15 };

  it('骨头末端落在新的长度上，方向不变', () => {
    for (const [w, len] of [
      [1, 100],
      [1, 140],
      [1, 70],
      [1.5, 120],
      [0.6, 90],
    ] as const) {
      const f = boneWarp(bone, w, len);
      const [x, y] = f(100, 0);
      expect(x).toBeCloseTo(len, 6);
      expect(y).toBeCloseTo(0, 6);
    }
  });

  it('不变形时原样不动', () => {
    const f = boneWarp(bone, 1, 100);
    for (const p of [
      [0, 0],
      [50, 12],
      [-10, -8],
      [110, 5],
    ] as const) {
      const [x, y] = f(p[0], p[1]);
      expect(x).toBeCloseTo(p[0], 9);
      expect(y).toBeCloseTo(p[1], 9);
    }
  });

  it('两头的圆头只整体缩放、平移，不被拉成椭圆', () => {
    const w = 1.3;
    const f = boneWarp(bone, w, 160);
    // 转轴这头：圆头上的点只按 w 缩放。
    const circleA = [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i) * 10, Math.sin(i) * 10] as const);
    for (const [x, y] of circleA) {
      const [X, Y] = f(x, y);
      expect(Math.hypot(X, Y)).toBeCloseTo(10 * w, 6);
    }
    // 末端这头：圆头上的点到新的末端的距离也只按 w 缩放。
    for (const [dx, dy] of circleA.map(([x, y]) => [x * 0.9, y * 0.9] as const)) {
      if (dx < -6) continue; // 末端圆头往回的那一侧落在杆上，会被拉
      const [X, Y] = f(100 + dx, dy);
      expect(Math.hypot(X - 160, Y)).toBeCloseTo(Math.hypot(dx, dy) * w, 6);
    }
  });

  it('压得太短时整片沿骨头压，末端仍然落在新的长度上', () => {
    const f = boneWarp(bone, 1, 30);
    expect(f(100, 0)[0]).toBeCloseTo(30, 6);
    // 顺序不乱：沿骨头单调。
    const xs = [0, 10, 30, 50, 70, 90, 100].map((x) => f(x, 0)[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it('斜的骨头也一样', () => {
    const f = boneWarp({ end: [60, 80], rA: 10, rB: 10 }, 1, 150);
    const [x, y] = f(60, 80);
    expect(x).toBeCloseTo(90, 6);
    expect(y).toBeCloseTo(120, 6);
  });

  it('拉一段：起点之前不动，之后沿方向拉长', () => {
    const f = regionStretch([10, 0], [1, 0], 2);
    expect(f(5, 3)).toEqual([5, 3]);
    const [x, y] = f(30, 0);
    expect(x).toBeCloseTo(50, 9);
    expect(y).toBeCloseTo(0, 9);
    expect(mapPoly([0, 0, 30, 0], f)).toEqual([0, 0, 50, 0]);
  });
});
