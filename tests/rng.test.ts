import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim';

describe('Rng', () => {
  it('同一个种子产生同一个序列', () => {
    const a = Rng.fromSeed(12345);
    const b = Rng.fromSeed(12345);
    for (let i = 0; i < 10_000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('不同种子产生不同序列', () => {
    const a = Rng.fromSeed(1);
    const b = Rng.fromSeed(2);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    expect(sa).not.toEqual(sb);
  });

  it('参考输出固定不变（改了算法会让旧存档和回放失效）', () => {
    const r = Rng.fromSeed(42);
    expect(Array.from({ length: 6 }, () => r.nextU32())).toMatchInlineSnapshot(`
      [
        2476999517,
        2284424721,
        914527439,
        3398404915,
        1005869237,
        3374281156,
      ]
    `);
    const z = Rng.fromSeed(0);
    expect(Array.from({ length: 3 }, () => z.nextU32())).toMatchInlineSnapshot(`
      [
        591558436,
        2737234123,
        107644106,
      ]
    `);
  });

  it('状态可以存下来原样恢复', () => {
    const a = Rng.fromSeed(7);
    for (let i = 0; i < 100; i++) a.nextU32();
    const b = Rng.fromState(a.state());
    for (let i = 0; i < 1000; i++) expect(b.nextU32()).toBe(a.nextU32());
  });

  it('nextFloat 落在 [0, 1)', () => {
    const r = Rng.fromSeed(3);
    for (let i = 0; i < 10_000; i++) {
      const x = r.nextFloat();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('nextInt 落在 [0, n) 且大致均匀', () => {
    const r = Rng.fromSeed(9);
    const n = 6;
    const counts = new Array<number>(n).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) {
      const k = r.nextInt(n);
      expect(Number.isInteger(k) && k >= 0 && k < n).toBe(true);
      counts[k]! += 1;
    }
    for (const c of counts) expect(Math.abs(c - draws / n)).toBeLessThan(draws / n / 10);
  });

  it('拒绝不合法的种子和上界', () => {
    expect(() => Rng.fromSeed(-1)).toThrow(RangeError);
    expect(() => Rng.fromSeed(1.5)).toThrow(RangeError);
    expect(() => Rng.fromSeed(2 ** 32)).toThrow(RangeError);
    expect(() => Rng.fromSeed(0).nextInt(0)).toThrow(RangeError);
  });
});
