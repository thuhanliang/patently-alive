import { Container, Graphics } from 'pixi.js';
import { BRAD, RIM } from '../paper/tokens';
import { lerpColor } from '../palette';
import { pendulumOmega, springStep, type Spring } from './gait';
import { LEGS, isHind, type BodyPlan, type LegKey } from './plan';
import { skeletonOf, type Pose, type Vec } from './pose';

/**
 * 剪纸纸偶（M1-1，代码画的占位零件）：每片纸挂在一根骨头上，绕关节的金色纸钉转。
 *
 * 和场景无关：给它身材（BodyPlan）和颜色，每帧给姿态（Pose），它就摆好。设计台用它，以后现场的近景、相机、纪录片也用它。
 * 画法沿用 drawPuppet：每片纸先画一圈略大的白边、再画本色，接缝处露出白边。
 * 画的先后：远侧的腿（调暗）→ 尾 → 臀 → 胸 → 颈 → 头 → 近侧的腿。
 *
 * 坐标：内部按"头体长 = 100 单位"画（小动物的圆也有足够的边数），view 的缩放由调用的人按每米多少像素设。
 * 原点在身体中点正下方的地面，朝右。
 */

export interface Look {
  main: number;
  dark: number;
  light: number;
}

export function lookOf(color: number): Look {
  return { main: color, dark: lerpColor(color, 0x1a1410, 0.35), light: lerpColor(color, 0xfaf3e6, 0.62) };
}

const HORN = 0x4a4038;
const BILL = 0xc9a25a;
const CLAW = 0x2c2622;
const TOOTH = 0xf4ecd8;
const INCISOR = 0xd9822b;
const TAU = Math.PI * 2;

/** 体表的边：短毛光滑，厚绒毛毛茸茸的锯齿，羽毛一片片的圆齿。 */
type Edge = 'smooth' | 'fur' | 'feather';
const edgeOf = (coat: string): Edge => (coat === 'dense_fur' ? 'fur' : coat === 'feathers' ? 'feather' : 'smooth');

/** 尾型：尾根往下垂多少（弧度）、每节往上卷多少、尾尖颜色深不深。只是画面。 */
const TAIL_STYLE: Record<string, { droop: number; curl: number }> = {
  balance_tail: { droop: 0.55, curl: -0.04 },
  bushy_tail: { droop: 0.4, curl: -0.1 },
  short_tail: { droop: -0.5, curl: 0 },
  fat_tail: { droop: 1.05, curl: 0.12 },
};

class Pen {
  constructor(
    readonly g: Graphics,
    readonly rim: number,
    readonly edge: Edge,
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

  /** 沿 +x 的一节（骨头）：从 0 到 len，粗细从 w0 渐变到 w1，两头圆。 */
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

interface LegParts {
  group: Container;
  segs: [Container, Container, Container];
}

/** 把 y 朝上的坐标放进 PixiJS（y 朝下）：位置 y 取反，角度取反。 */
function put(c: Container, p: Vec, k: number, angle: number): void {
  c.position.set(p.x * k, -p.y * k);
  c.rotation = -angle;
}

export class Puppet {
  readonly view = new Container();
  private plan!: BodyPlan;
  /** 米 → 内部单位。 */
  private k = 1;
  private legs = {} as Record<LegKey, LegParts>;
  private torso = new Container();
  private chest = new Container();
  private neck = new Container();
  private head = new Container();
  private jaw = new Container();
  private ears: Container[] = [];
  private tail: Container[] = [];
  private tailRest: { droop: number; curl: number } = { droop: 0.8, curl: 0.1 };
  private tailSprings: Spring[] = [];
  private earSprings: Spring[] = [];
  private lastHipY = 0;
  private lastHead = 0;
  private time = 0;

  constructor(plan: BodyPlan, look: Look) {
    this.build(plan, look);
  }

  /** 每米多少像素。 */
  setScale(pxPerM: number): void {
    this.view.scale.set(pxPerM / this.k);
  }

  build(plan: BodyPlan, look: Look): void {
    const scale = this.view.scale.x * this.k;
    for (const c of this.view.removeChildren()) c.destroy({ children: true });
    this.plan = plan;
    const k = (this.k = 100 / plan.bodyLen);
    this.view.scale.set(scale / k || 1);
    const edge = edgeOf(plan.parts.coat);
    const rim = 3.2;
    const pen = (g: Graphics, e: Edge = edge): Pen => new Pen(g, rim, e);
    const bradR = 1.6;
    const brad = (g: Graphics): void => void g.circle(0, 0, bradR).fill(BRAD);

    // 地上的影子。
    const shadow = new Graphics().ellipse(0, 0, 55, 5).fill({ color: 0x3a2a1a, alpha: 0.16 });
    this.view.addChild(shadow);

    // ---- 腿 ----
    const limb = plan.parts.limbs;
    const slim = limb === 'running_legs' ? 0.82 : limb === 'short_legs' ? 1.2 : 1;
    const makeLeg = (key: LegKey): LegParts => {
      const group = new Container();
      const hind = isHind(key);
      const segLen = (hind ? plan.hindSegs : plan.foreSegs).map((s) => s * k);
      const w = plan.legW * k * slim;
      const widths: [number, number][] = [
        [plan.thighW * k * slim * (hind ? 1.15 : 0.95), w],
        [w, w * 0.82],
        [w * 0.8, w * 0.7],
      ];
      const segs = [0, 1, 2].map((i) => {
        const c = new Container();
        const g = new Graphics();
        const p = pen(g, 'smooth');
        p.capsule(segLen[i]!, widths[i]![0], widths[i]![1], look.main);
        if (i === 2) this.paw(p, segLen[2]!, w, hind, look);
        brad(g);
        c.addChild(g);
        group.addChild(c);
        return c;
      }) as [Container, Container, Container];
      return { group, segs };
    };
    const far = new Container();
    far.tint = 0xc4bdb2;
    for (const key of ['farHind', 'farFore'] as const) {
      this.legs[key] = makeLeg(key);
      far.addChild(this.legs[key].group);
    }
    this.view.addChild(far);

    // ---- 躯干（臀片 + 胸片，绕脊背中间的纸钉转） ----
    this.torso = new Container();
    this.view.addChild(this.torso);
    const midLocal = (plan.shoulderX - plan.hipX) * 0.45 * k;
    const rest = (plan.shoulderX - plan.hipX) * k - midLocal;
    const B = 100;
    const hindH = plan.hindH * k;
    const chestH = plan.chestH * k;

    // 尾巴：挂在臀片后上方，画在臀片后面。
    const tailRoot = new Container();
    tailRoot.position.set(-midLocal - 0.17 * B, -0.35 * hindH);
    this.torso.addChild(tailRoot);
    this.tail = [];
    this.tailRest = TAIL_STYLE[plan.parts.tail] ?? { droop: 0.8, curl: 0.1 };
    const nSeg = plan.tailSegs;
    const segL = (plan.tailLen * k) / nSeg;
    const tw = plan.tailW * k;
    let parent: Container = tailRoot;
    for (let i = 0; i < nSeg; i++) {
      const c = new Container();
      if (i > 0) c.position.set(segL * 0.92, 0);
      const g = new Graphics();
      const p = pen(g, plan.parts.tail === 'bushy_tail' ? 'fur' : edge);
      const taper = plan.parts.tail === 'balance_tail' ? 1 - (i / nSeg) * 0.6 : 1 - (i / nSeg) * 0.25;
      if (nSeg === 1) p.blob(segL * 0.35, 0, Math.max(segL * 0.6, tw * 0.7), tw * 0.7, plan.parts.coat === 'feathers' ? look.dark : look.light);
      else p.blob(segL * 0.5, 0, segL * 0.62, (tw / 2) * taper, i === nSeg - 1 && plan.parts.tail === 'bushy_tail' ? look.light : look.main);
      brad(g);
      c.addChild(g);
      parent.addChild(c);
      parent = c;
      this.tail.push(c);
    }
    this.tailSprings = this.tail.map(() => ({ x: 0, v: 0 }));

    // 臀片和肚子。
    const hindG = new Graphics();
    const hp = pen(hindG);
    hp.blob(0.04 * B, 0.42 * chestH, 0.27 * B, plan.belly * k + 0.35 * chestH, look.light);
    hp.blob(-midLocal + 0.04 * B, -0.15 * hindH, 0.24 * B, hindH, look.main);
    this.torso.addChild(hindG);

    // 胸片。
    this.chest = new Container();
    this.torso.addChild(this.chest);
    const chestG = new Graphics();
    const cp = pen(chestG);
    cp.blob(rest - 0.1 * B, -0.1 * chestH, 0.3 * B, chestH, look.main);
    brad(chestG);
    this.chest.addChild(chestG);

    // 颈、头。
    this.neck = new Container();
    this.neck.position.set(rest + 0.12 * B, -0.4 * chestH);
    this.chest.addChild(this.neck);
    const neckG = new Graphics();
    pen(neckG).capsule(plan.neckLen * k, plan.neckW * k, plan.neckW * k * 0.7, look.main);
    brad(neckG);
    this.neck.addChild(neckG);

    this.head = new Container();
    this.head.position.set(plan.neckLen * k, 0);
    this.neck.addChild(this.head);
    const hr = plan.headR * k;
    const sn = plan.snout * k;
    const beak = ['seed_beak', 'probe_bill', 'hooked_beak', 'stout_bill'].includes(plan.parts.mouth);

    const ear = (x: number, y: number, color: number): Container => {
      const c = new Container();
      c.position.set(x, y);
      const g = new Graphics();
      const eh = plan.earH * k;
      pen(g, 'smooth').poly([-0.32 * hr, 0, -0.05 * hr, -eh, 0.3 * hr, 0], color);
      c.addChild(g);
      return c;
    };
    const farEar = ear(-0.15 * hr, -0.65 * hr, look.dark);
    this.head.addChild(farEar);

    // 下颌：绕颌关节张开，画在头片后面。
    this.jaw = new Container();
    this.jaw.position.set(0.25 * hr, 0.3 * hr);
    this.head.addChild(this.jaw);
    const jawG = new Graphics();
    this.mouthLower(pen(jawG, 'smooth'), hr, sn, beak, look);
    this.jaw.addChild(jawG);

    const headG = new Graphics();
    const hpn = pen(headG);
    hpn.blob(0.15 * hr, 0, hr, hr * 0.86, look.main);
    this.mouthUpper(pen(headG, 'smooth'), hr, sn, beak, look);
    hpn.dot(0.5 * hr, -0.22 * hr, Math.max(1.2, 0.11 * hr), 0x141414);
    hpn.dot(0.56 * hr, -0.26 * hr, Math.max(0.4, 0.035 * hr), 0xf4f1ea);
    brad(headG);
    this.head.addChild(headG);
    const nearEar = ear(0.12 * hr, -0.72 * hr, look.main);
    this.head.addChild(nearEar);
    this.ears = [farEar, nearEar];
    this.earSprings = this.ears.map(() => ({ x: 0, v: 0 }));

    // 近侧的腿最后画：盖在身体上，髋、肩的纸钉露在外面。
    for (const key of ['nearHind', 'nearFore'] as const) {
      this.legs[key] = makeLeg(key);
      this.view.addChild(this.legs[key].group);
    }
  }

  /** 脚掌：按腿型部件换剪影。在第三节（跖、掌）的末端。 */
  private paw(p: Pen, len: number, w: number, hind: boolean, look: Look): void {
    const limb = this.plan.parts.limbs;
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

  private mouthUpper(p: Pen, hr: number, sn: number, beak: boolean, look: Look): void {
    const m = this.plan.parts.mouth;
    if (beak) {
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

  private mouthLower(p: Pen, hr: number, sn: number, beak: boolean, look: Look): void {
    const m = this.plan.parts.mouth;
    if (beak) {
      p.poly([0.4 * hr, -0.1 * hr, 0.55 * hr + sn * 0.95, -0.15 * hr, 0.4 * hr, 0.12 * hr], m === 'seed_beak' || m === 'stout_bill' ? BILL : HORN);
      return;
    }
    p.blob(0.3 * hr + sn * 0.45, 0.05 * hr, 0.35 * hr + sn * 0.45, 0.2 * hr, look.light);
  }

  /** 摆姿态。dt 秒：弹簧（尾巴、耳朵）按真实时间跟随。breath 是呼吸的起伏（−1–1），胸片跟着一鼓一收。 */
  apply(pose: Pose, dt: number, breath = 0): void {
    const plan = this.plan;
    const k = this.k;
    this.time += dt;
    const sk = skeletonOf(plan, pose);
    for (const key of LEGS) {
      const pts = sk.legs[key];
      const segs = this.legs[key].segs;
      for (let i = 0; i < 3; i++) put(segs[i]!, pts[i]!, k, Math.atan2(pts[i + 1]!.y - pts[i]!.y, pts[i + 1]!.x - pts[i]!.x));
    }
    put(this.torso, sk.mid, k, sk.pitch);
    this.chest.rotation = -pose.spine;
    this.chest.scale.set(1, 1 + 0.035 * breath);
    this.neck.rotation = -(pose.neck - sk.pitch - pose.spine);
    this.head.rotation = -pose.head;
    this.jaw.rotation = pose.jaw;

    // 尾巴：尾根跟着臀的上下晃（惯性），每节追上一节，越往后越晚；站着时尾尖偶尔慢慢甩一下。
    if (dt > 0) {
      const vy = (pose.hipY - this.lastHipY) / dt / Math.max(0.05, plan.legLen);
      const omega = pendulumOmega(plan.tailLen) * 2.2;
      const swish = 0.18 * Math.sin(this.time * omega * 0.18) * Math.sin(this.time * 0.37);
      let lead = Math.max(-0.6, Math.min(0.6, vy * 0.12));
      this.tailSprings.forEach((s, i) => {
        springStep(s, lead + (i === this.tailSprings.length - 1 ? swish : 0), omega, 0.32, dt);
        lead = s.x * 0.85;
      });
      const headAng = pose.neck + pose.head;
      const hv = (headAng - this.lastHead) / dt;
      const earOmega = pendulumOmega(plan.earH) * 1.6;
      for (const s of this.earSprings) springStep(s, Math.max(-0.5, Math.min(0.5, -hv * 0.05)), earOmega, 0.28, dt);
      this.lastHead = headAng;
    }
    this.lastHipY = pose.hipY;
    const r = this.tailRest;
    const lift = pose.tail;
    this.tail.forEach((c, i) => {
      const spring = this.tailSprings[i]!.x;
      c.rotation = i === 0 ? -(Math.PI + r.droop - lift) + spring : r.curl + spring;
    });
    this.ears.forEach((c, i) => (c.rotation = -0.12 + this.earSprings[i]!.x));
  }
}
