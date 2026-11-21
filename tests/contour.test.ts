import { describe, expect, it } from 'vitest';
import { isoLoops, regions, signedArea } from '../src/render/three/contour';

/** 圆盘、圆环的场：看环闭合、方向、洞的归属。 */
function field(n: number, f: (x: number, y: number) => number): { w: number; h: number; v: Float32Array } {
  const v = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v[y * n + x] = f(x, y);
  return { w: n, h: n, v };
}

describe('等高线', () => {
  it('圆盘是一个外边界（负面积），面积接近 πr²', () => {
    const f = field(40, (x, y) => 10 - Math.hypot(x - 20, y - 20));
    const loops = isoLoops(f, 0);
    expect(loops).toHaveLength(1);
    const a = signedArea(loops[0]!);
    expect(a).toBeLessThan(0);
    expect(-a).toBeGreaterThan(Math.PI * 100 * 0.95);
    expect(-a).toBeLessThan(Math.PI * 100 * 1.05);
  });

  it('圆环是一个外边界加一个洞', () => {
    const f = field(50, (x, y) => 5 - Math.abs(Math.hypot(x - 25, y - 25) - 14));
    const rs = regions(isoLoops(f, 0));
    expect(rs).toHaveLength(1);
    expect(rs[0]!.holes).toHaveLength(1);
  });

  it('碰到场的边界也闭合；鞍点不丢段', () => {
    const f = field(20, (x, y) => ((x + y) % 2 === 0 ? 1 : -1));
    const loops = isoLoops(f, 0);
    const pts = loops.reduce((s, l) => s + l.length / 2, 0);
    expect(pts).toBeGreaterThan(0);
    for (const l of loops) expect(l.length % 2).toBe(0);
    const all = field(10, () => 1);
    const edge = isoLoops(all, 0);
    expect(edge).toHaveLength(1);
    expect(signedArea(edge[0]!)).toBeLessThan(0);
  });
});
