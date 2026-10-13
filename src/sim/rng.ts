/**
 * 带种子的伪随机数发生器（SFC32，种子经 SplitMix32 展开）。
 *
 * 全程只用 32 位整数运算（|0、>>>、Math.imul），不依赖任何引擎实现细节，
 * 所以同一个种子在任何 JS 引擎上产生的序列都逐位相同。
 * 状态是 4 个 uint32，可以完整存进快照、原样恢复。
 *
 * 注意：换算法或改种子展开方式会让所有旧存档、旧回放失效，
 * tests/rng.test.ts 里固定了一组参考输出，改了就会红。
 */

export type RngState = readonly [number, number, number, number];

const UINT32_RANGE = 0x1_0000_0000;

/** 种子只接受 [0, 2^32) 的整数，避免不同的输入被悄悄截断成同一个种子。 */
export function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    throw new RangeError(`种子必须是 [0, 2^32) 的整数，收到 ${seed}`);
  }
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(a: number, b: number, c: number, d: number) {
    this.a = a | 0;
    this.b = b | 0;
    this.c = c | 0;
    this.d = d | 0;
  }

  static fromSeed(seed: number): Rng {
    assertSeed(seed);
    let x = seed | 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) | 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) | 0;
    };
    const rng = new Rng(next(), next(), next(), 1);
    // 丢掉开头几个输出，让相邻种子的序列充分分开。
    for (let i = 0; i < 12; i++) rng.nextU32();
    return rng;
  }

  static fromState(state: RngState): Rng {
    return new Rng(state[0], state[1], state[2], state[3]);
  }

  state(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** [0, 2^32) 的整数。 */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1) 的浮点数，32 位精度。 */
  nextFloat(): number {
    return this.nextU32() / UINT32_RANGE;
  }

  /** [0, n) 的整数，无偏（拒绝采样）。n 必须是 [1, 2^32] 的整数。 */
  nextInt(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
      throw new RangeError(`nextInt 的上界必须是 [1, 2^32] 的整数，收到 ${n}`);
    }
    const limit = UINT32_RANGE - (UINT32_RANGE % n);
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % n;
    }
  }

  /** 以概率 p 返回 true。 */
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }
}
