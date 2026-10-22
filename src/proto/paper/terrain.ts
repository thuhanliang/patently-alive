import { TERRAIN } from '../../sim/terrain';
import { fbm, valueNoise } from './noise';

/**
 * 剪纸地形：从推演的格子算出几张连续的场（离岸距离、草地、灌丛、植被量），
 * 再逐像素画成一层层带白色撕边和投影的纸片。只读推演数据，只用于画面。
 */

/** 每格多少像素。 */
export const PX = 16;

export interface TerrainInput {
  width: number;
  height: number;
  terrain: Uint8Array;
  /** 每格草本生物量占上限的比例（0–1）。 */
  herb: Float32Array;
  /** 每格灌丛生物量占上限的比例（0–1），非灌丛格为 0。 */
  shrub: Float32Array;
}

export interface Fields {
  width: number;
  height: number;
  /** 离海岸线的有符号距离（格）：陆地为正，水为负。 */
  sd: Float32Array;
  /** 草地（含灌丛）指示场，平滑过，0–1。 */
  grass: Float32Array;
  /** 灌丛指示场，平滑过，0–1。 */
  shrubLand: Float32Array;
  herb: Float32Array;
  shrub: Float32Array;
}

/** 一张可以平铺的纸：RGB，宽高相同。 */
export interface PaperTex {
  size: number;
  rgb: Float32Array;
}

export interface Palette {
  deep: PaperTex;
  mid: PaperTex;
  shallow: PaperTex;
  foam: PaperTex;
  beach: PaperTex;
  grass: PaperTex;
  dry: PaperTex;
  shrub: PaperTex;
  rim: PaperTex;
}

export function buildFields(input: TerrainInput): Fields {
  const { width: w, height: h, terrain } = input;
  const n = w * h;
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = terrain[i] === TERRAIN.water ? 0 : 1;
  // 到最近的"另一边"格子的距离（两遍倒角距离），陆地和水各算一次。
  const toWater = chamfer(land, w, h, 1);
  const toLand = chamfer(land, w, h, 0);
  const sd = new Float32Array(n);
  for (let i = 0; i < n; i++) sd[i] = land[i] ? toWater[i]! - 0.5 : -(toLand[i]! - 0.5);
  const grass = new Float32Array(n);
  const shrubLand = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    grass[i] = terrain[i] === TERRAIN.grass || terrain[i] === TERRAIN.shrub ? 1 : 0;
    shrubLand[i] = terrain[i] === TERRAIN.shrub ? 1 : 0;
  }
  return {
    width: w,
    height: h,
    sd,
    grass: blur(grass, w, h, 2),
    shrubLand: blur(shrubLand, w, h, 2),
    herb: blur(Float32Array.from(input.herb), w, h, 2),
    shrub: blur(Float32Array.from(input.shrub), w, h, 2),
  };
}

/** land[i] === source 的格到最近的另一类格的距离（格）；另一类格本身为 0。 */
function chamfer(land: Uint8Array, w: number, h: number, source: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = land[i] === source ? INF : 0;
  const D = Math.SQRT2;
  const relax = (i: number, j: number, cost: number): void => {
    const v = d[j]! + cost;
    if (v < d[i]!) d[i] = v;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) {
        relax(i, i - w, 1);
        if (x > 0) relax(i, i - w - 1, D);
        if (x < w - 1) relax(i, i - w + 1, D);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) {
        relax(i, i + w, 1);
        if (x < w - 1) relax(i, i + w + 1, D);
        if (x > 0) relax(i, i + w - 1, D);
      }
    }
  // 地图边上全是水，INF 只会出现在全图都是同一种格子时。
  for (let i = 0; i < d.length; i++) if (d[i]! >= INF) d[i] = w + h;
  return d;
}

/** 3×3 均值模糊若干遍。 */
function blur(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(a.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            s += a[yy * w + xx]!;
            k++;
          }
        b[y * w + x] = s / k;
      }
    a = b;
  }
  return a;
}

/** 双线性取样（格坐标，格中心在整数处）。 */
export function sample(f: Float32Array, w: number, h: number, u: number, v: number): number {
  const x = Math.min(Math.max(u, 0), w - 1.001);
  const y = Math.min(Math.max(v, 0), h - 1.001);
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const i = iy * w + ix;
  const a = f[i]!;
  const b = f[i + 1]!;
  const c = f[i + w]!;
  const d = f[i + w + 1]!;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** 用代码生成的一张纸：底色乘上大小两层纤维噪声。P4 的纸纹素材到了以后换成真图。 */
export function proceduralPaper(hex: number, seed: number, size = 256): PaperTex {
  const rgb = new Float32Array(size * size * 3);
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // 周期边界：取样坐标绕一圈，平铺时不露缝。
      const k =
        1 +
        0.1 * (periodic(x, y, size, 18, seed) - 0.5) +
        0.07 * (periodic(x, y, size, 2.2, seed + 7) - 0.5) +
        (hashFibre(x, y, seed) ? -0.06 : 0);
      const i = (y * size + x) * 3;
      rgb[i] = r * k;
      rgb[i + 1] = g * k;
      rgb[i + 2] = b * k;
    }
  return { size, rgb };
}

/** 从一张图（如 P4 里切出来的纸纹）做平铺纸。 */
export function imagePaper(data: Uint8ClampedArray, size: number): PaperTex {
  const rgb = new Float32Array(size * size * 3);
  for (let i = 0, j = 0; i < size * size; i++, j += 4) {
    rgb[i * 3] = data[j]! / 255;
    rgb[i * 3 + 1] = data[j + 1]! / 255;
    rgb[i * 3 + 2] = data[j + 2]! / 255;
  }
  return { size, rgb };
}

function periodic(x: number, y: number, size: number, scale: number, seed: number): number {
  // 在周期为 size 的网格上取值噪声：把整数格点按周期取模。
  const period = Math.max(1, Math.round(size / scale));
  const fx = (x / size) * period;
  const fy = (y / size) * period;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const at = (a: number, b: number): number => valueNoise((a % period) + 0.0, (b % period) + 0.0, seed);
  const a = at(ix, iy);
  const b = at(ix + 1, iy);
  const c = at(ix, iy + 1);
  const d = at(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** 零星的短纤维：纸里偶尔一道深色细丝。 */
function hashFibre(x: number, y: number, seed: number): boolean {
  const n = valueNoise(x / 1.3 + y / 9, y / 1.3 - x / 11, seed + 99);
  return n > 0.985;
}

function texAt(t: PaperTex, x: number, y: number, ox: number, oy: number): number {
  // 镜像平铺，减少重复感；每层纸用不同的偏移。
  const s = t.size;
  let u = (x + ox) % (2 * s);
  let v = (y + oy) % (2 * s);
  if (u >= s) u = 2 * s - 1 - u;
  if (v >= s) v = 2 * s - 1 - v;
  return (v * s + u) * 3;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 灌丛指示场（加上和地形绘制相同的扭曲后）的门槛：大于 SHRUB_EDGE 的地方算灌丛，
 * 树冠下的暗地面从更靠里的 SHRUB_UNDER 开始，保证暗地面不会露出到树冠外面。
 */
export const SHRUB_EDGE = 0.5;
export const SHRUB_UNDER = 0.62;

/** 和 paintTerrain 一致的低频扭曲（格）。植被摆放、地面铺叶都用它，和地形的边对齐。 */
export function terrainWarp(px: number, py: number, seed: number): number {
  return (fbm(px / (PX * 5), py / (PX * 5), seed) - 0.5) * 1.6;
}

type Rgb01 = [number, number, number];

interface Layer {
  /** 用哪张场：离岸距离、草地指示、灌丛指示。'land' 是离岸距离，但只铺在草地上（草地内部的明暗台阶）。 */
  kind: 'sd' | 'grass' | 'shrub' | 'land';
  t: number;
  /** 边的宽度（场的单位）；0 = 没有边。 */
  rim: number;
  /** 边的颜色：'white' 米白撕边；'light' 本层颜色提亮一点（纸的切口受光），不像白边那么抢眼。 */
  edge?: 'white' | 'light';
  /** 往下一层落的投影有多深（0–1）；不填时有白边的层 0.32，没有的 0。 */
  shadow?: number;
  /** 场每像素大约变化多少（抗锯齿用）。 */
  grad: number;
  tex: PaperTex;
  /** 指定这层纸的颜色（0–1），纸纹取自 tex 的相对明暗；不填就用 tex 本色。 */
  col?: Rgb01;
  /** 轮廓的额外起伏（格）：每层各自起伏，层与层的边不是一圈圈平行线。 */
  wob?: number;
  /** 碎浪花：只在一部分地方有（低频噪声决定），像示意图里断断续续的白色花边。 */
  lace?: boolean;
  /** 植被量低时混进去的枯色纸。 */
  dry?: PaperTex;
}

/** 一张纸纹的平均颜色：用来把纸纹换算成"相对明暗"，再乘到任意颜色上。 */
function meanOf(t: PaperTex): Rgb01 {
  const m: Rgb01 = [0, 0, 0];
  const n = t.size * t.size;
  for (let i = 0; i < n; i++) {
    m[0] += t.rgb[i * 3]!;
    m[1] += t.rgb[i * 3 + 1]!;
    m[2] += t.rgb[i * 3 + 2]!;
  }
  return [m[0] / n, m[1] / n, m[2] / n];
}

const rgb01 = (r: number, g: number, b: number): Rgb01 => [r / 255, g / 255, b / 255];

/**
 * 纸雕式的分层（plants 模式默认）：每层是一张单色的纸（可以真的剪出来叠起来）。
 * - 水：从远海到岸边十二层，越近越浅、越绿；层与层之间没有白边，只有一点投影和切口的亮边；
 * - 白色只用在岸边：一道断断续续的碎浪花和一道贴岸的浪花；
 * - 海滩分湿沙、干沙两层；草地内部按离岸距离再分三层浅浅的明暗台阶（平的，没有厚度）。
 */
function sculptLayers(pal: Palette, soft: boolean): Layer[] {
  const sdGrad = 1 / PX;
  const indGrad = 0.3 / PX;
  // [门槛（格，负数在水里）, 颜色]：远海群青 → 钴蓝 → 青 → 近岸浅绿松石（照示意图，饱和一些）。
  const water: [number, Rgb01][] = [
    [-28, rgb01(22, 58, 118)],
    [-23, rgb01(24, 66, 130)],
    [-18.5, rgb01(26, 77, 142)],
    [-14.5, rgb01(28, 89, 154)],
    [-11.2, rgb01(30, 103, 166)],
    [-8.5, rgb01(32, 118, 178)],
    [-6.3, rgb01(34, 134, 188)],
    [-4.6, rgb01(38, 150, 196)],
    [-3.3, rgb01(48, 166, 200)],
    [-2.3, rgb01(70, 182, 204)],
    [-1.5, rgb01(100, 196, 206)],
    [-0.9, rgb01(138, 210, 206)],
  ];
  const layers: Layer[] = water.map(([t, col], k) => ({
    kind: 'sd',
    t,
    rim: 0.06,
    edge: 'light',
    shadow: 0.2,
    grad: sdGrad,
    tex: k < 4 ? pal.deep : k < 8 ? pal.mid : pal.shallow,
    col,
    wob: 0.22 * Math.pow(-t, 0.75),
  }));
  layers.push(
    { kind: 'sd', t: -1.25, rim: 0.12, edge: 'white', shadow: 0.12, grad: sdGrad, tex: pal.foam, lace: true, wob: 0.3 },
    { kind: 'sd', t: -0.4, rim: 0.22, edge: 'white', shadow: 0.2, grad: sdGrad, tex: pal.foam, wob: 0.12 },
    { kind: 'sd', t: 0, rim: 0.05, edge: 'light', shadow: 0.18, grad: sdGrad, tex: pal.beach, col: rgb01(132, 120, 104), wob: 0.1 },
    { kind: 'sd', t: 0.45, rim: 0.05, edge: 'light', shadow: 0.12, grad: sdGrad, tex: pal.beach, wob: 0.2 },
    soft
      ? { kind: 'grass', t: 0.5, rim: 0, shadow: 0.1, grad: indGrad * 5, tex: pal.grass, dry: pal.dry }
      : { kind: 'grass', t: 0.5, rim: 0.07, grad: indGrad, tex: pal.grass, dry: pal.dry },
  );
  // 草地内部的明暗台阶：亮、暗、亮交替，很浅。
  for (const [t, k] of [
    [3.5, 1.05],
    [7, 0.96],
    [11, 1.04],
  ] as const) {
    const m = meanOf(pal.grass);
    layers.push({ kind: 'land', t, rim: 0.05, edge: 'light', shadow: 0.1, grad: sdGrad, tex: pal.grass, col: [m[0] * k, m[1] * k, m[2] * k], wob: 1.2, dry: pal.dry });
  }
  layers.push(
    soft
      ? { kind: 'shrub', t: SHRUB_UNDER, rim: 0, grad: indGrad * 6, tex: pal.shrub, dry: pal.dry }
      : { kind: 'shrub', t: 0.5, rim: 0.07, grad: indGrad, tex: pal.shrub, dry: pal.dry },
  );
  return layers;
}

/**
 * 逐像素画地形。返回 RGBA，宽高 = 格数 × PX。
 * 每层纸：先在下面一层上落投影（往右下偏），再画边（白色撕边或切口亮边），最后铺这层的纸。
 * softVegetation：草地、灌丛两层不要白边，边缘柔和过渡（植被的轮廓交给立起来的植物），
 * 灌丛层往里收一点，当作树冠下的暗地面。
 * sculpt：纸雕式的多层（见 sculptLayers）；不开时是第一版的四层水。
 */
export function paintTerrain(
  f: Fields,
  pal: Palette,
  seed: number,
  opts: { softVegetation?: boolean; sculpt?: boolean } = {},
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const W = f.width * PX;
  const H = f.height * PX;
  const out = new Uint8ClampedArray(W * H * 4);
  const sdGrad = 1 / PX;
  const indGrad = 0.3 / PX;
  const raw: Layer[] = opts.sculpt
    ? sculptLayers(pal, !!opts.softVegetation)
    : [
        { kind: 'sd', t: -6, rim: 0.22, grad: sdGrad, tex: pal.mid },
        { kind: 'sd', t: -2.6, rim: 0.22, grad: sdGrad, tex: pal.shallow },
        { kind: 'sd', t: -0.75, rim: 0.3, grad: sdGrad, tex: pal.foam },
        { kind: 'sd', t: 0, rim: 0.22, grad: sdGrad, tex: pal.beach },
        opts.softVegetation
          ? { kind: 'grass', t: 0.5, rim: 0, grad: indGrad * 5, tex: pal.grass, dry: pal.dry }
          : { kind: 'grass', t: 0.5, rim: 0.07, grad: indGrad, tex: pal.grass, dry: pal.dry },
        opts.softVegetation
          ? { kind: 'shrub', t: SHRUB_UNDER, rim: 0, grad: indGrad * 6, tex: pal.shrub, dry: pal.dry }
          : { kind: 'shrub', t: 0.5, rim: 0.07, grad: indGrad, tex: pal.shrub, dry: pal.dry },
      ];
  // 统一成同一种形状（每个字段都有值），逐像素循环里读属性才快。
  const layers: Required<Layer>[] = raw.map((L) => ({
    kind: L.kind,
    t: L.t,
    rim: L.rim,
    edge: L.edge ?? 'white',
    shadow: L.shadow ?? (L.rim > 0 ? 0.32 : 0),
    grad: L.grad,
    tex: L.tex,
    col: L.col ?? [0, 0, 0],
    wob: L.wob ?? 0,
    lace: L.lace ?? false,
    dry: L.dry ?? L.tex,
  }));
  const hasCol = raw.map((L) => !!L.col);
  const hasDry = raw.map((L) => !!L.dry);
  const means = layers.map((L, k) => (hasCol[k] ? meanOf(L.tex) : null));
  // 远海底色：比最深的一层再深一点。
  const base = opts.sculpt ? rgb01(20, 50, 104) : null;
  const baseMean = base ? meanOf(pal.deep) : null;
  // 投影往右下偏的距离（格）：纸雕的层很薄，投影也短一些。
  const SHX = (opts.sculpt ? 3 : 5) / PX;
  const SHY = (opts.sculpt ? 4 : 6) / PX;
  const { width: w, height: h } = f;
  const wobC = layers.map((_, k) => Math.cos(k * 1.7));
  const wobS = layers.map((_, k) => Math.sin(k * 1.7));
  // 完全不透明的层（盖住下面一切）：不是碎浪花、也不是只混一半的柔和灌丛。
  const opaque = layers.map((L) => !L.lace && !(L.rim === 0 && L.kind === 'shrub'));
  const hereK = new Float64Array(layers.length);
  const offK = new Float64Array(layers.length);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / PX - 0.5;
      const v = (py + 0.5) / PX - 0.5;
      // 低频扭曲让海岸线不跟着格子走；高频纤维决定白边的毛刺。
      const warp = terrainWarp(px, py, seed);
      const fibre = valueNoise(px / 2.4, py / 2.4, seed + 5);
      const fine = valueNoise(px / 7, py / 7, seed + 9);
      // 每层各自的轮廓起伏：两张共用的噪声按层转个角度组合，省得每层算一次噪声。
      const n1 = opts.sculpt ? valueNoise(px / (PX * 2.6), py / (PX * 2.6), seed + 31) - 0.5 : 0;
      const n2 = opts.sculpt ? valueNoise(px / (PX * 2.6) + 17.3, py / (PX * 2.6) - 5.1, seed + 37) - 0.5 : 0;
      const sdHere = sample(f.sd, w, h, u, v) + warp;
      const sdOff = sample(f.sd, w, h, u - SHX, v - SHY) + warp;
      // 碎浪花的断续：只在岸边附近才算（分形噪声，断口圆润）。
      const lace = opts.sculpt && sdHere > -3 && sdHere < 0.5 ? fbm(px / 16, py / 16, seed + 43) : 0;
      const indWarp = warp * 0.12;
      const gHere = sample(f.grass, w, h, u, v) + indWarp;
      const gOff = sample(f.grass, w, h, u - SHX, v - SHY) + indWarp;
      const sHere = sample(f.shrubLand, w, h, u, v) + indWarp;
      const sOff = sample(f.shrubLand, w, h, u - SHX, v - SHY) + indWarp;
      let ti = texAt(pal.deep, px, py, 0, 0);
      let r = pal.deep.rgb[ti]!;
      let g = pal.deep.rgb[ti + 1]!;
      let b = pal.deep.rgb[ti + 2]!;
      if (base && baseMean) {
        r = (base[0] * r) / baseMean[0];
        g = (base[1] * g) / baseMean[1];
        b = (base[2] * b) / baseMean[2];
      }
      // 先算每层的场值，找出最上面一张完全盖住这里的纸：它下面的层看不见，不用画。
      let start = 0;
      for (let k = 0; k < layers.length; k++) {
        const L = layers[k]!;
        const wob = L.wob ? (n1 * wobC[k]! + n2 * wobS[k]!) * 2 * L.wob : 0;
        let here = L.kind === 'grass' ? gHere : L.kind === 'shrub' ? sHere : sdHere + wob;
        let off = L.kind === 'grass' ? gOff : L.kind === 'shrub' ? sOff : sdOff + wob;
        // 草地内部的台阶只铺在草地上：出了草地就当作不在这层里。
        if (L.kind === 'land') {
          here -= Math.max(0, 0.6 - gHere) * 40;
          off -= Math.max(0, 0.6 - gOff) * 40;
        }
        if (L.lace) {
          // 碎浪花只在噪声高的地方有：其余地方往外推，等于这层不存在。
          const cut = Math.min(0, (lace - 0.5) * 14);
          here += cut;
          off += cut;
        }
        hereK[k] = here;
        offK[k] = off;
        if (opaque[k] && here > L.t + 0.15 * L.rim + 0.5 * L.grad) start = k;
      }
      for (let k = start; k < layers.length; k++) {
        const L = layers[k]!;
        const here = hereK[k]!;
        const off = offK[k]!;
        // 离这层（连边和投影）都远：整层跳过。
        if (here < L.t - 1.4 * L.rim - L.grad && off < L.t - L.rim - L.grad * 4) continue;
        const rimEdge = L.t - L.rim * (0.5 + 0.9 * fibre);
        // 投影：偏移处被这层（连边）盖住的程度，边缘柔和。
        const shadowK = L.shadow;
        if (shadowK > 0) {
          const soft = L.grad * 4;
          const sh = clamp01((off - (L.t - L.rim) + soft) / (2 * soft)) * shadowK;
          r *= 1 - sh;
          g *= 1 - sh * 1.04;
          b *= 1 - sh * 1.1;
        }
        // 这层的纸色（指定颜色时，用纸纹的相对明暗乘上去）。
        ti = texAt(L.tex, px, py, k * 131, k * 53);
        let fr = L.tex.rgb[ti]!;
        let fg = L.tex.rgb[ti + 1]!;
        let fb = L.tex.rgb[ti + 2]!;
        const m = means[k];
        if (m) {
          fr = (L.col[0] * fr) / m[0];
          fg = (L.col[1] * fg) / m[1];
          fb = (L.col[2] * fb) / m[2];
        }
        const rimA = L.rim > 0 ? clamp01((here - rimEdge) / L.grad + 0.5) : 0;
        if (rimA > 0) {
          if (L.edge === 'white') {
            const ri = texAt(pal.rim, px, py, k * 97, k * 61);
            r += (pal.rim.rgb[ri]! - r) * rimA;
            g += (pal.rim.rgb[ri + 1]! - g) * rimA;
            b += (pal.rim.rgb[ri + 2]! - b) * rimA;
          } else {
            r += (Math.min(1, fr * 1.16 + 0.03) - r) * rimA;
            g += (Math.min(1, fg * 1.16 + 0.03) - g) * rimA;
            b += (Math.min(1, fb * 1.16 + 0.03) - b) * rimA;
          }
        }
        // 没有白边的灌丛层只当树冠下的阴影地面：和草地混一半，不铺满深色。
        const fillA = clamp01((here - (L.t + (fine - 0.5) * L.rim * 0.3)) / L.grad + 0.5) * (L.rim === 0 && L.kind === 'shrub' ? 0.55 : 1);
        if (fillA > 0) {
          if (hasDry[k]) {
            const amt = L.kind === 'shrub' ? sample(f.shrub, w, h, u, v) : sample(f.herb, w, h, u, v);
            // 植被量低于约 0.6 开始泛黄，被吃光时接近枯色纸。
            const dryA = clamp01((0.6 - amt) / 0.5) * 0.85;
            const di = texAt(L.dry, px, py, k * 71, k * 29);
            fr += (L.dry.rgb[di]! - fr) * dryA;
            fg += (L.dry.rgb[di + 1]! - fg) * dryA;
            fb += (L.dry.rgb[di + 2]! - fb) * dryA;
          }
          r += (fr - r) * fillA;
          g += (fg - g) * fillA;
          b += (fb - b) * fillA;
        }
      }
      const o = (py * W + px) * 4;
      out[o] = r * 255;
      out[o + 1] = g * 255;
      out[o + 2] = b * 255;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}
