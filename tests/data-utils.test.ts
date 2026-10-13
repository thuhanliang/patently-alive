import { describe, expect, it } from 'vitest';
import { checksum, cloneData, deserialize, serialize } from '../src/sim';

describe('状态数据工具', () => {
  const sample = () => ({
    b: [1, 2.5, -3],
    a: { f: Float64Array.from([0.1, 0.2, 1e-300]), i: Int32Array.from([-7, 8]), u: Uint8Array.from([255]) },
    s: '草',
    t: true,
    n: null,
  });

  it('序列化往返不丢信息，类型化数组保持原类型', () => {
    const back = deserialize<ReturnType<typeof sample>>(serialize(sample()));
    expect(back.a.f).toBeInstanceOf(Float64Array);
    expect(back.a.i).toBeInstanceOf(Int32Array);
    expect(back.a.u).toBeInstanceOf(Uint8Array);
    expect(Array.from(back.a.f)).toEqual([0.1, 0.2, 1e-300]);
    expect(checksum(back)).toBe(checksum(sample()));
  });

  it('深拷贝互不影响', () => {
    const a = sample();
    const b = cloneData(a);
    b.a.f[0] = 9;
    b.b[0] = 9;
    expect(a.a.f[0]).toBe(0.1);
    expect(a.b[0]).toBe(1);
  });

  it('校验和与键的顺序无关，但对数值逐位敏感', () => {
    expect(checksum({ x: 1, y: 2 })).toBe(checksum({ y: 2, x: 1 }));
    expect(checksum({ x: 0.1 + 0.2 })).not.toBe(checksum({ x: 0.3 }));
    expect(checksum([1, 2])).not.toBe(checksum(Float64Array.from([1, 2])));
  });

  it('拒绝非有限数', () => {
    expect(() => checksum({ x: Number.NaN })).toThrow(RangeError);
    expect(() => serialize({ x: Infinity })).toThrow(RangeError);
  });
});
