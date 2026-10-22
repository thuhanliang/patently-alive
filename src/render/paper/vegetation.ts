import { Texture } from 'pixi.js';
import { imageOf, type Sheet } from './assets';
import type { LeafKit } from './leaves';
import { fbm, hash2 } from './noise';
import { bakeShrub, bakeTussock } from './plants';
import type { PaperScene } from './scene';
import { PX, SHRUB_EDGE, sample, terrainWarp, type Fields } from './terrain';

export interface VegetationInput {
  fields: Fields;
  /** 每格的草本、灌丛植被量（0–1）。 */
  herb: Float32Array;
  shrub: Float32Array;
  seed: number;
  /** 兔子的身长（剪纸像素）：草丛、灌丛、岩石的大小都按它定。 */
  rabbitLen: number;
  kit: LeafKit;
  P1: Sheet | null;
  P2: Sheet | null;
  P3: Sheet | null;
  /** 'lovart'：P1 草丛、P2 灌丛（和示意图同一套画）；'code'：代码画的（plants.ts）。 */
  art: 'lovart' | 'code';
  /** 地面贴片（草皮、卵石堆）直接画进这张地形图（平躺，跟着地面压扁）；画完由调用方更新贴图。 */
  base?: CanvasRenderingContext2D;
  /** 这里摆一株宽 pw、高 ph 的植物会不会挡住游戏信息；挡住的不摆。 */
  blocked?: (x: number, y: number, pw: number, ph: number) => boolean;
}

/**
 * 立起来的植被：草丛、灌丛，以及海岸的岩石、浅水的石头、海草、漂木和贝壳；地面贴片画进地形图。
 * 大小按兔子身长定（量自示意图：一丛草约和兔子一样长、比站着的兔子高一些；一团灌丛约是兔子的 1.2–1.8 倍）。
 * 位置只由种子和场决定，同一个种子摆法固定。返回代码画的植物贴图占的字节数。
 */
export function placeVegetation(scene: PaperScene, input: VegetationInput): number {
  const { fields, herb, shrub, seed, rabbitLen, kit, P1, P2, P3, art, base } = input;
  const { width: w, height: h } = fields;
  const W = w * PX;
  const H = h * PX;
  const blocked = input.blocked ?? ((): boolean => false);
  let bytes = 0;
  const choose = <T,>(list: T[], r: number): T => list[Math.floor(r * list.length) % list.length]!;
  const fromCanvas = (c: HTMLCanvasElement): Texture => {
    bytes += c.width * c.height * 4;
    return Texture.from(c);
  };
  // 植物的样子：默认用 Lovart 的 P1 草丛、P2 灌丛（和示意图同一套画）；?plants=code 换成代码画的（plants.ts）。
  const LV = [0.15, 0.4, 0.7, 1];
  const level = (x: number): number => LV.reduce((best, l, i) => (Math.abs(l - x) < Math.abs(LV[best]! - x) ? i : best), 0);
  const lovart = art === 'lovart' && P1 && P2;
  const code = lovart
    ? null
    : {
        tussocks: LV.map((b, bi) => [0, 0.5, 1].map((d, di) => Array.from({ length: 3 }, (_, v) => fromCanvas(bakeTussock(b, d, seed * 97 + bi * 31 + di * 7 + v, 160))))),
        flowers: Array.from({ length: 3 }, (_, v) => fromCanvas(bakeTussock(0.8, 0, seed * 71 + v, 160, kit, true))),
        shrubs: LV.map((a, ai) => Array.from({ length: 4 }, (_, v) => fromCanvas(bakeShrub(kit, a, seed * 89 + ai * 13 + v, 200)))),
      };
  /** 草丛：植被量高用 P1 前两行，中等混进偏黄的几株，低的用被啃过的第 5 行。 */
  const tussockTex = (b: number, dry: number, r: number): Texture =>
    code
      ? choose(code.tussocks[level(b)]![Math.round(dry * 2)]!, r)
      : b > 0.5
        ? choose([...P1!.tex[0]!.slice(0, 5), ...P1!.tex[1]!.slice(0, 4), P1!.tex[1]![5]!], r)
        : b > 0.25
          ? choose([P1!.tex[0]![5]!, P1!.tex[1]![4]!, P1!.tex[0]![3]!, P1!.tex[1]![1]!], r)
          : choose(P1!.tex[4]!, r);
  const flowerTex = (r: number): Texture => (code ? choose(code.flowers, r) : choose(P1!.tex[3]!, r));
  /** 灌丛：茂盛的只用 P2 前三行里圆而密的那些（示意图里是一团团深绿），稀疏的用第 5 行，枯的用第 6 行。 */
  const lushShrubs = P2 ? ([[0, 0], [0, 1], [0, 3], [0, 4], [0, 5], [1, 0], [1, 2], [1, 4], [2, 0], [2, 2], [2, 3], [2, 5]] as const).map(([r, c]) => P2.tex[r]![c]!) : [];
  const shrubTex = (a: number, r: number): Texture =>
    code ? choose(code.shrubs[level(a)]!, r) : a > 0.45 ? choose(lushShrubs, r) : a > 0.2 ? choose(P2!.tex[4]!, r) : choose(P2!.tex[5]!, r);
  const aspect = (t: Texture): number => t.height / t.width;

  // 同一张灌丛场（和地形绘制同样的扭曲）同时决定树冠下的暗地面和灌丛摆在哪：轮廓只有一套。
  const field = (f: Float32Array, px: number, py: number): number =>
    sample(f, w, h, (px + 0.5) / PX - 0.5, (py + 0.5) / PX - 0.5) + terrainWarp(px, py, seed) * (f === fields.sd ? 1 : 0.12);
  const cellOf = (px: number, py: number): number => Math.min(h - 1, Math.max(0, Math.floor(py / PX))) * w + Math.min(w - 1, Math.max(0, Math.floor(px / PX)));
  const rr = (gx: number, gy: number, k: number): number => hash2(gx * 5 + k, gy * 3 - k, seed + 2000);
  /** 在网格加抖动的点上摆东西：f 返回 null 表示这里不摆。 */
  const scatter = (stepCells: number, k: number, f: (x: number, y: number, gx: number, gy: number) => void): void => {
    const st = PX * stepCells;
    for (let gy = 0; gy * st < H; gy++)
      for (let gx = 0; gx * st < W; gx++) f((gx + rr(gx, gy, k)) * st, (gy + rr(gx, gy, k + 1)) * st, gx, gy);
  };

  // 地面贴片：P1 第 3 行的草皮平铺在草地上、P3 第 3 行的卵石堆铺在海滩上，直接画进地形图（平躺，跟着地面压扁）。
  if (lovart && P3 && base) {
    const g = base;
    scatter(2.2, 40, (x, y, gx, gy) => {
      const sd = field(fields.sd, x, y);
      if (sd < 0.3) return;
      const gr = field(fields.grass, x, y);
      const t = gr > 0.6 ? choose(P1!.tex[2]!, rr(gx, gy, 42)) : gr < 0.4 && rr(gx, gy, 43) < 0.45 ? choose(P3.tex[2]!, rr(gx, gy, 42)) : null;
      if (!t || rr(gx, gy, 44) > (gr > 0.6 ? 0.5 : 1)) return;
      const size = rabbitLen * (gr > 0.6 ? 0.55 + 0.35 * rr(gx, gy, 45) : 0.3 + 0.15 * rr(gx, gy, 45));
      const under = field(fields.shrubLand, x, y) > SHRUB_EDGE;
      g.save();
      g.globalAlpha = 0.75;
      if (under) g.filter = 'brightness(0.72)';
      g.drawImage(imageOf(t), x - size / 2, y - (size * aspect(t)) / 2, size, size * aspect(t));
      g.restore();
    });
  }

  // 灌丛：树冠的视觉中心（脚往上约 0.4 个高度）落在灌丛场里才摆，密密地叠成一整片。
  /** 灌丛植被量：取树冠中心附近 3×3 格里灌丛格的最大值（脚可能落在灌丛外的草地格上）。 */
  const shrubAt = (px: number, py: number): number => {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, shrub[cellOf(px + dx * PX, py + dy * PX)]!);
    return m;
  };
  scatter(lovart ? 1.3 : 1.6, 1, (x, y, gx, gy) => {
    const size = rabbitLen * (lovart ? 1.1 + 0.6 * rr(gx, gy, 3) : 1.3 + 0.7 * rr(gx, gy, 3));
    const yc = y - size * 0.3;
    if (field(fields.shrubLand, x, yc) < SHRUB_EDGE) return;
    const t = shrubTex(shrubAt(x, yc), rr(gx, gy, 4));
    const ph = size * aspect(t);
    if (blocked(x, y, size, ph)) return;
    // Lovart 的灌丛压暗一些，叠成示意图里那种深绿的一团；每丛明暗略有不同。
    scene.stick(t, x, y, size, rr(gx, gy, 5) < 0.5, 0, (lovart ? 0.64 : 0.88) + 0.14 * rr(gx, gy, 6));
  });
  // 草丛：成片长（低频噪声），离灌丛留一点空。
  scatter(2.2, 11, (x, y, gx, gy) => {
    const size = rabbitLen * (0.95 + 0.45 * rr(gx, gy, 13));
    const yc = y - size * 0.45;
    if (field(fields.grass, x, yc) < 0.62 || field(fields.shrubLand, x, yc) > SHRUB_EDGE - 0.12) return;
    const b = herb[cellOf(x, yc)]!;
    const clump = Math.min(1, Math.max(0, (fbm(x / (PX * 7), y / (PX * 7), seed + 77) - 0.4) / 0.25));
    if (rr(gx, gy, 14) > clump * 0.6 * (0.3 + 0.7 * b)) return;
    const flower = b > 0.5 && rr(gx, gy, 15) < 0.1;
    const t = flower ? flowerTex(rr(gx, gy, 16)) : tussockTex(b, Math.min(1, Math.max(0, (0.65 - b) / 0.5)), rr(gx, gy, 16));
    const sz = flower ? size * 0.75 : size;
    if (blocked(x, y, sz, sz * aspect(t))) return;
    scene.stick(t, x, y, sz, rr(gx, gy, 17) < 0.5, 0, 0.92 + 0.08 * rr(gx, gy, 18));
  });

  // 海岸：岩石成堆地长在水边（低频噪声决定哪里是岩岸），浅水里半没的石头，深一点的水里金色的海草，沙滩上零星的漂木和贝壳。
  if (P3)
    scatter(1.3, 21, (x, y, gx, gy) => {
      const sd = field(fields.sd, x, y);
      const r = rr(gx, gy, 23);
      const outcrop = fbm(x / (PX * 6), y / (PX * 6), seed + 303);
      let t: Texture | null = null;
      let size = 0;
      let shade = 1;
      if (sd > -0.6 && sd < 1.2 && outcrop > 0.46 && r < 0.75) {
        t = choose(field(fields.grass, x, y) > 0.5 && r < 0.3 ? P3.tex[3]! : [...P3.tex[0]!, ...P3.tex[1]!], rr(gx, gy, 24));
        size = rabbitLen * (0.8 + 0.9 * rr(gx, gy, 25));
      } else if (sd > -8 && sd < -3 && r < 0.02) {
        t = choose([P3.tex[5]![5]!, P3.tex[4]![1]!, P3.tex[4]![4]!], rr(gx, gy, 24));
        size = rabbitLen * (0.7 + 0.5 * rr(gx, gy, 25));
        shade = 0.95;
      } else if (sd > 0.1 && sd < 0.9 && field(fields.grass, x, y) < 0.4 && r < 0.02) {
        t = choose([P3.tex[4]![0]!, P3.tex[4]![2]!, P3.tex[4]![3]!, P3.tex[4]![5]!], rr(gx, gy, 24));
        size = rabbitLen * 0.45;
      }
      if (!t || blocked(x, y, size, size * aspect(t))) return;
      scene.stick(t, x, y, size, rr(gx, gy, 26) < 0.5, 0, shade);
    });
  return bytes;
}
