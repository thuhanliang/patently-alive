import { describe, expect, it } from 'vitest';
import cat from '../art/incoming/lovart/paper/cuts/P11-cat/vector.json';
import { earShape, fitEar, type EarLook } from '../src/render/puppet/ear';

// 耳朵的形状（ear.ts）：原画的耳读成参数、再按参数重画。任何参数组合都要是一只规整的耳。
type Part = { id: string; angle: number; lapR: number; outline: number[]; stripe: number[][]; pale: number[][] };
const parts = (cat as unknown as { parts: Part[] }).parts;
const ears = ['nearEar', 'farEar'].map((id) => parts.find((p) => p.id === id)!);
const look = (ear: Part, o: Partial<EarLook> = {}): EarLook => ({ lenK: 1, wide: 1, round: 0, stiff: 1, frame: ear.angle, ...o });

const pts = (poly: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i += 2) out.push([poly[i]!, poly[i + 1]!]);
  return out;
};
/** 点到多边形边界的最短距离。 */
const distTo = (q: [number, number], poly: [number, number][]): number => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
  }
  return best;
};
/** 多边形的边有没有互相穿过（不相邻的两条边相交）。 */
const selfCrossings = (poly: [number, number][]): number => {
  const n = poly.length;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  let c = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const p = poly[j]!;
      const q = poly[(j + 1) % n]!;
      const d1 = cross(p, q, a);
      const d2 = cross(p, q, b);
      const d3 = cross(a, b, p);
      const d4 = cross(a, b, q);
      if (d1 * d2 < 0 && d3 * d4 < 0) c++;
    }
  }
  return c;
};

describe('耳朵：原画读成参数、再按参数重画', () => {
  it('读出来的参数合理', () => {
    for (const ear of ears) {
      const m = fitEar(ear.outline, ear.lapR * 0.6);
      expect(m.len).toBeGreaterThan(30);
      for (const side of [m.pos, m.neg]) {
        expect(side.W).toBeGreaterThan(5);
        expect(side.n).toBeGreaterThanOrEqual(0.5);
        expect(side.n).toBeLessThanOrEqual(4);
      }
    }
  });

  it('参数取原画的值时，重画的轮廓贴着原画（差不过几个像素）', () => {
    for (const ear of ears) {
      const m = fitEar(ear.outline, ear.lapR * 0.6);
      const { shape, hinge } = earShape(m, ear, look(ear));
      expect(hinge).toBe(0);
      const orig = pts(ear.outline);
      for (const q of pts(shape.outline)) expect(distTo(q, orig)).toBeLessThan(ear.lapR * 0.35);
    }
  });

  it('任何组合都是一只规整的耳：轮廓不自己穿过自己', () => {
    for (const ear of ears) {
      const m = fitEar(ear.outline, ear.lapR * 0.6);
      for (const lenK of [0.3, 1, 1.8, 3])
        for (const wide of [0.5, 1, 2])
          for (const round of [-1, -0.5, 0, 0.5, 1])
            for (const stiff of [1, 0.75, 0.5, 0.25, 0]) {
              const { shape } = earShape(m, ear, look(ear, { lenK, wide, round, stiff }));
              expect(selfCrossings(pts(shape.outline)), `${ear.id} len ${lenK} wide ${wide} round ${round} stiff ${stiff}`).toBe(0);
            }
    }
  });

  it('耳长、耳宽按倍数变', () => {
    const ear = ears[0]!;
    const m = fitEar(ear.outline, ear.lapR * 0.6);
    const reachAlong = (lenK: number): number => {
      const { shape } = earShape(m, ear, look(ear, { lenK }));
      return Math.max(...pts(shape.outline).map((q) => (q[0] - m.origin[0]) * m.ax[0] + (q[1] - m.origin[1]) * m.ax[1]));
    };
    expect(reachAlong(2) / reachAlong(1)).toBeCloseTo(2, 1);
    const widthAt = (wide: number): number => {
      const { shape } = earShape(m, ear, look(ear, { wide }));
      const v = pts(shape.outline).map((q) => -(q[0] - m.origin[0]) * m.ax[1] + (q[1] - m.origin[1]) * m.ax[0]);
      return Math.max(...v) - Math.min(...v);
    };
    expect(widthAt(2) / widthAt(1)).toBeGreaterThan(1.7);
  });

  it('最圆、最尖时两侧对称；圆耳的"肩"比尖耳宽得多', () => {
    for (const ear of ears) {
      const m = fitEar(ear.outline, ear.lapR * 0.6);
      // 在耳根到耳尖的 s 处量两侧各多宽。
      const sides = (round: number, at: number): [number, number] => {
        const { shape } = earShape(m, ear, look(ear, { round }));
        let lo = 0;
        let hi = 0;
        for (const q of pts(shape.outline)) {
          const r: [number, number] = [q[0] - m.origin[0], q[1] - m.origin[1]];
          const s = (r[0] * m.ax[0] + r[1] * m.ax[1]) / m.len;
          if (Math.abs(s - at) > 0.04) continue;
          const v = -r[0] * m.ax[1] + r[1] * m.ax[0];
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        return [hi, -lo];
      };
      for (const round of [-1, 1]) {
        const [a, b] = sides(round, 0.5);
        expect(Math.abs(a - b) / (a + b), `${ear.id} round ${round}`).toBeLessThan(0.15);
      }
      const w = (round: number): number => sides(round, 0.8)[0] + sides(round, 0.8)[1];
      expect(w(1)).toBeGreaterThan(w(-1) * 1.6);
      expect(w(0.5)).toBeGreaterThan(w(-0.5));
    }
  });

  it('很软的耳整片垂下来，耳尖朝下；立着的耳不转', () => {
    for (const ear of ears) {
      const m = fitEar(ear.outline, ear.lapR * 0.6);
      expect(earShape(m, ear, look(ear, { stiff: 1 })).hinge).toBe(0);
      for (const lenK of [1.8, 2.6]) {
        const { shape, hinge } = earShape(m, ear, look(ear, { stiff: 0, lenK }));
        // 画面里（零件转 frame + hinge）离转轴最远的点在转轴下方。
        const a = ear.angle + hinge;
        const far = pts(shape.outline)
          .map(([x, y]): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)])
          .reduce((b, q) => (Math.hypot(q[0], q[1]) > Math.hypot(b[0], b[1]) ? q : b));
        const deg = (Math.atan2(far[1], far[0]) * 180) / Math.PI;
        expect(deg, `${ear.id} len ${lenK}`).toBeGreaterThan(70);
        expect(deg, `${ear.id} len ${lenK}`).toBeLessThan(140);
      }
    }
  });
});
