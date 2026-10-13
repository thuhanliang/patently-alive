import type { Rng } from './rng';

/**
 * 两个八度的值噪声，输出在 [0, 1]。只用加减乘除，确定。
 * 格点上的随机值来自 rng，所以同一个种子得到同一张肥力图。
 */
export function valueNoise(width: number, height: number, patchSize: number, rng: Rng): Float64Array {
  const out = new Float64Array(width * height);
  const octaves: Array<[number, number]> = [
    [patchSize, 0.65],
    [Math.max(2, Math.floor(patchSize / 3)), 0.35],
  ];
  for (const [scale, weight] of octaves) {
    const lw = Math.floor(width / scale) + 2;
    const lh = Math.floor(height / scale) + 2;
    const lattice = new Float64Array(lw * lh);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.nextFloat();
    for (let y = 0; y < height; y++) {
      const gy = y / scale;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      for (let x = 0; x < width; x++) {
        const gx = x / scale;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const a = lattice[y0 * lw + x0]!;
        const b = lattice[y0 * lw + x0 + 1]!;
        const c = lattice[(y0 + 1) * lw + x0]!;
        const d = lattice[(y0 + 1) * lw + x0 + 1]!;
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        out[y * width + x] = out[y * width + x]! + weight * (top + (bottom - top) * ty);
      }
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
