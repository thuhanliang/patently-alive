/**
 * 剪纸 demo 的确定性噪声：只用于画面（撕边、纸纹、装饰位置），不进推演。
 * 同一个种子、同一个坐标永远得到同一个值。
 */

/** 整数坐标的哈希，返回 [0, 1)。 */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 平滑的值噪声，返回 [0, 1)。 */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 三层叠加的分形噪声，返回约 [0, 1)。 */
export function fbm(x: number, y: number, seed: number): number {
  return (
    valueNoise(x, y, seed) * 0.57 +
    valueNoise(x * 2.03, y * 2.03, seed + 17) * 0.29 +
    valueNoise(x * 4.11, y * 4.11, seed + 31) * 0.14
  );
}
