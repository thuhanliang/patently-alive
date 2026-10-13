/**
 * 确定的数学函数：exp、log、pow。
 *
 * Math.exp / Math.log / Math.pow 的最后一位在不同引擎上可能不同，会破坏"同种子同结果"。
 * 这里只用加减乘除和 IEEE 754 位操作实现，任何引擎上结果都逐位相同；
 * 精度与 Math 的版本相差在 1e-14 量级（测试里对照）。
 */

const LN2 = 0.6931471805599453;
// ln2 拆成高低两部分（取自 fdlibm）：k·LN2_HI 是精确的，大 k 时误差不会被放大。
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const SQRT2 = 1.4142135623730951;

// 用 DataView 拆装 64 位浮点数，大端读写，和宿主字节序无关。
const view = new DataView(new ArrayBuffer(8));

/** 2^k（k 为整数），在正规数范围外分别返回 0 或 Infinity。 */
function pow2(k: number): number {
  if (k > 1023) return Infinity;
  if (k < -1022) return 0;
  view.setUint32(0, (k + 1023) << 20);
  view.setUint32(4, 0);
  return view.getFloat64(0);
}

export function detLog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;

  // 把 x 拆成 m · 2^e，m ∈ [1, 2)。次正规数先放大。
  let e = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54
    e = -54;
  }
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  e += ((hi >>> 20) & 0x7ff) - 1023;
  view.setUint32(0, (hi & 0x800fffff) | 0x3ff00000);
  let m = view.getFloat64(0);
  // 收到 [√½, √2)，级数收敛更快。
  if (m > SQRT2) {
    m /= 2;
    e += 1;
  }

  // log m = 2 · atanh(s) = 2 · (s + s³/3 + s⁵/5 + …)，s = (m − 1)/(m + 1)，|s| ≤ 0.172
  const s = (m - 1) / (m + 1);
  const s2 = s * s;
  let term = s;
  let sum = s;
  for (let k = 3; k <= 31; k += 2) {
    term *= s2;
    sum += term / k;
  }
  return e * LN2_HI + (e * LN2_LO + 2 * sum);
}

export function detExp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;

  // x = k·ln2 + r，|r| ≤ ln2/2；e^x = 2^k · e^r。
  const k = Math.round(x / LN2);
  const r = x - k * LN2_HI - k * LN2_LO;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 20; i++) {
    term *= r / i;
    sum += term;
  }
  // 分两步乘 2^k，避免 k 接近边界时 pow2 溢出或下溢。
  const k1 = Math.trunc(k / 2);
  return sum * pow2(k1) * pow2(k - k1);
}

/** a^b，要求 a > 0（a = 0 时返回 0 或 1）。 */
export function detPow(a: number, b: number): number {
  if (b === 0) return 1;
  if (a === 0) return b > 0 ? 0 : Infinity;
  if (a < 0) return NaN;
  return detExp(b * detLog(a));
}

/** 整数次幂 q^n（n ≥ 0），用平方求幂，只有乘法。 */
export function powInt(q: number, n: number): number {
  let result = 1;
  let base = q;
  let k = n;
  while (k > 0) {
    if (k & 1) result *= base;
    base *= base;
    k = Math.floor(k / 2);
  }
  return result;
}
