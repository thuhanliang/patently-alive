import { describe, expect, it } from 'vitest';
import { bend, boneWarp, densify, mapPoly, regionStretch } from '../src/render/puppet/fit';

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

// 弯折、加密（耳朵用，见 ear.ts）。
describe('弯折和加密', () => {
  const ax: [number, number] = [0, -1]; // 耳朝上（y 朝下）

  it('弯折：不弯时原样；折点以前不动；中线的长短不变', () => {
    const id = bend([0, -10], ax, 30, 0);
    expect(id(3, -50)).toEqual([3, -50]);
    const f = bend([0, -10], ax, 30, -2.5);
    expect(f(5, -4)).toEqual([5, -4]);
    // 中线上等距的点，弯过去以后仍然等距。
    const pts = [0, 10, 20, 30, 40, 50, 60].map((d) => f(0, -10 - d));
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1])).toBeCloseTo(10, 0);
    // 走完 len 以后，方向转过了 angle：最后一段朝着 axis 转 −2.5 弧度的方向。
    const d = [pts[6]![0] - pts[5]![0], pts[6]![1] - pts[5]![1]];
    const want = [Math.cos(-Math.PI / 2 - 2.5), Math.sin(-Math.PI / 2 - 2.5)];
    expect(d[0]! / 10).toBeCloseTo(want[0]!, 6);
    expect(d[1]! / 10).toBeCloseTo(want[1]!, 6);
  });

  it('弯折的内侧挤紧、不翻过去：半径比半宽小时，内侧的点也不越过圆心', () => {
    const len = 12;
    const angle = -2.4;
    const R = len / Math.abs(angle);
    const f = bend([0, 0], ax, len, angle);
    // 圆心：从起点沿法线（内侧）走 R。法线 n = rot(axis, +90°) = [1, 0]；angle < 0，内侧在 −n 一侧。
    const centre: [number, number] = [-R, 0];
    // 内侧的点（v < 0）不管离中线多远，弯过去以后都还在圆心外面。
    for (const v of [-1, -3, -6, -12, -50]) {
      const [X, Y] = f(v, -len);
      expect(Math.hypot(X - centre[0], Y - centre[1])).toBeGreaterThan(R * 0.05);
    }
    // 外侧照常：离圆心 R + v。
    const [Xo, Yo] = f(10, -len);
    expect(Math.hypot(Xo - centre[0], Yo - centre[1])).toBeCloseTo(R + 10, 6);
  });

  it('加密：形状不变，长边被等分', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    const d = densify(sq, 3);
    expect(d.length / 2).toBe(16);
    for (let i = 0; i < d.length; i += 2) expect(d[i]! === 0 || d[i]! === 10 || d[i + 1]! === 0 || d[i + 1]! === 10).toBe(true);
  });
});
