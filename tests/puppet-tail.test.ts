import { describe, expect, it } from 'vitest';
import { TailChain } from '../src/render/puppet/tail';

// 尾巴的动力学（tail.ts）：静止时就是画的样子；身体一动，尾巴跟不上、一节晚一节；不炸、和帧率基本无关、确定。
const opts = { stiffness: 2, damping: 0.2 };
const make = () => new TailChain([0.06, 0.06, 0.06, 0.06, 0.06], [0.03, 0.025, 0.02, 0.016, 0.012], opts);
const rest = [3.6, 3.7, 3.8, 3.9, 4.0];

/** 尾根按 hipY(t) 上下动、身体角度 pitch(t)，跑 seconds 秒，返回每帧的偏差。 */
function run(dt: number, seconds: number, hip: (t: number) => number, pitch: (t: number) => number = () => 0): number[][] {
  const c = make();
  const out: number[][] = [];
  for (let t = 0; t <= seconds + 1e-9; t += dt) {
    c.step(dt, [0, hip(t)], rest.map((d) => d + pitch(t)));
    out.push([...c.dev]);
  }
  return out;
}

describe('尾巴的动力学', () => {
  it('不动就一直是画的样子（偏差正好是 0）', () => {
    const r = run(1 / 60, 2, () => 0.2);
    for (const d of r.at(-1)!) expect(d).toBe(0);
  });

  it('身体上下颠：尾巴甩起来，越往尾尖甩得越大', () => {
    const r = run(1 / 60, 3, (t) => 0.2 + 0.01 * Math.sin(2 * Math.PI * 2 * t));
    const amp = (i: number) => Math.max(...r.slice(60).map((d) => Math.abs(d.slice(0, i + 1).reduce((a, b) => a + b, 0))));
    expect(amp(0)).toBeGreaterThan(0.005);
    expect(amp(4)).toBeGreaterThan(amp(0));
    for (const d of r) expect(Math.abs(d.reduce((a, b) => a + b, 0))).toBeLessThan(1.4);
  });

  it('30 帧和 60 帧的结果接近', () => {
    const hip = (t: number) => 0.2 + 0.01 * Math.sin(2 * Math.PI * 1.5 * t);
    const a = run(1 / 30, 2, hip).at(-1)!;
    const b = run(1 / 60, 2, hip).at(-1)!;
    for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.03);
  });

  it('掉帧时身体猛地一抬（dt = 0.1）：不炸，慢慢回到 0', () => {
    const r = run(0.1, 6, () => 0.2, (t) => (t > 1 ? 0.6 : 0));
    for (const d of r) for (const x of d) expect(Number.isFinite(x)).toBe(true);
    for (const x of r.at(-1)!) expect(Math.abs(x)).toBeLessThan(0.01);
  });

  it('同样的输入，同样的结果', () => {
    const hip = (t: number) => 0.2 + 0.02 * Math.sin(7 * t);
    expect(run(1 / 50, 2, hip)).toEqual(run(1 / 50, 2, hip));
  });
});
