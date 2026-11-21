import { CanvasTexture, ExtrudeGeometry, Group, Mesh, NoColorSpace, LinearFilter, Shape, Path, type Material } from 'three';
import { TERRAIN } from '../../sim/terrain';
import { chaikin, isoLoops, regions, thin } from './contour';
import { paperMaterial, type PaperAo } from './paper';

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

/** 各层的顶面高度（世界单位）。水是一层层薄纸往下；岸是一张沙色的纸；陆地一层比一层高。 */
export const SEA_LEVELS = 11;
export function levelTop(L: number): number {
  if (L < 0) return -0.03 + (L + 1) * 0.05;
  return 0.08 + L * 0.24;
}

export const SEA_SHALLOW = [0xa6ddd2, 0x8bcfca, 0x72bfc2, 0x5eaebb, 0x4f9db2, 0x438da8, 0x3a7e9c, 0x33708f, 0x2d6383, 0x285877, 0x234e6c];
export const LAND = [0xf0dcaa, 0xb3d57a, 0x9dc867, 0x88b857, 0x77a64c, 0x689444, 0x5b833e, 0x4f7339, 0x456535];
export const DEEP = 0x24506e;

export interface ReliefField {
  n: number;
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
  const d = new Float32Array(n * n);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
  const D = Math.SQRT2;
  for (let y = 0; y < n; y++)
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
  for (let y = n - 1; y >= 0; y--)
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      let v = d[i]!;
      if (x < n - 1) v = Math.min(v, d[i + 1]! + 1);
      if (y < n - 1) {
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
  const maxLevel = Math.min(LAND.length - 1, Math.floor(maxV));
  return {
    n,
    x0,
    z0,
    step: 1 / U,
    v,
    maxLevel,
    levelAt(x: number, z: number): number {
      const i = Math.round((x - x0) * U);
      const j = Math.round((z - z0) * U);
      if (i < 0 || j < 0 || i >= n || j >= n) return -SEA_LEVELS - 1;
      return Math.min(maxLevel, Math.floor(v[j * n + i]!));
    },
  };
}

/**
 * 接缝的暗和纸上的斑驳，烤成一张铺满地面的灰度图：
 * 每一点离"比它高一层的纸"越近越暗（上一层的纸投下的那条窄影子、纸板接缝），再乘一层大块的斑驳。
 */
export function bakeAo(f: ReliefField, seed: number): PaperAo {
  const { n, v } = f;
  const levelOf = new Int8Array(n * n);
  for (let k = 0; k < v.length; k++) levelOf[k] = Math.max(-SEA_LEVELS - 1, Math.min(f.maxLevel, Math.floor(v[k]!)));
  const ao = new Float32Array(n * n).fill(1);
  for (let L = -SEA_LEVELS - 1; L < f.maxLevel; L++) {
    const above = new Uint8Array(n * n);
    let any = false;
    for (let k = 0; k < above.length; k++)
      if (levelOf[k]! > L) {
        above[k] = 1;
        any = true;
      }
    if (!any) continue;
    const d = distance(above, n);
    const strong = L >= 0 ? 0.46 : 0.3;
    for (let k = 0; k < ao.length; k++) {
      if (levelOf[k] !== L) continue;
      const dc = d[k]! / U;
      ao[k] = 1 - strong * Math.exp(-dc / 0.22) - 0.12 * Math.exp(-dc / 1.1);
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const gx = i / U;
      const gy = j / U;
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
  return { tex, x0: f.x0 - f.step / 2, z0: f.z0 - f.step / 2, size: n * f.step };
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
      const j = (noise2(arc * 3.1, 0.5, seed) - 0.5) * wobble + (noise2(arc * 11, 2.5, seed + 1) - 0.5) * wobble * 0.35;
      out.push(s[i * 2]! + (tz / l) * j, s[i * 2 + 1]! - (tx / l) * j);
    }
    s = out;
  }
  return s;
}

function shapeFrom(outer: number[], holes: number[][]): Shape {
  // 形状坐标 (x, −z)：挤出后绕 x 转 −90°，厚度朝上。
  const sh = new Shape();
  sh.moveTo(outer[0]!, -outer[1]!);
  for (let i = 2; i < outer.length; i += 2) sh.lineTo(outer[i]!, -outer[i + 1]!);
  sh.closePath();
  for (const h of holes) {
    const p = new Path();
    p.moveTo(h[0]!, -h[1]!);
    for (let i = 2; i < h.length; i += 2) p.lineTo(h[i]!, -h[i + 1]!);
    p.closePath();
    sh.holes.push(p);
  }
  return sh;
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
  const field = { w: f.n, h: f.n, v: f.v };
  const make = (iso: number, top: number, thick: number, color: number, wobble: number, scale: number, s: number, bump = 1): Mesh | null => {
    const rs = regions(isoLoops(field, iso));
    const shapes: Shape[] = [];
    for (const r of rs) {
      const outer = worldLoop(f, r.outer, s, wobble);
      if (outer.length < 8) continue;
      const holes = r.holes.map((h) => worldLoop(f, h, s + 3, wobble)).filter((h) => h.length >= 8);
      shapes.push(shapeFrom(outer, holes));
    }
    if (shapes.length === 0) return null;
    const g = new ExtrudeGeometry(shapes, { depth: thick, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, top - thick, 0);
    const mats: Material[] = [paperMaterial(color, { scale, ao, bump }), paperMaterial(color, { scale: scale * 0.5, edge: true, bump })];
    const m = new Mesh(g, mats);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (let L = -SEA_LEVELS; L <= f.maxLevel; L++) {
    const top = levelTop(L);
    const below = L === -SEA_LEVELS ? top - 0.3 : levelTop(L - 1);
    const color = L < 0 ? SEA_SHALLOW[Math.min(SEA_SHALLOW.length - 1, -L - 1)]! : LAND[L]!;
    const mesh = make(L, top, Math.max(0.02, top - below), color, L < 0 ? 0.05 : 0.07, L < 0 ? 3.2 : 2.4, seed + L * 17, L < 0 ? 0.6 : 1);
    if (mesh) layers.push({ level: L, mesh, top });
  }
  // 岸边的白：一条撕边的浪花纸，夹在最浅的水和沙滩之间。
  const foam = make(-0.42, levelTop(-1) + 0.025, 0.02, 0xfbf6ea, 0.09, 2.5, seed + 991, 0.5)!;
  return { group, layers, foam };
}
