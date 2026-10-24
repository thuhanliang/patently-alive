import type { Graphics } from 'pixi.js';
import { BRAD, RIM } from '../paper/tokens';
import { lerpColor } from '../palette';
import type { BodyPlan } from './plan';

/**
 * 纸偶的零件（代码画的占位）：每个函数在一片零件自己的坐标里画好它，转轴（铆钉）在原点，骨头朝 +x。
 * 纸偶（puppet.ts）和零件参考图（src/proto/partsheet，给美术当参考）用的是同一套画法：
 * 参考图上每片零件的形状和铆钉位置，就是以后正式素材要对上的形状和转轴（handoff/007）。
 *
 * 单位：头体长 = 100。
 */

export interface Look {
  main: number;
  dark: number;
  light: number;
}

export function lookOf(color: number): Look {
  return { main: color, dark: lerpColor(color, 0x1a1410, 0.35), light: lerpColor(color, 0xfaf3e6, 0.62) };
}

/** 零件参考图用的中性纸色：正式零件是这种浅色纸，颜色和花纹由代码叠上去。 */
export const NEUTRAL: Look = { main: 0xe6d8bd, dark: 0xe6d8bd, light: 0xf0e6d2 };

export const HORN = 0x4a4038;
export const BILL = 0xc9a25a;
export const CLAW = 0x2c2622;
const TOOTH = 0xf4ecd8;
const INCISOR = 0xd9822b;
const TAU = Math.PI * 2;
const B = 100;

/** 体表的边：短毛光滑，厚绒毛毛茸茸的锯齿，羽毛一片片的圆齿。 */
export type Edge = 'smooth' | 'fur' | 'feather';
export const edgeOf = (coat: string): Edge => (coat === 'dense_fur' ? 'fur' : coat === 'feathers' ? 'feather' : 'smooth');

export const RIM_W = 3.2;
export const BRAD_R = 1.6;
export const BEAKS: readonly string[] = ['seed_beak', 'probe_bill', 'hooked_beak', 'stout_bill'];

export class Pen {
  constructor(
    readonly g: Graphics,
    readonly edge: Edge,
    readonly rim = RIM_W,
  ) {}

  /** 一片纸：path(grow) 画出轮廓，先按 grow = 白边宽度填白，再按 0 填本色。 */
  piece(path: (e: number) => void, color: number, rim = true): void {
    if (rim) {
      path(this.rim);
      this.g.fill(RIM);
    }
    path(0);
    this.g.fill(color);
  }

  /** 椭圆的纸片，边按体表起伏；rot 是椭圆自己的转角。 */
  blob(cx: number, cy: number, rx: number, ry: number, color: number, opts: { rot?: number; edge?: Edge; rim?: boolean } = {}): void {
    const edge = opts.edge ?? this.edge;
    const rot = opts.rot ?? 0;
    const n = 48;
    const amp = Math.min(rx, ry) * (edge === 'fur' ? 0.09 : edge === 'feather' ? 0.07 : 0);
    this.piece((e) => {
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU;
        const tooth = edge === 'fur' ? Math.abs(((i * 3) % 6) / 3 - 1) : edge === 'feather' ? Math.abs(Math.sin(t * 7)) : 0;
        const k = 1 + (amp / Math.min(rx, ry)) * tooth;
        const x = (rx * k + e) * Math.cos(t);
        const y = (ry * k + e) * Math.sin(t);
        pts.push(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot));
      }
      this.g.poly(pts);
    }, color, opts.rim ?? true);
  }

  /** 沿 +x 的一节（骨头）：从 0 到 len，粗细从 w0 渐变到 w1，两头圆（关节处的圆头和搭接片）。 */
  capsule(len: number, w0: number, w1: number, color: number): void {
    this.piece((e) => {
      const r0 = w0 / 2 + e;
      const r1 = w1 / 2 + e;
      const pts: number[] = [];
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const t = Math.PI / 2 + (i / n) * Math.PI;
        pts.push(r0 * Math.cos(t), r0 * Math.sin(t));
      }
      for (let i = 0; i <= n; i++) {
        const t = -Math.PI / 2 + (i / n) * Math.PI;
        pts.push(len + r1 * Math.cos(t), r1 * Math.sin(t));
      }
      this.g.poly(pts);
    }, color);
  }

  poly(pts: number[], color: number, rim = true): void {
    // 多边形的白边：按重心往外放大一点。
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i += 2) {
      cx += pts[i]!;
      cy += pts[i + 1]!;
    }
    cx /= pts.length / 2;
    cy /= pts.length / 2;
    this.piece((e) => {
      this.g.poly(
        pts.map((v, i) => {
          const c = i % 2 === 0 ? cx : cy;
          const d = v - c;
          const other = i % 2 === 0 ? pts[i + 1]! - cy : pts[i - 1]! - cx;
          const len = Math.hypot(d, other) || 1;
          return v + (d / len) * e;
        }),
      );
    }, color, rim);
  }

  dot(x: number, y: number, r: number, color: number): void {
    this.g.circle(x, y, r).fill(color);
  }
}

/** 关节的金色铆钉（转轴），画在 (x, y)。 */
export function brad(g: Graphics, x = 0, y = 0): void {
  g.circle(x, y, BRAD_R).fill(BRAD);
}

/** 画零件要的上下文：身材、颜色、米 → 单位的倍数、体表的边。 */
export interface PartCtx {
  plan: BodyPlan;
  look: Look;
  /** 米 → 单位（头体长 = 100）。 */
  k: number;
  edge: Edge;
}

export function partCtx(plan: BodyPlan, look: Look): PartCtx {
  return { plan, look, k: 100 / plan.bodyLen, edge: edgeOf(plan.parts.coat) };
}

/** 零件之间的挂点（父零件坐标里，PixiJS 的 y 朝下）。 */
export interface Anchors {
  /** 躯干：髋到脊背中间铆钉的距离、中间铆钉到肩的距离。 */
  midLocal: number;
  rest: number;
  hindH: number;
  chestH: number;
  /** 尾根（臀片坐标）、颈根（胸片坐标）、头（颈坐标）、下颌和两只耳朵（头坐标）。 */
  tailRoot: [number, number];
  neckRoot: [number, number];
  head: [number, number];
  jaw: [number, number];
  farEar: [number, number];
  nearEar: [number, number];
  /** 尾巴每节的长度。 */
  tailSegL: number;
}

export function anchors(c: PartCtx): Anchors {
  const { plan, k } = c;
  const midLocal = (plan.shoulderX - plan.hipX) * 0.45 * k;
  const rest = (plan.shoulderX - plan.hipX) * k - midLocal;
  const hindH = plan.hindH * k;
  const chestH = plan.chestH * k;
  const hr = plan.headR * k;
  return {
    midLocal,
    rest,
    hindH,
    chestH,
    tailRoot: [-midLocal - 0.17 * B, -0.35 * hindH],
    neckRoot: [rest + 0.12 * B, -0.4 * chestH],
    head: [plan.neckLen * k, 0],
    jaw: [0.25 * hr, 0.3 * hr],
    farEar: [-0.15 * hr, -0.65 * hr],
    nearEar: [0.12 * hr, -0.72 * hr],
    tailSegL: (plan.tailLen * k) / plan.tailSegs,
  };
}

const slimOf = (limb: string): number => (limb === 'running_legs' ? 0.82 : limb === 'short_legs' ? 1.2 : 1);

/** 腿的一节：i = 0 大腿（上臂），1 小腿（前臂），2 跖（掌）连脚掌。转轴在近端。 */
export function drawLegSegment(g: Graphics, c: PartCtx, hind: boolean, i: 0 | 1 | 2): void {
  const { plan, look, k } = c;
  const slim = slimOf(plan.parts.limbs);
  const segLen = (hind ? plan.hindSegs : plan.foreSegs)[i] * k;
  const w = plan.legW * k * slim;
  const widths: [number, number][] = [
    [plan.thighW * k * slim * (hind ? 1.15 : 0.95), w],
    [w, w * 0.82],
    [w * 0.8, w * 0.7],
  ];
  const p = new Pen(g, 'smooth');
  p.capsule(segLen, widths[i]![0], widths[i]![1], look.main);
  if (i === 2) drawPaw(p, plan.parts.limbs, segLen, w, hind, look);
  brad(g);
}

/** 脚掌：按腿型部件换剪影。在第三节的末端。 */
function drawPaw(p: Pen, limb: string, len: number, w: number, hind: boolean, look: Look): void {
  if (limb === 'digging_claws' && !hind) {
    // 掘土爪：宽大的前掌，三根长而直的爪。
    p.blob(len, 0, w * 0.9, w * 0.75, look.main, { rim: true });
    for (const a of [-0.5, 0, 0.5]) {
      const ax = len + w * 0.6 * Math.cos(a + Math.PI / 2);
      p.g.poly([ax - w * 0.12, w * 0.5, ax + w * 0.12, w * 0.5, ax + w * 0.05 + w * 0.6, w * 1.35]).fill(BILL);
    }
    return;
  }
  p.blob(len, 0, w * 0.62, w * 0.5, look.main, { rim: false });
  if (limb === 'climbing_claws' || limb === 'digging_claws') {
    // 攀爬钩爪：三根弯钩。
    for (const dx of [-0.25, 0.05, 0.35]) {
      const x = len + dx * w;
      p.g.poly([x - w * 0.1, w * 0.35, x + w * 0.1, w * 0.35, x + w * 0.42, w * 0.62, x + w * 0.05, w * 0.55]).fill(CLAW);
    }
  }
}

/** 尾巴的第 i 节，转轴在近端。 */
export function drawTailSegment(g: Graphics, c: PartCtx, i: number): void {
  const { plan, look, k, edge } = c;
  const nSeg = plan.tailSegs;
  const segL = (plan.tailLen * k) / nSeg;
  const tw = plan.tailW * k;
  const p = new Pen(g, plan.parts.tail === 'bushy_tail' ? 'fur' : edge);
  const taper = plan.parts.tail === 'balance_tail' ? 1 - (i / nSeg) * 0.6 : 1 - (i / nSeg) * 0.25;
  if (nSeg === 1) p.blob(segL * 0.35, 0, Math.max(segL * 0.6, tw * 0.7), tw * 0.7, plan.parts.coat === 'feathers' ? look.dark : look.light);
  else p.blob(segL * 0.5, 0, segL * 0.62, (tw / 2) * taper, i === nSeg - 1 && plan.parts.tail === 'bushy_tail' ? look.light : look.main);
  brad(g);
}

/** 臀片（带肚子）：转轴是脊背中间的铆钉。 */
export function drawHind(g: Graphics, c: PartCtx): void {
  const { plan, look, k, edge } = c;
  const a = anchors(c);
  const p = new Pen(g, edge);
  p.blob(0.04 * B, 0.42 * a.chestH, 0.27 * B, plan.belly * k + 0.35 * a.chestH, look.light);
  p.blob(-a.midLocal + 0.04 * B, -0.15 * a.hindH, 0.24 * B, a.hindH, look.main);
}

/** 胸片：和臀片共用脊背中间的铆钉。 */
export function drawChest(g: Graphics, c: PartCtx): void {
  const a = anchors(c);
  new Pen(g, c.edge).blob(a.rest - 0.1 * B, -0.1 * a.chestH, 0.3 * B, a.chestH, c.look.main);
  brad(g);
}

/** 颈：转轴在颈根（胸片上）。 */
export function drawNeck(g: Graphics, c: PartCtx): void {
  const { plan, k } = c;
  new Pen(g, c.edge).capsule(plan.neckLen * k, plan.neckW * k, plan.neckW * k * 0.7, c.look.main);
  brad(g);
}

/** 头（连上吻或上喙、眼、鼻）：转轴在头颈之间。 */
export function drawHead(g: Graphics, c: PartCtx): void {
  const { plan, look, k } = c;
  const hr = plan.headR * k;
  const sn = plan.snout * k;
  const p = new Pen(g, c.edge);
  p.blob(0.15 * hr, 0, hr, hr * 0.86, look.main);
  drawMouthUpper(new Pen(g, 'smooth'), plan.parts.mouth, hr, sn, look);
  p.dot(0.5 * hr, -0.22 * hr, Math.max(1.2, 0.11 * hr), 0x141414);
  p.dot(0.56 * hr, -0.26 * hr, Math.max(0.4, 0.035 * hr), 0xf4f1ea);
  brad(g);
}

/** 下颌（或下喙）：转轴在颌关节。 */
export function drawJaw(g: Graphics, c: PartCtx): void {
  const { plan, look, k } = c;
  const hr = plan.headR * k;
  const sn = plan.snout * k;
  const p = new Pen(g, 'smooth');
  if (BEAKS.includes(plan.parts.mouth)) {
    const m = plan.parts.mouth;
    p.poly([0.4 * hr, -0.1 * hr, 0.55 * hr + sn * 0.95, -0.15 * hr, 0.4 * hr, 0.12 * hr], m === 'seed_beak' || m === 'stout_bill' ? BILL : HORN);
  } else p.blob(0.3 * hr + sn * 0.45, 0.05 * hr, 0.35 * hr + sn * 0.45, 0.2 * hr, look.light);
  brad(g);
}

/** 耳朵：转轴在耳根。远侧的一只用深色。 */
export function drawEar(g: Graphics, c: PartCtx, far: boolean): void {
  const { plan, look, k } = c;
  const hr = plan.headR * k;
  const eh = plan.earH * k;
  // 耳根往下多留一截，铆钉落在纸片里面。
  new Pen(g, 'smooth').poly([-0.34 * hr, 0.16 * hr, -0.05 * hr, -eh, 0.32 * hr, 0.16 * hr], far ? look.dark : look.main);
  brad(g);
}

function drawMouthUpper(p: Pen, m: string, hr: number, sn: number, look: Look): void {
  if (BEAKS.includes(m)) {
    const h = m === 'stout_bill' ? 0.42 : m === 'probe_bill' ? 0.16 : 0.3;
    const tipY = m === 'hooked_beak' ? 0.38 * hr : 0.05 * hr;
    p.poly([0.75 * hr, -h * hr, 0.85 * hr + sn, tipY, 0.75 * hr, 0.12 * hr], m === 'seed_beak' || m === 'stout_bill' ? BILL : HORN);
    return;
  }
  p.blob(0.62 * hr + sn * 0.5, 0.05 * hr, 0.42 * hr + sn * 0.5, 0.42 * hr * (sn > hr ? 0.75 : 1), look.light, { rot: 0.12 });
  p.dot(0.95 * hr + sn, -0.08 * hr, Math.max(0.8, 0.09 * hr), 0x3a2a2a);
  if (m === 'gnawing_incisors') p.g.rect(0.82 * hr + sn, 0.3 * hr, 0.12 * hr, 0.26 * hr).fill(INCISOR);
  if (m === 'carnassials') p.g.poly([0.7 * hr + sn, 0.36 * hr, 0.8 * hr + sn, 0.36 * hr, 0.74 * hr + sn, 0.58 * hr]).fill(TOOTH);
}
