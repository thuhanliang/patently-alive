import { describe, expect, it } from 'vitest';
import cat from '../art/incoming/lovart/paper/cuts/P11-cat/vector.json';
import { earShape, fitEar, type EarLook, type EarModel } from '../src/render/puppet/ear';

// 耳朵的形状（ear.ts）：按参数剪出来的一片纸。任何参数组合都要是一只规整的耳，每个滑块只管一件事。
type Part = { id: string; angle: number; lapR: number; outline: number[]; stripe: number[][]; pale: number[][] };
const parts = (cat as unknown as { parts: Part[] }).parts;
const ears = ['nearEar', 'farEar'].map((id) => parts.find((p) => p.id === id)!);
const model = (ear: Part): EarModel => fitEar(ear.outline, ear.lapR * 0.6);
const look = (ear: Part, o: Partial<EarLook> = {}): EarLook => ({ lenK: 1, wide: 1, round: 0, stiff: 1, frame: ear.angle, ...o });

const pts = (poly: number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i += 2) out.push([poly[i]!, poly[i + 1]!]);
  return out;
};
/** 写在 (中线, 中线的法线) 底下：u 沿中线，v 离中线。 */
const uv = (m: EarModel, q: [number, number]): [number, number] => [q[0] * m.ax[0] + q[1] * m.ax[1], -q[0] * m.ax[1] + q[1] * m.ax[0]];
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
      if (cross(p, q, a) * cross(p, q, b) < 0 && cross(a, b, p) * cross(a, b, q) < 0) c++;
    }
  }
  return c;
};
/** 轮廓在 u 处的宽（和 u 那条横线的交点之间）。 */
const widthAt = (m: EarModel, poly: [number, number][], u: number): number => {
  const vs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [ua, va] = uv(m, poly[i]!);
    const [ub, vb] = uv(m, poly[(i + 1) % poly.length]!);
    if (ua === ub || (ua - u) * (ub - u) > 0) continue;
    vs.push(va + ((vb - va) * (u - ua)) / (ub - ua));
  }
  return vs.length >= 2 ? Math.max(...vs) - Math.min(...vs) : 0;
};

describe('耳朵：按参数剪出来的一片纸', () => {
  it('从原画读出来的数合理', () => {
    for (const ear of ears) {
      const m = model(ear);
      expect(m.len).toBeGreaterThan(30);
      expect(m.base).toBeGreaterThan(0);
      expect(m.R).toBeGreaterThan(5);
      expect(m.R).toBeLessThan(m.len);
    }
  });

  it('原样参数：耳尖、耳长、露出头那里的宽都和原画一样', () => {
    for (const ear of ears) {
      const m = model(ear);
      const { shape, hinge, sink } = earShape(m, look(ear));
      expect(hinge).toBe(0);
      expect(sink).toBe(0);
      const o = pts(shape.outline);
      const reach = Math.max(...o.map((q) => uv(m, q)[0]));
      expect(reach).toBeCloseTo(m.len, 0);
      const wArt = widthAt(m, pts(ear.outline), m.base);
      expect(widthAt(m, o, m.base) / wArt).toBeGreaterThan(0.97);
      expect(widthAt(m, o, m.base) / wArt).toBeLessThan(1.03);
    }
  });

  it('任何组合都是一只规整的耳：轮廓不自己穿过自己', () => {
    for (const ear of ears) {
      const m = model(ear);
      for (const lenK of [0.3, 1, 1.8, 3])
        for (const wide of [0.5, 1, 2])
          for (const round of [-1, -0.5, 0, 0.5, 1])
            for (const stiff of [1, 0.75, 0.6, 0.5, 0.25, 0]) {
              const { shape } = earShape(m, look(ear, { lenK, wide, round, stiff }));
              expect(selfCrossings(pts(shape.outline)), `${ear.id} len ${lenK} wide ${wide} round ${round} stiff ${stiff}`).toBe(0);
            }
    }
  });

  it('耳根是以铆钉为圆心的半圆：整片怎么转、怎么折，耳根都不变形', () => {
    for (const ear of ears) {
      const m = model(ear);
      for (const stiff of [1, 0.75, 0])
        for (const wide of [0.5, 2]) {
          const { shape } = earShape(m, look(ear, { stiff, wide }));
          const back = pts(shape.outline).filter((q) => uv(m, q)[0] < -1e-6);
          expect(back.length).toBeGreaterThan(5);
          for (const q of back) expect(Math.hypot(q[0], q[1])).toBeCloseTo(m.R * wide, 6);
        }
    }
  });

  it('立着的耳从耳根到耳尖越来越窄（没有鼓包、没有缺口）', () => {
    for (const ear of ears) {
      const m = model(ear);
      for (const round of [-1, 0, 1])
        for (const lenK of [0.5, 1, 3]) {
          const o = pts(earShape(m, look(ear, { round, lenK })).shape.outline);
          const L = m.base + (m.len - m.base) * lenK;
          let last = Infinity;
          for (let k = 1; k < 20; k++) {
            const wk = widthAt(m, o, (L * k) / 20);
            expect(wk, `${ear.id} round ${round} len ${lenK} at ${k}/20`).toBeLessThanOrEqual(last + 1e-6);
            last = wk;
          }
        }
    }
  });

  it('耳长只管露出头的那一截，耳宽只管耳根的宽', () => {
    const ear = ears[0]!;
    const m = model(ear);
    const reach = (o: Partial<EarLook>): number => Math.max(...pts(earShape(m, look(ear, o)).shape.outline).map((q) => uv(m, q)[0]));
    expect((reach({ lenK: 2 }) - m.base) / (reach({}) - m.base)).toBeCloseTo(2, 1);
    expect(reach({ wide: 2 })).toBeCloseTo(reach({}), 6);
    const rootW = (wide: number): number => widthAt(m, pts(earShape(m, look(ear, { wide })).shape.outline), 0);
    expect(rootW(2) / rootW(1)).toBeCloseTo(2, 2);
  });

  it('圆尖只管耳尖：耳根一样宽，圆耳靠近耳尖的地方比尖耳宽得多', () => {
    for (const ear of ears) {
      const m = model(ear);
      const o = (round: number): [number, number][] => pts(earShape(m, look(ear, { round })).shape.outline);
      expect(widthAt(m, o(1), 0)).toBeCloseTo(widthAt(m, o(-1), 0), 6);
      const at = m.len * 0.85;
      expect(widthAt(m, o(1), at)).toBeGreaterThan(widthAt(m, o(-1), at) * 2);
      expect(widthAt(m, o(0.5), at)).toBeGreaterThan(widthAt(m, o(-0.5), at));
    }
  });

  it('最软的耳整片垂下：耳尖朝下，没有一点高过耳根的圆（不翘在头顶上）', () => {
    for (const ear of ears) {
      const m = model(ear);
      for (const lenK of [1, 1.8, 3]) {
        const { shape, hinge, sink } = earShape(m, look(ear, { stiff: 0, lenK }));
        expect(sink).toBeCloseTo(m.R, 6);
        // 画面里（零件转 frame + hinge，y 朝下）。
        const a = ear.angle + hinge;
        const screen = pts(shape.outline).map(([x, y]): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
        const far = screen.reduce((b, q) => (Math.hypot(q[0], q[1]) > Math.hypot(b[0], b[1]) ? q : b));
        const deg = (Math.atan2(far[1], far[0]) * 180) / Math.PI;
        expect(deg, `${ear.id} len ${lenK}`).toBeGreaterThan(60);
        expect(deg, `${ear.id} len ${lenK}`).toBeLessThan(120);
        for (const q of screen) expect(q[1]).toBeGreaterThan(-m.R - 1e-6);
      }
    }
  });

  it('半软的耳只把耳尖往前弯，整片还立着', () => {
    for (const ear of ears) {
      const m = model(ear);
      const straight = earShape(m, look(ear, { lenK: 1.8 }));
      const semi = earShape(m, look(ear, { lenK: 1.8, stiff: 0.75 }));
      expect(Math.abs(semi.hinge)).toBeLessThan(0.05);
      const tip = (o: number[]): [number, number] => pts(o).reduce((b, q) => (uv(m, q)[0] > uv(m, b)[0] ? q : b));
      // 往前 = 法线的 + 侧（耳朝上时是脸那边）。
      expect(uv(m, tip(semi.shape.outline))[1]).toBeGreaterThan(uv(m, tip(straight.shape.outline))[1] + 5);
    }
  });
});
