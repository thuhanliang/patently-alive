import { describe, expect, it } from 'vitest';
import { detExp, detLog, detPow, powInt } from '../src/sim/detmath';

function relErr(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : Math.abs(a - b) / Math.abs(b);
}

describe('确定的数学函数', () => {
  const xs = [1e-300, 3e-10, 0.001, 0.03, 0.25, 0.5, 0.7071, 1, 1.0000001, 1.6, 2, Math.E, 10, 123.456, 1e10, 1e300];

  it('log 与 Math.log 相差在 1e-14 以内', () => {
    for (const x of xs) {
      const got = detLog(x);
      const want = Math.log(x);
      expect(Math.abs(got - want) <= 1e-14 * Math.max(1, Math.abs(want)), `log(${x})`).toBe(true);
    }
    expect(detLog(0)).toBe(-Infinity);
    expect(Number.isNaN(detLog(-1))).toBe(true);
    expect(detLog(5e-324)).toBeCloseTo(Math.log(5e-324), 10);
  });

  it('exp 与 Math.exp 相差在 1e-14 以内', () => {
    for (const x of [-700, -50, -1, -0.5, -1e-9, 0, 1e-9, 0.3, 1, 2.5, 20, 300, 709]) {
      expect(relErr(detExp(x), Math.exp(x)), `exp(${x})`).toBeLessThan(1e-14);
    }
    expect(detExp(1000)).toBe(Infinity);
    expect(detExp(-1000)).toBe(0);
  });

  it('pow 与 Math.pow 相差在 1e-13 以内', () => {
    for (const [a, b] of [[0.03, 0.75], [1.6, 0.75], [0.25, -0.25], [0.45, 1 / 360], [10, 3], [2, 0.5]] as const) {
      expect(relErr(detPow(a, b), Math.pow(a, b)), `pow(${a}, ${b})`).toBeLessThan(1e-13);
    }
    expect(detPow(0, 2)).toBe(0);
    expect(detPow(5, 0)).toBe(1);
  });

  it('整数次幂精确', () => {
    expect(powInt(0.5, 10)).toBe(1 / 1024);
    expect(powInt(3, 0)).toBe(1);
    expect(powInt(1.1, 7)).toBeCloseTo(Math.pow(1.1, 7), 14);
  });

  it('参考输出固定不变（改了实现会让旧存档和回放失效）', () => {
    expect([detLog(0.03), detExp(0.75), detPow(1.6, 0.75)]).toMatchInlineSnapshot(`
      [
        -3.506557897319982,
        2.117000016612675,
        1.4226235280311386,
      ]
    `);
  });
});
