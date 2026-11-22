import { BufferAttribute, BufferGeometry } from 'three';
import { thinPiece } from './paper';

/**
 * 剪纸植物图鉴（2026-11-22，用户："植被样式非常单一，严重缺乏美感"）。
 *
 * 每一种植物是几张立着的纸：茎叶一张、花一张、花心一张……每张一个颜色，像真的剪纸那样一层层贴起来。
 * 形状都在"高 1、脚在原点"的坐标里画，摆的时候整株一起缩放，所以花总在茎的尖上。
 * 只管画面，不进推演（植被的多少由推演给，长什么样由这里定）。
 */

type Pts = number[];

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
}

export function circle(cx: number, cy: number, r: number, n = 14, wob = 0, seed = 1): Pts {
  const rnd = rng(seed);
  const out: Pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + (rnd() - 0.5) * wob);
    out.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return out;
}

/** 星形的花：k 瓣，外半径 r1、内半径 r2，瓣尖是圆的。 */
function petals(cx: number, cy: number, r1: number, r2: number, k: number, rot = 0): Pts {
  const out: Pts = [];
  const N = k * 6;
  for (let i = 0; i < N; i++) {
    const a = rot + (i / N) * Math.PI * 2;
    const t = (i % 6) / 6;
    const bump = Math.sin(t * Math.PI);
    const r = r2 + (r1 - r2) * Math.pow(bump, 0.6);
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/** 一片弯的叶或草：从 (x0, 0) 长到高 h，叶尖往旁边歪 lean，最宽 w。 */
function blade(x0: number, h: number, lean: number, w: number, base = 0, n = 8): Pts {
  const left: Pts = [];
  const right: Pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = x0 + lean * t * t;
    const cy = base + h * t;
    const ww = w * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) * (1 - t * 0.85);
    // 法向近似：沿 x 偏一点就够（叶子细长）。
    left.push(cx - ww, cy);
    right.push(cx + ww, cy);
  }
  const out: Pts = [];
  for (let i = 0; i <= n; i++) out.push(left[i * 2]!, left[i * 2 + 1]!);
  for (let i = n; i >= 0; i--) out.push(right[i * 2]!, right[i * 2 + 1]!);
  return out;
}

/** 一根细茎（等宽的弯条）。 */
function stem(x0: number, x1: number, h: number, w: number, y0 = 0): Pts {
  const out: Pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(x0 + (x1 - x0) * t * t - w, y0 + (h - y0) * t);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    out.push(x0 + (x1 - x0) * t * t + w, y0 + (h - y0) * t);
  }
  return out;
}

/** 椭圆（穗、香蒲的棒）。 */
function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 12): Pts {
  const out: Pts = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push(cx + x * c - y * s, cy + x * s + y * c);
  }
  return out;
}

/** 圆鼓鼓的叶团（灌丛、树冠）：上半圈起伏，底边平或圆。 */
function canopy(cx: number, cy: number, w: number, h: number, lobes: number, seed: number, flatBottom = true): Pts {
  const rnd = rng(seed);
  const out: Pts = [];
  const N = 60;
  const ph = rnd() * 6;
  for (let i = 0; i <= N; i++) {
    const t = Math.PI * (i / N);
    const r = 1 + 0.12 * Math.abs(Math.sin(lobes * t * 0.5 + ph)) + 0.035 * Math.sin(11 * t + ph);
    out.push(cx + Math.cos(t) * r * w * 0.5, cy + Math.sin(t) * r * h);
  }
  if (flatBottom) out.push(cx - w * 0.38, cy - h * 0.06, cx + w * 0.38, cy - h * 0.06);
  else
    for (let i = 1; i < 12; i++) {
      const t = Math.PI + Math.PI * (i / 12);
      out.push(cx + Math.cos(t) * w * 0.5, cy + Math.sin(t) * h * 0.35);
    }
  return out;
}

/** 尖刺的剪影（荆豆）：一圈锯齿。 */
function spiky(cx: number, cy: number, w: number, h: number, seed: number): Pts {
  const rnd = rng(seed);
  const out: Pts = [];
  const N = 46;
  for (let i = 0; i <= N; i++) {
    const t = Math.PI * (i / N);
    const r = i % 2 ? 1.0 + rnd() * 0.12 : 0.8;
    out.push(cx + Math.cos(t) * r * w * 0.5, cy + Math.sin(t) * r * h);
  }
  out.push(cx - w * 0.3, cy, cx + w * 0.3, cy);
  return out;
}

/** 一层层的塔形（矮松、杜松一类）。 */
function tiers(cx: number, w: number, h: number, k: number, y0: number): Pts {
  const out: Pts = [];
  // 右边从下往上，每层一个往外的尖。
  for (let i = 0; i < k; i++) {
    const t0 = i / k;
    const t1 = (i + 1) / k;
    const ww = (1 - t0) * w * 0.5;
    out.push(cx + ww * 0.55, y0 + h * t0, cx + ww, y0 + h * (t0 + 0.08), cx + (1 - t1) * w * 0.5 * 0.55, y0 + h * t1 * 0.98);
  }
  out.push(cx, y0 + h * 1.04);
  for (let i = k - 1; i >= 0; i--) {
    const t0 = i / k;
    const t1 = (i + 1) / k;
    const ww = (1 - t0) * w * 0.5;
    out.push(cx - (1 - t1) * w * 0.5 * 0.55, y0 + h * t1 * 0.98, cx - ww, y0 + h * (t0 + 0.08), cx - ww * 0.55, y0 + h * t0);
  }
  return out;
}

/** 蕨的一片叶：中轴两边一对对小叶，越往上越小。 */
function frond(x0: number, h: number, lean: number, w: number): Pts {
  const left: Pts = [];
  const right: Pts = [];
  const pairs = 9;
  for (let i = 0; i <= pairs; i++) {
    const t = i / pairs;
    const cx = x0 + lean * t * t;
    const cy = h * t;
    const ww = w * (1 - t) * (t < 0.12 ? t / 0.12 : 1);
    right.push(cx + 0.008, cy, cx + ww, cy + h * 0.03, cx + 0.008, cy + h * 0.06);
    left.push(cx - 0.008, cy, cx - ww, cy + h * 0.03, cx - 0.008, cy + h * 0.06);
  }
  const out: Pts = [];
  for (let i = 0; i < right.length; i += 2) out.push(right[i]!, right[i + 1]!);
  out.push(x0 + lean, h * 1.02);
  for (let i = left.length - 2; i >= 0; i -= 2) out.push(left[i]!, left[i + 1]!);
  return out;
}

/** 几张纸片合成一个几何（保持两组：正面、断面），同一颜色。 */
export function mergeSheets(parts: Pts[], depth: number, z = 0): BufferGeometry {
  const geoms = parts.filter((p) => p.length >= 6).map((p) => thinPiece(p, depth));
  const face: number[][] = [[], [], []];
  const edge: number[][] = [[], [], []];
  for (const g of geoms) {
    const pos = g.getAttribute('position').array;
    const nor = g.getAttribute('normal').array;
    const uv = g.getAttribute('uv').array;
    const fc = g.groups[0]!.count;
    const total = pos.length / 3;
    for (let i = 0; i < total; i++) {
      const dst = i < fc ? face : edge;
      dst[0]!.push(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]! + z - depth / 2);
      dst[1]!.push(nor[i * 3]!, nor[i * 3 + 1]!, nor[i * 3 + 2]!);
      dst[2]!.push(uv[i * 2]!, uv[i * 2 + 1]!);
    }
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array([...face[0]!, ...edge[0]!]), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array([...face[1]!, ...edge[1]!]), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array([...face[2]!, ...edge[2]!]), 2));
  const fc = face[0]!.length / 3;
  out.addGroup(0, fc, 0);
  out.addGroup(fc, edge[0]!.length / 3, 1);
  out.computeBoundingSphere();
  return out;
}

export interface FloraPart {
  geom: BufferGeometry;
  /** 这一张纸可能的颜色（每株挑一个；同一片花丛里挑得一样）。 */
  colors: readonly number[];
}

export interface FloraKind {
  id: string;
  parts: FloraPart[];
  /** 高（世界单位）的范围；宽 = 高 × aspect。 */
  h: [number, number];
  aspect: number;
  /** 风里摆多少。 */
  sway: number;
}

const PAPER = 0.016;
const LIFT = 0.006;

/** 造一整套植物（每种几张纸）。seed 只影响形状的细节。 */
export function buildFlora(seed: number): Map<string, FloraKind> {
  const kinds: FloraKind[] = [];
  const rnd = rng(seed);
  const add = (id: string, h: [number, number], aspect: number, sway: number, parts: Array<[Pts[], readonly number[], number?]>): void => {
    kinds.push({ id, h, aspect, sway, parts: parts.map(([pts, colors, z], i) => ({ geom: mergeSheets(pts, PAPER, (z ?? i) * LIFT), colors })) });
  };

  // 矮草：一丛尖叶。
  {
    const bl: Pts[] = [];
    for (let i = 0; i < 7; i++) {
      const u = i / 6;
      bl.push(blade(-0.12 + u * 0.24, 0.55 + rnd() * 0.45 - Math.abs(u - 0.5) * 0.3, (u - 0.5) * 0.7, 0.05 + rnd() * 0.02));
    }
    add('grass', [0.1, 0.2], 1, 0.05, [[bl, [0x9fca5e, 0x8dbd52, 0xaccf68, 0x7fb04b]]]);
  }
  // 高草：细长的叶 + 燕麦样的穗。
  {
    const bl: Pts[] = [];
    const heads: Pts[] = [];
    for (let i = 0; i < 5; i++) {
      const u = i / 4;
      const x0 = -0.08 + u * 0.16;
      const lean = (u - 0.5) * 0.5 + (rnd() - 0.5) * 0.2;
      bl.push(blade(x0, 0.75 + rnd() * 0.2, lean, 0.035));
    }
    for (let i = 0; i < 3; i++) {
      const x1 = (i - 1) * 0.22 + (rnd() - 0.5) * 0.05;
      bl.push(stem(0, x1, 0.92 + rnd() * 0.12, 0.008));
      for (let k = 0; k < 6; k++) {
        const t = 0.72 + k * 0.05;
        heads.push(ellipse(x1 * (t * t) / 1 + (k % 2 ? 0.025 : -0.025), t, 0.018, 0.035, k % 2 ? -0.5 : 0.5, 8));
      }
    }
    add('tallgrass', [0.22, 0.36], 0.8, 0.08, [
      [bl, [0x93be55, 0x86b24d, 0xa0c35f]],
      [heads, [0xe2d39a, 0xd8c486, 0xc9b878]],
    ]);
  }
  // 雏菊：几根茎、几片叶、白色花瓣、黄心。
  {
    const st: Pts[] = [];
    const pe: Pts[] = [];
    const ce: Pts[] = [];
    const tips: Array<[number, number]> = [
      [-0.2, 0.78],
      [0.05, 1],
      [0.24, 0.86],
    ];
    for (const [x, y] of tips) {
      st.push(stem(0, x, y, 0.012));
      pe.push(petals(x, y, 0.13, 0.04, 11, rnd()));
      ce.push(circle(x, y, 0.045, 12));
    }
    st.push(blade(-0.02, 0.3, -0.25, 0.06), blade(0.02, 0.26, 0.28, 0.06));
    add('daisy', [0.16, 0.26], 0.9, 0.06, [
      [st, [0x6fa046, 0x7aab4e]],
      [pe, [0xfbf7ec, 0xf6efe0]],
      [ce, [0xf2c033, 0xeab52c]],
    ]);
  }
  // 毛茛：小的黄色杯形花，分枝多。
  {
    const st: Pts[] = [];
    const fl: Pts[] = [];
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.13 + (rnd() - 0.5) * 0.05;
      const y = 0.7 + rnd() * 0.3;
      st.push(stem(0, x, y, 0.01));
      fl.push(petals(x, y, 0.07, 0.035, 5, rnd() * 2));
    }
    st.push(blade(0, 0.25, -0.2, 0.07), blade(0, 0.22, 0.22, 0.07));
    add('buttercup', [0.14, 0.22], 1, 0.06, [
      [st, [0x78a94b, 0x6c9c45]],
      [fl, [0xf6cf2f, 0xf2c21f, 0xf8d84a]],
    ]);
  }
  // 三叶草：贴地的三出叶 + 粉白的绒球。
  {
    const lv: Pts[] = [];
    const hd: Pts[] = [];
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.16;
      const y = 0.18 + rnd() * 0.12;
      lv.push(stem(0, x, y, 0.01));
      for (let k = 0; k < 3; k++) lv.push(circle(x + Math.cos(k * 2.1 + 1.57) * 0.05, y + Math.sin(k * 2.1 + 1.57) * 0.05, 0.05, 10));
    }
    for (let i = 0; i < 2; i++) {
      const x = (i - 0.5) * 0.3;
      lv.push(stem(0, x, 0.62 + i * 0.1, 0.01));
      hd.push(circle(x, 0.66 + i * 0.1, 0.09, 16, 0.25, i + 3));
    }
    add('clover', [0.12, 0.18], 1.1, 0.04, [
      [lv, [0x5f9440, 0x6a9f48]],
      [hd, [0xe9a6c0, 0xf3d3de, 0xd98aac]],
    ]);
  }
  // 海石竹（海边）：细叶一小丛 + 粉色绒球。
  {
    const lv: Pts[] = [];
    const hd: Pts[] = [];
    for (let i = 0; i < 9; i++) lv.push(blade((i - 4) * 0.02, 0.25 + rnd() * 0.1, (i - 4) * 0.05, 0.02));
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.18;
      lv.push(stem(0, x, 0.8 + rnd() * 0.2, 0.009));
      hd.push(circle(x, 0.86 + rnd() * 0.12, 0.08, 14, 0.3, i + 9));
    }
    add('thrift', [0.12, 0.2], 1, 0.05, [
      [lv, [0x7c9f5a, 0x86a862]],
      [hd, [0xe58fb0, 0xf0a9c2, 0xd8799e]],
    ]);
  }
  // 海边的沙草：弯得厉害的长叶，偏黄。
  {
    const bl: Pts[] = [];
    for (let i = 0; i < 8; i++) {
      const u = i / 7;
      bl.push(blade(-0.1 + u * 0.2, 0.6 + rnd() * 0.4, (u - 0.5) * 1.3 + (rnd() - 0.5) * 0.3, 0.035));
    }
    add('dunegrass', [0.14, 0.26], 1.1, 0.09, [[bl, [0xd5cc86, 0xc8c278, 0xbdbb6f, 0xdcd396]]]);
  }
  // 蕨：三片往外散开的羽状叶。
  {
    const fr: Pts[] = [frond(-0.04, 0.8, -0.45, 0.16), frond(0.04, 0.85, 0.45, 0.16), frond(0, 1, 0.05, 0.18)];
    add('fern', [0.18, 0.3], 1.1, 0.05, [[fr, [0x5c8f3e, 0x689b45, 0x4f8238]]]);
  }
  // 香蒲（水塘边）：长剑叶 + 褐色的棒。
  {
    const bl: Pts[] = [];
    const hd: Pts[] = [];
    for (let i = 0; i < 6; i++) bl.push(blade((i - 2.5) * 0.04, 0.7 + rnd() * 0.3, (i - 2.5) * 0.08, 0.03));
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.08;
      bl.push(stem(0, x, 1.05 + i * 0.05, 0.007));
      hd.push(ellipse(x, 0.86 + i * 0.05, 0.03, 0.11));
    }
    add('cattail', [0.3, 0.45], 0.5, 0.06, [
      [bl, [0x7f9f4f, 0x8aa957]],
      [hd, [0x7a5232, 0x6c4a2e]],
    ]);
  }
  // 圆灌丛：前后三张叶团，后面深、前面亮。
  add('shrub', [0.32, 0.55], 1.25, 0.012, [
    [[canopy(0, 0, 1, 0.78, 6, 5)], [0x3b6b3c, 0x416f3e, 0x365f37], 0],
    [[canopy(0.08, 0, 0.78, 0.6, 5, 9)], [0x55893f, 0x5e9445, 0x4f7f3c], 2],
    [[canopy(-0.12, 0, 0.5, 0.38, 4, 13)], [0x7fb053, 0x8aba5a, 0x76a64d], 4],
  ]);
  // 结红果的灌丛。
  {
    const dots: Pts[] = [];
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI;
      const r = 0.15 + rnd() * 0.3;
      dots.push(circle(Math.cos(a) * r, 0.12 + Math.sin(a) * r * 0.9, 0.025 + rnd() * 0.012, 10));
    }
    add('berry', [0.28, 0.42], 1.15, 0.012, [
      [[canopy(0, 0, 1, 0.8, 7, 21)], [0x3f6a3a, 0x46733f], 0],
      [[canopy(0.06, 0, 0.7, 0.58, 6, 23)], [0x5a8a44, 0x64944a], 2],
      [dots, [0xc8402e, 0xd5532f, 0xb8352a], 4],
    ]);
  }
  // 荆豆：尖刺的深绿剪影 + 一点点黄花。
  {
    const dots: Pts[] = [];
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI;
      const r = 0.1 + rnd() * 0.35;
      dots.push(petals(Math.cos(a) * r, 0.1 + Math.sin(a) * r * 0.85, 0.035, 0.015, 5, rnd() * 3));
    }
    add('gorse', [0.28, 0.45], 1.2, 0.01, [
      [[spiky(0, 0, 1, 0.82, 31)], [0x355f34, 0x3c6838], 0],
      [[spiky(-0.05, 0, 0.7, 0.6, 33)], [0x4b7b3f, 0x52833f], 2],
      [dots, [0xf3c531, 0xf6d24a], 4],
    ]);
  }
  // 矮松：一层层的塔，带一截树干。
  add('pine', [0.5, 0.85], 0.55, 0.006, [
    [[stem(0, 0, 0.25, 0.05)], [0x6b4a33, 0x5e412e], 0],
    [[tiers(0, 1, 0.9, 4, 0.12)], [0x2f5a3a, 0x355f3c, 0x2b5235], 1],
    [[tiers(0.03, 0.72, 0.68, 3, 0.16)], [0x427349, 0x4a7b4c], 3],
  ]);
  // 圆冠的小树。
  add('tree', [0.6, 0.95], 0.85, 0.008, [
    [[stem(0, 0.02, 0.45, 0.045), stem(0, -0.18, 0.55, 0.018), stem(0.02, 0.2, 0.6, 0.016)], [0x6b4a33, 0x5e412e], 0],
    [[canopy(0, 0.38, 1, 0.5, 7, 41, false)], [0x3e6e3e, 0x467641], 1],
    [[canopy(0.1, 0.42, 0.75, 0.42, 6, 43, false)], [0x5d9145, 0x67994b], 3],
    [[canopy(-0.14, 0.48, 0.45, 0.28, 5, 47, false)], [0x86b65a, 0x8fbf60], 5],
  ]);
  // 海边的石头：两张灰色的纸叠着。
  add('rock', [0.1, 0.2], 1.8, 0, [
    [[canopy(0, 0, 1, 0.7, 3, 51)], [0x9a978e, 0x8a877f, 0xa6a296], 0],
    [[canopy(0.12, 0, 0.6, 0.42, 3, 53)], [0xb5b1a5, 0xc0bcb0], 2],
  ]);
  return new Map(kinds.map((k) => [k.id, k]));
}
