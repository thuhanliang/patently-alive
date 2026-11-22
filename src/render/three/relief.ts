import { CanvasTexture, Group, Mesh, NoColorSpace, LinearFilter, type Material } from 'three';
import { TERRAIN } from '../../sim/terrain';
import { chaikin, isoLoops, regions, thin } from './contour';
import { paperMaterial, sheetGeometry, type PaperAo, type PaperKind } from './paper';

/**
 * 纸雕地形（2026-11-22）：把一座岛按等高线一层层切成纸板叠起来——2026-10-22 定的"纸雕式多层地形"真的做出来。
 *
 * 推演只有每格的地形类别（水、海岸、草地、灌丛），没有高度。高度是画面自己推出来的：
 * 离海越远越高（开方，岛心平缓），灌丛略高一点，再加一点起伏；海里离岸越远越深。
 * 只用来画，不回写推演（铁律 1）。同一块地形、同一个种子永远切出同样的纸。
 *
 * 一格 = 1 个世界单位。原点在岛图的正中，x 向右、z 向下（和格子的行一样）。
 */

export interface ReliefInput {
  width: number;
  height: number;
  terrain: Uint8Array;
  seed: number;
}

/** 每格采几个点、四周补多少格的海。 */
const U = 3;
const PAD = 34;

/**
 * 做得出来的纸雕（2026-11-22，用户：以后要能导出、打印、真的做成 A4 的桌面摆件）：
 * 每一层都是同一种厚度的卡纸（CARD，按 1 格 = 1 厘米算约 1 毫米），层层直接叠起来；高度不够就多叠几层，不把纸做厚。
 */
export const CARD = 0.1;
export const SEA_LEVELS = 11;
/** 第 L 层纸的顶面高度：一层一张卡纸。0 层是沙滩，负的是水，正的是陆地。 */
export function levelTop(L: number): number {
  return (L + 1) * CARD;
}
/** 场里的值 v 落在第几层：海按 1 一层，沙滩 0–1，陆地从 1 起每 0.4 一层（层更多、更细）。 */
export const LAND_STEP = 0.4;
export function levelOfV(v: number): number {
  if (v < 1) return Math.floor(v);
  return 1 + Math.floor((v - 1) / LAND_STEP);
}
export function isoOf(L: number): number {
  return L <= 1 ? L : 1 + (L - 1) * LAND_STEP;
}

export const SEA_SHALLOW = [0xa6ddd2, 0x8bcfca, 0x72bfc2, 0x5eaebb, 0x4f9db2, 0x438da8, 0x3a7e9c, 0x33708f, 0x2d6383, 0x285877, 0x234e6c];
/** 陆地的纸色：沙，然后由浅绿到深绿；相邻两层错开一点深浅，层与层的边才读得出来。 */
const LAND_KEYS = [0xc4dd86, 0xa5cb6a, 0x86b356, 0x6d9a48, 0x5a8540, 0x4b7038];
export const LAND: number[] = [0xeedaa8];
for (let L = 1; L <= 16; L++) {
  const t = Math.min(1, (L - 1) / 13) * (LAND_KEYS.length - 1);
  const i = Math.min(LAND_KEYS.length - 2, Math.floor(t));
  const f = t - i;
  const a = LAND_KEYS[i]!;
  const b = LAND_KEYS[i + 1]!;
  const mix = (sh: number): number => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f * (L % 2 ? 1 : 0.985));
  LAND.push((mix(16) << 16) | (mix(8) << 8) | mix(0));
}
export const DEEP = 0x24506e;

export interface ReliefField {
  /** 采样点的列数、行数。 */
  nx: number;
  nz: number;
  /** 是不是从一张大的场里裁出来的（裁的边是直的，不加手剪的抖动）。 */
  cropped?: boolean;
  /** 采样点 0 的世界坐标，采样间距 1/U。 */
  x0: number;
  z0: number;
  step: number;
  /** 连续的"层数"：负的是海，0–1 是沙滩，往上是陆地。 */
  v: Float32Array;
  maxLevel: number;
  /** 世界坐标处的层号和顶面高度。 */
  levelAt(x: number, z: number): number;
}

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

/** 平滑的值噪声（0–1），f 是每单位几个格。 */
export function noise2(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash(xi, yi, s);
  const b = hash(xi + 1, yi, s);
  const c = hash(xi, yi + 1, s);
  const d = hash(xi + 1, yi + 1, s);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

export function fbm(x: number, y: number, s: number, oct = 4): number {
  let a = 1;
  let t = 0;
  let v = 0;
  for (let o = 0; o < oct; o++) {
    v += noise2(x, y, s + o * 101) * a;
    t += a;
    a *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return v / t;
}

/** 两遍倒角距离变换：每个点到最近的 src 点的距离（采样单位）。 */
function distance(src: Uint8Array, n: number): Float32Array {
  return distanceRect(src, n, n);
}

function distanceRect(src: Uint8Array, n: number, rows: number): Float32Array {
  const d = new Float32Array(n * rows);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
  const D = Math.SQRT2;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (y > 0) {
        v = Math.min(v, d[i - n]! + 1);
        if (x > 0) v = Math.min(v, d[i - n - 1]! + D);
        if (x < n - 1) v = Math.min(v, d[i - n + 1]! + D);
      }
      d[i] = v;
    }
  for (let y = rows - 1; y >= 0; y--)
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      let v = d[i]!;
      if (x < n - 1) v = Math.min(v, d[i + 1]! + 1);
      if (y < rows - 1) {
        v = Math.min(v, d[i + n]! + 1);
        if (x < n - 1) v = Math.min(v, d[i + n + 1]! + D);
        if (x > 0) v = Math.min(v, d[i + n - 1]! + D);
      }
      d[i] = v;
    }
  return d;
}

export function reliefField(inp: ReliefInput): ReliefField {
  const { width: W, height: H, terrain, seed } = inp;
  const cells = Math.max(W, H) + PAD * 2;
  const n = cells * U;
  const x0 = -(W / 2 + PAD);
  const z0 = -(H / 2 + PAD);
  const cellOf = (gx: number, gy: number, kind: (t: number) => number): number => {
    // 双线性：格子中心在 (cx + 0.5, cy + 0.5)。
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    const tx = fx - cx;
    const ty = fy - cy;
    const g = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? 0 : kind(terrain[y * W + x]!));
    return (g(cx, cy) * (1 - tx) + g(cx + 1, cy) * tx) * (1 - ty) + (g(cx, cy + 1) * (1 - tx) + g(cx + 1, cy + 1) * tx) * ty;
  };
  const land = new Uint8Array(n * n);
  const sea = new Uint8Array(n * n);
  const shrub = new Float32Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const gx = i / U - PAD;
      const gy = j / U - PAD;
      const m = cellOf(gx, gy, (t) => (t === TERRAIN.water ? 0 : 1)) + (fbm(gx * 0.35, gy * 0.35, seed) - 0.5) * 0.42 + (noise2(gx * 1.3, gy * 1.3, seed + 7) - 0.5) * 0.12;
      const k = j * n + i;
      land[k] = m > 0.5 ? 1 : 0;
      sea[k] = 1 - land[k]!;
      shrub[k] = cellOf(gx, gy, (t) => (t === TERRAIN.shrub ? 1 : 0));
    }
  // 和外海不连通的水（岛上的小水塘）：不算岸边，不铺浪花，直接是一汪深一点的水。
  const ocean = new Uint8Array(n * n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) for (const k of [i, (n - 1) * n + i, i * n, i * n + n - 1]) if (sea[k] && !ocean[k]) (ocean[k] = 1), stack.push(k);
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % n;
    for (const j of [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, k - n, k + n]) if (j >= 0 && j < n * n && sea[j] && !ocean[j]) (ocean[j] = 1), stack.push(j);
  }
  const dIn = distance(sea, n);
  const dOut = distance(land, n);
  const v = new Float32Array(n * n);
  let maxV = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const gx = i / U - PAD;
      const gy = j / U - PAD;
      if (land[k]) {
        const d = dIn[k]! / U;
        const hills = (fbm(gx * 0.09, gy * 0.09, seed + 31) - 0.5) * 2.4 * Math.min(1, d / 4);
        const h = 0.5 + 0.95 * Math.pow(d, 0.62) * (0.8 + 0.45 * fbm(gx * 0.06, gy * 0.06, seed + 13)) + shrub[k]! * 0.55 + hills;
        v[k] = Math.max(0.5, h);
        maxV = Math.max(maxV, v[k]!);
      } else {
        const d = dOut[k]! / U;
        if (!ocean[k]) {
          v[k] = -1.4 - d * 0.8;
          continue;
        }
        v[k] = Math.max(-SEA_LEVELS - 0.5, -(0.3 + d * (0.45 + 0.5 * fbm(gx * 0.05, gy * 0.05, seed + 9)) + (fbm(gx * 0.16, gy * 0.16, seed + 5) - 0.5) * 1.8));
      }
    }
  const maxLevel = Math.min(LAND.length - 1, levelOfV(maxV));
  return makeField(n, n, x0, z0, v, maxLevel, false);
}

function makeField(nx: number, nz: number, x0: number, z0: number, v: Float32Array, maxLevel: number, cropped: boolean): ReliefField {
  return {
    nx,
    nz,
    cropped,
    x0,
    z0,
    step: 1 / U,
    v,
    maxLevel,
    levelAt(x: number, z: number): number {
      const i = Math.round((x - x0) * U);
      const j = Math.round((z - z0) * U);
      if (i < 0 || j < 0 || i >= nx || j >= nz) return -SEA_LEVELS - 1;
      return Math.min(maxLevel, levelOfV(v[j * nx + i]!));
    },
  };
}

/**
 * 从场里裁一块长方形（世界坐标 [x0, x1] × [z0, z1]）：桌上那件 A4 纸雕就是这样一块——每一层纸都在长方形的边上被裁齐。
 */
export function cropField(f: ReliefField, x0: number, z0: number, x1: number, z1: number): ReliefField {
  const i0 = Math.max(0, Math.round((x0 - f.x0) * U));
  const j0 = Math.max(0, Math.round((z0 - f.z0) * U));
  const i1 = Math.min(f.nx - 1, Math.round((x1 - f.x0) * U));
  const j1 = Math.min(f.nz - 1, Math.round((z1 - f.z0) * U));
  const nx = i1 - i0 + 1;
  const nz = j1 - j0 + 1;
  const v = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = f.v[(j + j0) * f.nx + i + i0]!;
  return makeField(nx, nz, f.x0 + i0 / U, f.z0 + j0 / U, v, f.maxLevel, true);
}

/**
 * 接缝的暗和纸上的斑驳，烤成一张铺满地面的灰度图：
 * 每一点离"比它高一层的纸"越近越暗（上一层的纸投下的那条窄影子、纸板接缝），再乘一层大块的斑驳。
 */
export function bakeAo(f: ReliefField, seed: number): PaperAo {
  const { nx, nz, v } = f;
  const levelOf = new Int8Array(nx * nz);
  for (let k = 0; k < v.length; k++) levelOf[k] = Math.max(-SEA_LEVELS - 1, Math.min(f.maxLevel, levelOfV(v[k]!)));
  const ao = new Float32Array(nx * nz).fill(1);
  for (let L = -SEA_LEVELS - 1; L < f.maxLevel; L++) {
    const above = new Uint8Array(nx * nz);
    let any = false;
    for (let k = 0; k < above.length; k++)
      if (levelOf[k]! > L) {
        above[k] = 1;
        any = true;
      }
    if (!any) continue;
    const d = distanceRect(above, nx, nz);
    const strong = L >= 0 ? 0.46 : 0.3;
    for (let k = 0; k < ao.length; k++) {
      if (levelOf[k] !== L) continue;
      const dc = d[k]! / U;
      ao[k] = 1 - strong * Math.exp(-dc / 0.22) - 0.12 * Math.exp(-dc / 1.1);
    }
  }
  const c = document.createElement('canvas');
  c.width = nx;
  c.height = nz;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(nx, nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const gx = f.x0 + i / U;
      const gy = f.z0 + j / U;
      const mottle = 0.9 + 0.16 * fbm(gx * 0.11, gy * 0.11, seed + 77) + 0.05 * (noise2(gx * 0.9, gy * 0.9, seed + 78) - 0.5);
      const val = Math.max(0, Math.min(1, ao[k]! * mottle));
      const p = k * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = Math.round(val * 255);
      img.data[p + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = NoColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  // 采样点在 (i·step)，纹理的像素中心在 (i + 0.5)/n：往回挪半个采样。
  return { tex, x0: f.x0 - f.step / 2, z0: f.z0 - f.step / 2, size: nx * f.step, sizeZ: nz * f.step };
}

/** 一段环：采样坐标 → 世界坐标，圆滑，再加一点手剪的抖动。 */
function worldLoop(f: ReliefField, loop: number[], seed: number, wobble: number): number[] {
  const w: number[] = [];
  for (let i = 0; i < loop.length; i += 2) w.push(f.x0 + loop[i]! * f.step, f.z0 + loop[i + 1]! * f.step);
  let s = thin(chaikin(thin(w, f.step * 0.45)), 0.06);
  if (wobble > 0) {
    const out: number[] = [];
    const m = s.length / 2;
    let arc = 0;
    for (let i = 0; i < m; i++) {
      const a = (i + m - 1) % m;
      const b = (i + 1) % m;
      const tx = s[b * 2]! - s[a * 2]!;
      const tz = s[b * 2 + 1]! - s[a * 2 + 1]!;
      const l = Math.hypot(tx, tz) || 1;
      if (i > 0) arc += Math.hypot(s[i * 2]! - s[(i - 1) * 2]!, s[i * 2 + 1]! - s[(i - 1) * 2 + 1]!);
      let j = (noise2(arc * 3.1, 0.5, seed) - 0.5) * wobble + (noise2(arc * 11, 2.5, seed + 1) - 0.5) * wobble * 0.35;
      // 裁出来的那几条边是用刀和尺子裁的：直的，不抖。
      if (f.cropped) {
        const px = s[i * 2]!;
        const pz = s[i * 2 + 1]!;
        const e = f.step * 1.5;
        const x1 = f.x0 + (f.nx - 1) * f.step;
        const z1 = f.z0 + (f.nz - 1) * f.step;
        const dEdge = Math.min(px - f.x0, x1 - px, pz - f.z0, z1 - pz);
        if (dEdge < e) j = 0;
        else if (dEdge < e * 3) j *= (dEdge - e) / (e * 2);
      }
      out.push(s[i * 2]! + (tz / l) * j, s[i * 2 + 1]! - (tx / l) * j);
    }
    s = out;
  }
  return s;
}

export interface ReliefLayer {
  level: number;
  mesh: Mesh;
  top: number;
}

/** 按层切纸。返回一组网格（每层一个），水的几层另外记下，用来让它们轻轻起伏。 */
export function buildRelief(f: ReliefField, ao: PaperAo, seed: number): { group: Group; layers: ReliefLayer[]; foam: Mesh } {
  const group = new Group();
  const layers: ReliefLayer[] = [];
  const field = { w: f.nx, h: f.nz, v: f.v };
  const make = (iso: number, top: number, thick: number, color: number, wobble: number, scale: number, s: number, kind: PaperKind = 'card'): Mesh | null => {
    const rs = regions(isoLoops(field, iso));
    const shapes: Array<{ outer: number[]; holes: number[][] }> = [];
    for (const r of rs) {
      const outer = worldLoop(f, r.outer, s, wobble);
      if (outer.length < 8) continue;
      const holes = r.holes.map((h) => worldLoop(f, h, s + 3, wobble)).filter((h) => h.length >= 8);
      // 剪纸在 xy 平面里剪，(x, −z)；转平以后厚度朝上。
      const flip = (l: number[]): number[] => l.map((v, i) => (i % 2 ? -v : v));
      shapes.push({ outer: flip(outer), holes: holes.map(flip) });
    }
    if (shapes.length === 0) return null;
    const g = sheetGeometry(shapes, thick);
    g.rotateX(-Math.PI / 2);
    g.translate(0, top - thick, 0);
    const mats: Material[] = [paperMaterial(color, { kind, scale, ao }), paperMaterial(color, { scale: 0.8, edge: true })];
    const m = new Mesh(g, mats);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (let L = -SEA_LEVELS; L <= f.maxLevel; L++) {
    const top = levelTop(L);
    const color = L < 0 ? SEA_SHALLOW[Math.min(SEA_SHALLOW.length - 1, -L - 1)]! : LAND[L]!;
    const mesh = make(isoOf(L), top, CARD, color, L < 0 ? 0.05 : 0.06, L < 0 ? 3.2 : 2.4, seed + L * 17, L === 0 ? 'kraft' : 'card');
    if (mesh) layers.push({ level: L, mesh, top });
  }
  // 岸边的白：一条撕边的薄纸（比卡纸薄得多），贴在最浅的水上、沙滩下面。
  const foam = make(-0.42, levelTop(-1) + 0.025, 0.025, 0xfbf6ea, 0.09, 2.5, seed + 991)!;
  return { group, layers, foam };
}
