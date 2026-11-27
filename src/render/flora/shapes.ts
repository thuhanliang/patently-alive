/**
 * 剪纸植物的形状（2026-11-27，用户：植物千篇一律就几个不知道是什么的草，要有真实依据、有区域特点）。
 *
 * 每种植物是几层单色的纸（美术规定：每层一张单色纸，立起来正对镜头），一层是一组多边形。
 * 形状按"生长型"生成：同一个生长型（扇形丛、绒球树、伞冠树……）靠参数长出不同的种，每一株再按种子有一点变化。
 * 坐标：脚在原点，y 朝上，单位是米（真实高度），所以不同的种放在一起比例是对的。
 * 只管形状，不管画到哪个渲染器上（三维剧场、地图、图鉴页都从这里取）。
 * 哪个种长什么样、长在哪、几月开花，写在 src/data/plants/flora.json。
 */

export type Pts = number[];

/** 一层纸：一种颜色（调色板里的名字，见 FloraLook）、一组多边形。 */
export interface Sheet {
  color: string;
  polys: Pts[];
}

/** 一株植物：几层纸，从后往前。 */
export interface PlantCut {
  sheets: Sheet[];
  /** 包围盒（米），给摆放和裁切用。 */
  width: number;
  height: number;
}

/** 生长型的参数（flora.json 的 look）。 */
export interface FloraLook {
  form: Form;
  /** 成熟的高度（米）。 */
  height: number;
  /** 宽 ÷ 高。 */
  aspect: number;
  /** 颜色：叶、深一档的叶、茎干、花、果（调色板的十六进制）。 */
  leaf: string;
  leafDark: string;
  stem: string;
  flower?: string;
  fruit?: string;
  /** 叶（或叶丛）的数量感：0–1。 */
  density?: number;
}

export type Form =
  | 'fan' // 扇形丛：新西兰麻（harakeke）
  | 'pompom' // 绒球树：朱蕉（tī kōuka）
  | 'canopy' // 伞冠树：新西兰圣诞树（pōhutukawa）、卡拉卡
  | 'fineShrub' // 细叶灌木：麦卢卡、卡努卡
  | 'broadShrub' // 阔叶灌木：taupata、kawakawa
  | 'tussock' // 丛生禾草：银丛草
  | 'sedge' // 莎草、灯心草状：pīngao、wīwī
  | 'spinifex' // 沙丘上的匍匐禾草，带球形的穗
  | 'bracken' // 蕨（欧洲蕨类）：三角形的叶
  | 'treeFern' // 树蕨：ponga
  | 'palm' // 棕榈：nīkau
  | 'vineMat' // 铺在地上和灌丛上的藤：pōhuehue
  | 'reed' // 香蒲：raupō
  | 'gorse' // 荆豆：多刺的丘
  | 'pasture' // 牧草：低矮的草皮
  | 'megaherb'; // 巨型草本：麦夸里岛的 Stilbocarpa

/** 带种子的随机数（每一株不同，同一株每次一样）。 */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
}

/** 一片弯的带状叶：从 (x0, y0) 出发，方向 ang（弧度，0 朝上），长 len，最宽 w，往一边弯 bend（弧度）。 */
export function strap(x0: number, y0: number, ang: number, len: number, w: number, bend: number, tipRound = 0.15, n = 10): Pts {
  const left: Pts = [];
  const right: Pts = [];
  let x = x0;
  let y = y0;
  let a = ang;
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // 叶宽：根部窄一点，中段最宽，尖端收尖（tipRound 越大尖越钝）。
    const half = (w / 2) * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)) ** (1 - tipRound) * (t < 0.1 ? 0.6 + 4 * t : 1);
    const nx = Math.cos(a);
    const ny = -Math.sin(a);
    left.push(x - nx * half, y - ny * half);
    right.push(x + nx * half, y + ny * half);
    x += Math.sin(a) * step;
    y += Math.cos(a) * step;
    a += bend / n;
  }
  const out: Pts = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i]!, right[i + 1]!);
  return out;
}

/** 有起伏的团块（树冠、灌丛）：中心 (cx, cy)，半径 rx、ry，边上 k 个圆鼓包。 */
export function lumpy(cx: number, cy: number, rx: number, ry: number, k: number, bump: number, r: () => number, flatBottom = 0): Pts {
  const out: Pts = [];
  const N = k * 8;
  const phase = r() * Math.PI * 2;
  const amp = Array.from({ length: k }, () => 0.6 + r() * 0.8);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const j = Math.floor(i / 8);
    const u = (i % 8) / 8;
    const b = 1 + bump * amp[j]! * Math.sin(Math.PI * u);
    let y = cy + Math.sin(a + phase * 0) * ry * b;
    if (flatBottom > 0 && y < cy - ry * (1 - flatBottom)) y = cy - ry * (1 - flatBottom);
    out.push(cx + Math.cos(a) * rx * b, y);
  }
  void phase;
  return out;
}

export function circle(cx: number, cy: number, rad: number, n = 12): Pts {
  const out: Pts = [];
  for (let i = 0; i < n; i++) out.push(cx + Math.cos((i / n) * Math.PI * 2) * rad, cy + Math.sin((i / n) * Math.PI * 2) * rad);
  return out;
}

/** 一根有粗细的弯枝：沿点列 pts（[x, y]…），根部粗 w0、梢 w1。 */
export function limb(pts: Array<[number, number]>, w0: number, w1: number): Pts {
  const left: Pts = [];
  const right: Pts = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const q = pts[Math.min(n - 1, i + 1)]!;
    const o = pts[Math.max(0, i - 1)]!;
    const dx = q[0] - o[0];
    const dy = q[1] - o[1];
    const m = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push(p[0] - (dy / m) * w, p[1] + (dx / m) * w);
    right.push(p[0] + (dy / m) * w, p[1] - (dx / m) * w);
  }
  const out: Pts = [...left];
  for (let i = right.length - 2; i >= 0; i -= 2) out.push(right[i]!, right[i + 1]!);
  return out;
}

/** 一株植物（米）。flower、fruit：这个月开不开花、挂不挂果（0–1，按 flora.json 的月份算好再给）。 */
export function cutPlant(look: FloraLook, seed: number, flower = 0, fruit = 0): PlantCut {
  const r = rng(seed);
  const H = look.height * (0.75 + r() * 0.5);
  const W = H * look.aspect * (0.85 + r() * 0.3);
  const d = look.density ?? 0.5;
  const back: Pts[] = [];
  const front: Pts[] = [];
  const stem: Pts[] = [];
  const flw: Pts[] = [];
  const frt: Pts[] = [];
  const S = (color: string, polys: Pts[]): Sheet => ({ color, polys });
  switch (look.form) {
    case 'fan': {
      // 新西兰麻：十几片硬挺的带状叶从根部扇形张开，外圈的叶尖往下垂；夏天抽出比叶高的花茎。
      const n = Math.round(10 + d * 10);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        const len = H * (0.7 + 0.3 * (1 - Math.abs(t) * 1.6) + r() * 0.1);
        const leafW = W * 0.06;
        const sheet = Math.abs(t) > 0.25 ? back : front;
        sheet.push(strap(t * W * 0.08, 0, t * 1.7, len, leafW, t * 1.2 + (r() - 0.5) * 0.2, 0.05));
      }
      if (flower > 0 || fruit > 0) {
        for (let k = 0; k < 2; k++) {
          const x = (k - 0.5) * W * 0.12;
          const top = H * (1.35 + r() * 0.3);
          stem.push(limb([[x, 0], [x + 0.02, top * 0.5], [x - 0.02, top]], 0.05, 0.02));
          for (let j = 0; j < 6; j++) {
            const y = top * (0.6 + j * 0.07);
            const side = j % 2 ? 1 : -1;
            (flower > 0 ? flw : frt).push(strap(x, y, side * 1.1, H * 0.09, H * 0.035, -side * 0.6, 0.3, 5));
          }
        }
      }
      break;
    }
    case 'pompom': {
      // 朱蕉：细长的树干分两三次叉，每个枝梢一团放射状的细长叶；初夏一大串奶油色的小花。
      const tips: Array<[number, number]> = [];
      const grow = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
        const ex = x + Math.sin(a) * len;
        const ey = y + Math.cos(a) * len;
        stem.push(limb([[x, y], [(x + ex) / 2 + (r() - 0.5) * len * 0.08, (y + ey) / 2], [ex, ey]], w, w * 0.8));
        if (depth > 0 && r() < 0.85) {
          const sp = 0.35 + r() * 0.25;
          grow(ex, ey, a - sp, len * 0.5, w * 0.75, depth - 1);
          grow(ex, ey, a + sp, len * 0.5, w * 0.75, depth - 1);
        } else tips.push([ex, ey]);
      };
      grow(0, 0, (r() - 0.5) * 0.1, H * 0.55, H * 0.05, 2);
      for (const [x, y] of tips) {
        const k = 18;
        for (let i = 0; i < k; i++) {
          const a = (i / k) * Math.PI * 2;
          const len = H * (0.16 + r() * 0.05);
          // 下面一圈的老叶往下垂（真的朱蕉枝梢下面挂着一圈枯叶，这里用深一档的叶）。
          (Math.cos(a) < -0.3 ? back : front).push(strap(x, y, a, len, H * 0.018, Math.cos(a) < 0 ? 0.3 : 0, 0.02, 5));
        }
        if (flower > 0) flw.push(lumpy(x + H * 0.08, y + H * 0.08, H * 0.08, H * 0.12, 5, 0.25, r));
      }
      break;
    }
    case 'canopy': {
      // 伞冠树：粗短、扭曲的树干，分成几根大枝；树冠是几团连在一起的半圆，比高更宽；开花时冠面上一片片红。
      const n = 3 + Math.round(r() * 2);
      const crownY = H * 0.55;
      stem.push(limb([[0, 0], [W * 0.03, H * 0.2], [-W * 0.02, H * 0.35]], H * 0.12, H * 0.08));
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1) - 0.5;
        stem.push(limb([[-W * 0.02, H * 0.35], [t * W * 0.25, H * 0.48], [t * W * 0.42, crownY]], H * 0.06, H * 0.03));
      }
      for (let i = 0; i < 5; i++) {
        const t = i / 4 - 0.5;
        const cx = t * W * 0.7;
        const cy = crownY + H * (0.15 + 0.2 * (1 - Math.abs(t) * 1.5));
        (i % 2 ? back : front).push(lumpy(cx, cy, W * 0.2, H * 0.2, 6, 0.18, r, 0.4));
        if (flower > 0) for (let j = 0; j < 4; j++) flw.push(lumpy(cx + (r() - 0.5) * W * 0.25, cy + H * (0.05 + r() * 0.12), W * 0.05, H * 0.035, 4, 0.3, r));
        if (fruit > 0) for (let j = 0; j < 3; j++) frt.push(circle(cx + (r() - 0.5) * W * 0.3, cy + (r() - 0.6) * H * 0.15, H * 0.02, 8));
      }
      break;
    }
    case 'fineShrub': {
      // 细叶灌木：很多根细枝往上散开，冠是蓬松的小团；春天开满白色的小花。
      const n = 5 + Math.round(d * 4);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        const top: [number, number] = [t * W * 0.8, H * (0.6 + 0.3 * (1 - Math.abs(t)))];
        stem.push(limb([[t * W * 0.1, 0], [t * W * 0.4, top[1] * 0.5], top], H * 0.025, H * 0.01));
        (i % 2 ? back : front).push(lumpy(top[0], top[1], W * 0.17, H * 0.17, 7, 0.22, r));
        if (flower > 0) for (let j = 0; j < 5; j++) flw.push(circle(top[0] + (r() - 0.5) * W * 0.25, top[1] + (r() - 0.5) * H * 0.22, H * 0.018, 5));
      }
      break;
    }
    case 'broadShrub': {
      // 阔叶灌木：低矮的圆丘，由几团大叶叠起来；挂果时点缀几颗橙色的小果。
      for (let i = 0; i < 4; i++) {
        const t = i / 3 - 0.5;
        (i % 2 ? back : front).push(lumpy(t * W * 0.55, H * (0.4 + 0.18 * (1 - Math.abs(t) * 2)), W * 0.28, H * 0.38, 5, 0.3, r, 0.6));
      }
      if (fruit > 0) for (let j = 0; j < 8; j++) frt.push(circle((r() - 0.5) * W * 0.8, H * (0.3 + r() * 0.5), H * 0.03, 8));
      break;
    }
    case 'tussock': {
      // 丛生禾草：一大把细叶从根部喷泉一样拱出去，叶尖垂到地面附近。
      const n = Math.round(24 + d * 20);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        const a = t * 2.2 + (r() - 0.5) * 0.15;
        (Math.abs(t) > 0.3 ? back : front).push(strap(t * W * 0.15, 0, a * 0.6, H * (0.85 + r() * 0.35), H * 0.035, a * 0.9, 0, 6));
      }
      if (flower > 0) for (let k = 0; k < 4; k++) flw.push(strap((r() - 0.5) * W * 0.3, 0, (r() - 0.5) * 0.4, H * 1.4, H * 0.025, (r() - 0.5) * 0.3, 0.5, 6));
      break;
    }
    case 'sedge': {
      // 莎草：硬挺的细茎，几乎直立，稍往外张；pīngao 是金黄色的。
      const n = Math.round(14 + d * 14);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        (i % 3 === 0 ? back : front).push(strap(t * W * 0.25, 0, t * 0.9, H * (0.8 + r() * 0.3), H * 0.035, t * 0.5, 0, 5));
      }
      if (flower > 0) for (let k = 0; k < 5; k++) flw.push(circle((r() - 0.5) * W * 0.6, H * (0.7 + r() * 0.25), H * 0.04, 7));
      break;
    }
    case 'spinifex': {
      // 鬣刺：沙丘前缘贴地爬的银绿色禾草，雌株结一个个球形的、长刺的穗，被风吹着在沙滩上滚。
      for (let i = 0; i < 10; i++) {
        const x = (r() - 0.5) * W;
        front.push(strap(x, 0, (r() - 0.5) * 1.2, H * (0.6 + r() * 0.5), H * 0.05, (r() - 0.5) * 0.8, 0, 5));
      }
      if (fruit > 0 || flower > 0) {
        for (let k = 0; k < 3; k++) {
          const cx = (r() - 0.5) * W * 0.8;
          const cy = H * (0.5 + r() * 0.4);
          for (let j = 0; j < 12; j++) {
            const a = (j / 12) * Math.PI * 2;
            flw.push(strap(cx, cy, a, H * 0.22, H * 0.02, 0, 0, 3));
          }
        }
      }
      break;
    }
    case 'bracken': {
      // 蕨：一片片三角形的大叶，叶柄长，叶面是层层的小羽片（用锯齿边表示）。
      for (let i = 0; i < 4; i++) {
        const x = (r() - 0.5) * W * 0.6;
        const top = H * (0.7 + r() * 0.3);
        stem.push(limb([[x, 0], [x, top * 0.45]], H * 0.02, H * 0.015));
        const fr: Pts = [];
        const steps = 10;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const y = top * (0.45 + 0.55 * t);
          const half = W * 0.35 * (1 - t) * (k % 2 ? 1 : 0.8);
          fr.push(x + half, y);
        }
        for (let k = steps; k >= 0; k--) {
          const t = k / steps;
          const y = top * (0.45 + 0.55 * t);
          const half = W * 0.35 * (1 - t) * (k % 2 ? 1 : 0.8);
          fr.push(x - half, y);
        }
        (i % 2 ? back : front).push(fr);
      }
      break;
    }
    case 'treeFern': {
      // 树蕨：一根直立的毛干，顶上一圈拱出去的大叶（银蕨的叶背是银白的，侧面看露出一点）。
      const top = H * 0.62;
      stem.push(limb([[0, 0], [0.02 * H, top * 0.5], [0, top]], H * 0.07, H * 0.06));
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        const a = t * 2.6;
        const len = H * (0.42 + r() * 0.08);
        (Math.abs(t) > 0.3 ? back : front).push(strap(0, top, a * 0.8, len, H * 0.08, a * 0.6, 0, 9));
        if (Math.abs(t) > 0.35) flw.push(strap(0, top, a * 0.8, len * 0.95, H * 0.03, a * 0.6, 0, 9));
      }
      break;
    }
    case 'palm': {
      // 尼考棕：光滑的灰绿色细干，有一圈圈叶痕；叶鞘包成一节鼓起的绿色"冠茎"，上面几片硬挺、斜向上的羽状叶。
      const top = H * 0.72;
      stem.push(limb([[0, 0], [0, top]], H * 0.06, H * 0.05));
      back.push(limb([[0, top], [0, top + H * 0.1]], H * 0.075, H * 0.06));
      for (let i = 0; i < 7; i++) {
        const t = i / 6 - 0.5;
        const len = H * 0.38;
        front.push(strap(0, top + H * 0.09, t * 1.8, len, H * 0.1, t * 0.5, 0, 8));
      }
      if (flower > 0 || fruit > 0) frt.push(lumpy(0, top - H * 0.02, H * 0.06, H * 0.04, 5, 0.3, r));
      break;
    }
    case 'vineMat': {
      // 藤：一层细密、缠在一起的铁丝一样的枝，上面是许多小圆叶，铺在地上或盖在别的灌丛上。
      for (let i = 0; i < 6; i++) front.push(lumpy((r() - 0.5) * W * 0.8, H * (0.3 + r() * 0.4), W * 0.18, H * 0.3, 6, 0.35, r, 0.5));
      for (let i = 0; i < 14; i++) {
        const x = (r() - 0.5) * W;
        stem.push(limb([[x, 0], [x + (r() - 0.5) * W * 0.2, H * 0.5], [x + (r() - 0.5) * W * 0.3, H * (0.7 + r() * 0.3)]], H * 0.012, H * 0.008));
      }
      break;
    }
    case 'reed': {
      // 香蒲：一丛又高又直的带状叶，夏天顶着褐色的"蜡烛"花穗。
      for (let i = 0; i < 9; i++) {
        const t = i / 8 - 0.5;
        (i % 2 ? back : front).push(strap(t * W * 0.4, 0, t * 0.35, H * (0.85 + r() * 0.2), H * 0.035, t * 0.2, 0, 6));
      }
      if (flower > 0 || fruit > 0)
        for (let k = 0; k < 3; k++) {
          const x = (k - 1) * W * 0.15;
          stem.push(limb([[x, 0], [x, H * 1.05]], H * 0.012, H * 0.01));
          frt.push(limb([[x, H * 0.82], [x, H * 0.98]], H * 0.05, H * 0.05));
        }
      break;
    }
    case 'gorse': {
      // 荆豆：一个深绿色、表面全是刺的圆丘（边上一圈细刺），开花时金黄一片。
      for (let i = 0; i < 3; i++) {
        const t = i / 2 - 0.5;
        const p = lumpy(t * W * 0.45, H * 0.45, W * 0.3, H * 0.45, 14, 0.12, r, 0.7);
        (i === 1 ? front : back).push(p);
      }
      if (flower > 0) for (let j = 0; j < 22; j++) flw.push(circle((r() - 0.5) * W * 0.9, H * (0.2 + r() * 0.7), H * 0.03, 6));
      break;
    }
    case 'pasture': {
      // 牧草：低矮、密的一丛丛细叶。
      for (let i = 0; i < 16; i++) {
        const t = i / 15 - 0.5;
        (i % 2 ? back : front).push(strap(t * W * 0.8, 0, t * 0.8 + (r() - 0.5) * 0.3, H * (0.6 + r() * 0.5), H * 0.06, (r() - 0.5) * 0.5, 0, 4));
      }
      if (flower > 0) for (let k = 0; k < 3; k++) flw.push(strap((r() - 0.5) * W * 0.6, 0, (r() - 0.5) * 0.5, H * 1.5, H * 0.05, 0, 0.6, 5));
      break;
    }
    case 'megaherb': {
      // 巨型草本：几片又大又圆、皱的叶，从地面摊开，像一把把绿伞；Stilbocarpa 夏天开一团团奶油色的花。
      for (let i = 0; i < 6; i++) {
        const t = i / 5 - 0.5;
        stem.push(limb([[t * W * 0.1, 0], [t * W * 0.5, H * (0.45 + 0.3 * (1 - Math.abs(t)))]], H * 0.05, H * 0.04));
        (i % 2 ? back : front).push(lumpy(t * W * 0.55, H * (0.5 + 0.3 * (1 - Math.abs(t))), W * 0.2, H * 0.17, 7, 0.12, r));
      }
      if (flower > 0) for (let k = 0; k < 3; k++) flw.push(lumpy((r() - 0.5) * W * 0.4, H * (0.85 + r() * 0.15), H * 0.09, H * 0.07, 5, 0.3, r));
      break;
    }
  }
  const sheets: Sheet[] = [S(look.leafDark, back), S(look.stem, stem), S(look.leaf, front)];
  if (frt.length) sheets.push(S(look.fruit ?? look.leafDark, frt));
  if (flw.length) sheets.push(S(look.flower ?? '#f4efe2', flw));
  // 包围盒。
  let maxX = 0;
  let maxY = 0;
  for (const s of sheets)
    for (const p of s.polys)
      for (let i = 0; i < p.length; i += 2) {
        maxX = Math.max(maxX, Math.abs(p[i]!));
        maxY = Math.max(maxY, p[i + 1]!);
      }
  return { sheets: sheets.filter((s) => s.polys.length > 0), width: maxX * 2, height: maxY };
}
