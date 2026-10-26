import type { Container, Texture } from 'pixi.js';
import { Cutout, type CutData, type CutPart, type Dye } from './cutout';
import { bend, boneWarp, compose, densify, mapShape, radialReshape, reach, regionStretch, scale, type P, type Shape, type Warp } from './fit';
import { pendulumOmega, springStep, type Spring } from './gait';
import { TailChain, idleSwish } from './tail';
import { LEGS, earExponent, isHind, type BodyPlan, type LegKey } from './plan';
import { legJoints, standPose, type Pose, type Vec } from './pose';

/**
 * 用成品图切出来的零件（cutout.ts）拼出任意一具身体，演设计台的动作：和 Puppet 一样吃 BodyPlan 和每帧的 Pose。
 *
 * 零件属于部件，不属于物种（DECISIONS"纸偶的部件抽象"）。成品图画的是某条现有技术（rig.template，例如猫），
 * 它的 BodyPlan 叫"原样"；换了身体，每片零件按"新身体 ÷ 原样"贴到新的骨头上（fit.ts）：
 * - 躯干：臀片、胸片前后按髋到肩的距离拉，上下按臀、胸的高度拉；
 * - 腿：每节先按粗细（大腿、上臂按 thighW，其余按 legW）整片缩放，再只拉关节之间的杆，补足长度（hindSegs / foreSegs）；
 *   远侧的腿复用近侧的零件、调暗，长短永远一样；
 * - 头：按头的大小整片缩放，吻按嘴型拉长或缩短；
 * - 耳：从原画的耳出发，按外观参数一步步变（`docs/research/body-params.md` 第六节"描出来的多边形 + 变形算子"）：
 *   耳尖磨圆或削尖（radialReshape）→ 按耳长、耳宽拉 → 软的耳朵在重力下弯下来（bend）；耳的插口沿头的轮廓从头顶滑到两侧；
 *   耳长拉到没有，耳片就不画；
 * - 尾：尾型决定节数（plan.tailSegs），用成品图最后几节（尾尖总在最后），总长按尾长、粗细按尾宽。
 * 每片零件贴好以后，记下它身上各个插口（子零件的转轴、骨头末端）的位置；摆姿态只用这些插口，不再看成品图。
 *
 * 摆姿态：
 * - 躯干：臀片按“肩比髋高多少”倾斜（相对站姿），胸片再绕中间的铆钉转 spine；
 * - 腿：贴好的三节长度放进 legJoints 解出膝、踝、趾，每片零件转到自己的骨头方向；关节不低于地面；
 * - 头：没有颈片，用一节藏在胸片里的“虚拟脖子”（肩 → 头的铆钉）按 pose.neck 摆，胸片上画着的脖子跟着弯；
 *   下颌按 pose.jaw 张开；耳朵、尾巴用弹簧跟随（同 Puppet）。
 *
 * 坐标：view 的原点在身体中点正下方的地面（同 Puppet），内部单位是成品图的像素（换算成米的比例按原样的髋高定），y 朝下。
 */

/** 设计台的 Pose 表达不了的姿势（坐、揣手、侧躺）用的额外参数。 */
export interface PoseExtra {
  /** 有没有地面（默认有）。侧躺在床上的俯视图没有：纸片平放在床上，不用管碰地。 */
  ground?: boolean;
  /** 每条腿单独的折叠量，覆盖 pose.fold。 */
  fold?: Partial<Record<LegKey, number>>;
  /** 尾巴每一节再多弯多少（弧度，正 = 往上卷）。 */
  tailCurl?: number;
}

/** 远侧的腿调暗多少。 */
const FAR_SHADE = 0.92;

const rot = (q: P, a: number): P => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const angleOf = (q: P): number => Math.atan2(q[1], q[0]);

/** 一片零件贴好以后：插口（零件自己的坐标）。end 是骨头末端；其余以子零件的 id 命名。 */
interface Fitted {
  sockets: Record<string, P>;
}

export class CutoutPuppet {
  readonly view: Container;
  private readonly cut: Cutout;
  private readonly ref: BodyPlan;
  private plan!: BodyPlan;
  /** 米 / 成品图像素（按原样的髋高定，换身体不变）。 */
  private readonly s: number;
  private pxPerM = 1;
  private readonly byId = new Map<string, CutPart>();
  private readonly fitted = new Map<string, Fitted>();
  /** 用到的尾节（成品图里的最后几节）。 */
  private tail: string[] = [];
  private tailChain = new TailChain([], [], { stiffness: 1, damping: 1 });
  private earSprings: Spring[] = [];
  /** 耳的插口滑到头的两侧时，耳跟着转多少（弧度）。 */
  private earTurn: number[] = [];
  private lastHead = 0;
  private time = 0;
  /** 站姿：成品图画的就是站姿，头和尾巴的角度都相对它算。 */
  private rest!: Pose;
  /** 原样的站姿：成品图画的是它，身体的倾斜相对它算（前腿短的身体站着就前低后高）。 */
  private restRef!: Pose;

  /** ref 是成品图那条现有技术（data.rig.template）的 BodyPlan；flat 画成影子纸（见 Cutout）。 */
  constructor(
    readonly data: CutData,
    paper: Texture,
    dye: Dye,
    ref: BodyPlan,
    plan: BodyPlan,
    flat = false,
  ) {
    this.cut = new Cutout(data, paper, dye, flat);
    this.view = this.cut.view;
    this.ref = ref;
    for (const p of data.parts) this.byId.set(p.id, p);
    this.earSprings = data.rig.ears.map(() => ({ x: 0, v: 0 }));
    const hipPx = data.rig.ground - this.part(data.rig.legs.nearHind.parts[0]).pivot[1];
    this.s = standPose(ref).hipY / hipPx;
    this.build(plan);
  }

  private part(id: string): CutPart {
    return this.byId.get(id)!;
  }

  /** 成品图里从 a 的转轴到点 q 的向量，换到 a 自己的坐标。 */
  private toLocal(a: CutPart, q: P): P {
    return rot(sub(q, a.pivot), -a.angle);
  }

  /**
   * 耳的插口沿头的轮廓滑动（成品图坐标）：pos = 0 在原画的位置（头顶），1 滑到头的后侧（人、猫头鹰的耳在两侧，侧面看在头的后半）。
   * 插口离轮廓的深度不变；耳跟着轮廓的朝向转。返回插口和转角。
   */
  private earSlide(id: string, pos: number): [P, number] {
    const ear = this.part(id);
    if (pos <= 0) return [ear.pivot, 0];
    const head = this.part(this.data.rig.head);
    const pts: P[] = [];
    for (let j = 0; j < head.outline.length; j += 2) pts.push(add(head.pivot, rot([head.outline[j]!, head.outline[j + 1]!], head.angle)));
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length;
    const cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    const c: P = [cx, cy];
    const d2 = (a: P, b: P): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    let i0 = 0;
    for (let j = 1; j < pts.length; j++) if (d2(pts[j]!, ear.pivot) < d2(pts[i0]!, ear.pivot)) i0 = j;
    // 头的后侧：从中心往后、稍往下（成品图里头朝 +x，y 朝下）。
    const back: P = [-0.97, 0.25];
    const along = (q: P): number => (q[0] - cx) * back[0] + (q[1] - cy) * back[1];
    let i1 = 0;
    for (let j = 1; j < pts.length; j++) if (along(pts[j]!) > along(pts[i1]!)) i1 = j;
    // 沿着往后的那个方向走。
    const n = pts.length;
    const step = along(pts[(i0 + 1) % n]!) >= along(pts[(i0 - 1 + n) % n]!) ? 1 : -1;
    const path: P[] = [pts[i0]!];
    for (let j = i0; j !== i1; ) {
      j = (j + step + n) % n;
      path.push(pts[j]!);
    }
    const lens = [0];
    for (let j = 1; j < path.length; j++) lens.push(lens[j - 1]! + Math.sqrt(d2(path[j]!, path[j - 1]!)));
    const goal = Math.min(1, pos) * lens[lens.length - 1]!;
    let k = 1;
    while (k < path.length - 1 && lens[k]! < goal) k++;
    const t = lens[k]! > lens[k - 1]! ? (goal - lens[k - 1]!) / (lens[k]! - lens[k - 1]!) : 0;
    const q: P = [path[k - 1]![0] + (path[k]![0] - path[k - 1]![0]) * t, path[k - 1]![1] + (path[k]![1] - path[k - 1]![1]) * t];
    const depth = Math.sqrt(d2(ear.pivot, pts[i0]!));
    const toC = sub(c, q);
    const m = Math.hypot(toC[0], toC[1]) || 1;
    const at: P = [q[0] + (toC[0] / m) * depth, q[1] + (toC[1] / m) * depth];
    let turn = angleOf(sub(q, c)) - angleOf(sub(pts[i0]!, c));
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    return [at, turn];
  }

  /** 换身体：每片零件贴到新的骨头上，算出插口和铆钉。 */
  build(plan: BodyPlan): void {
    this.plan = plan;
    this.rest = standPose(plan);
    this.restRef = standPose(this.ref);
    const { rig } = this.data;
    const ref = this.ref;
    const shapes = new Map<string, Shape>();
    const fitted = this.fitted;
    fitted.clear();
    // 用一个“成品图坐标里、以零件转轴为原点”的变换 w 贴一片零件，插口（成品图里的点）一起变。
    const fitPiece = (id: string, w: Warp, sockets: Record<string, P>, dense = 0): void => {
      const p = this.part(id);
      const dz = (poly: number[]): number[] => (dense > 0 ? densify(poly, dense) : poly);
      // 零件坐标 → 成品图坐标（以转轴为原点）→ 变换 → 零件坐标。
      const f: Warp = (x, y) => {
        const [X, Y] = rot([x, y], p.angle);
        return rot(w(X, Y), -p.angle);
      };
      shapes.set(id, mapShape({ outline: dz(p.outline), stripe: p.stripe.map(dz), pale: p.pale.map(dz) }, f));
      const out: Record<string, P> = {};
      for (const [k, q] of Object.entries(sockets)) out[k] = rot(w(...sub(q, p.pivot)), -p.angle);
      fitted.set(id, { sockets: out });
    };
    const piv = (id: string): P => this.part(id).pivot;

    // 躯干：前后按髋到肩，上下按臀高、胸高。
    const kx = (plan.shoulderX - plan.hipX) / (ref.shoulderX - ref.hipX);
    const hip = piv(rig.legs.nearHind.parts[0]);
    const shoulder = piv(rig.legs.nearFore.parts[0]);
    const tailRoot = piv(rig.tail[0]!);
    fitPiece(rig.hind, scale(kx, plan.hindH / ref.hindH), { hip, tail: tailRoot });
    fitPiece(rig.chest, scale(kx, plan.chestH / ref.chestH), { shoulder, head: piv(rig.head) });

    // 腿：近侧的零件贴好，远侧复用。
    for (const k of ['nearHind', 'nearFore'] as const) {
      const leg = rig.legs[k];
      const joints: P[] = [...leg.parts.map(piv), leg.toe];
      const segs = isHind(k) ? plan.hindSegs : plan.foreSegs;
      const refSegs = isHind(k) ? ref.hindSegs : ref.foreSegs;
      leg.parts.forEach((id, i) => {
        const end = sub(joints[i + 1]!, joints[i]!);
        const rA = this.part(id).lapR;
        const rB = i < 2 ? this.part(leg.parts[i + 1]!).lapR : 0;
        const w = i === 0 ? plan.thighW / ref.thighW : plan.legW / ref.legW;
        const len = Math.hypot(end[0], end[1]) * (segs[i]! / refSegs[i]!);
        fitPiece(id, boneWarp({ end, rA, rB }, w, len), { end: joints[i + 1]! });
      });
    }
    for (const [far, near] of [
      ['farHind', 'nearHind'],
      ['farFore', 'nearFore'],
    ] as const) {
      rig.legs[far].parts.forEach((id, i) => {
        const src = rig.legs[near].parts[i]!;
        // 远侧的零件用近侧的形状：两片零件的“零件坐标”不同（转角不同），先换到成品图坐标再换回来。
        const a = this.part(src).angle - this.part(id).angle;
        const sh = shapes.get(src)!;
        const f: Warp = (x, y) => rot([x, y], a);
        shapes.set(id, mapShape(sh, f));
        const so = fitted.get(src)!.sockets;
        fitted.set(id, { sockets: Object.fromEntries(Object.entries(so).map(([n, q]) => [n, rot(q, a)])) });
        this.cut.setShade(id, FAR_SHADE);
      });
    }

    // 头：整片按头的大小；吻按嘴型拉；下颌跟着吻。耳朵按耳长、耳宽。
    const kh = plan.headR / ref.headR;
    // 嘴型表里的吻长是代码纸偶的（草食的吻按马、鹿定的），切图的头只拉一部分：开方，夹在 0.8–1.35 倍。
    const snoutK = Math.min(1.35, Math.max(0.8, Math.sqrt(plan.snout / plan.headR / (ref.snout / ref.headR))));
    const head = this.part(rig.head);
    const snoutFrom = sub(rig.snout.from, head.pivot);
    const headWarp = compose(regionStretch(snoutFrom, rig.snout.dir, snoutK), scale(kh));
    const headSockets: Record<string, P> = { [rig.jaw]: piv(rig.jaw) };
    this.earTurn = rig.ears.map(() => 0);
    rig.ears.forEach((e, i) => {
      const [at, turn] = this.earSlide(e, plan.earPos);
      headSockets[e] = at;
      this.earTurn[i] = turn;
    });
    fitPiece(rig.head, headWarp, headSockets);
    // 下颌在头的变换里变（它是从头上切下来的），再挪回自己的转轴。
    const jawPiv = piv(rig.jaw);
    const jawAt = headWarp(...sub(jawPiv, head.pivot));
    fitPiece(rig.jaw, (x, y) => sub(headWarp(x + jawPiv[0] - head.pivot[0], y + jawPiv[1] - head.pivot[1]), jawAt), {});
    const earK = plan.earH / plan.headR / (ref.earH / ref.headR);
    rig.ears.forEach((e, i) => {
      const ear = this.part(e);
      this.cut.setVisible(e, plan.earOn);
      const dir = rot([1, 0], ear.angle);
      const base: P = [dir[0] * ear.lapR * 0.6, dir[1] * ear.lapR * 0.6];
      const wide = plan.earW / ref.earW;
      let w: Warp = regionStretch(base, dir, earK, wide);
      // 量一下原画的耳（零件自己的坐标里，转轴在原点）：耳尖是离转轴最远的点，耳的中线从耳根指向耳尖（原画的耳不一定正对零件的 +x）。
      const o = ear.outline;
      let tip: P = [o[0]!, o[1]!];
      for (let j = 2; j < o.length; j += 2) if (Math.hypot(o[j]!, o[j + 1]!) > Math.hypot(tip[0], tip[1])) tip = [o[j]!, o[j + 1]!];
      const tipLen = Math.hypot(tip[0], tip[1]);
      const tAx: P = [tip[0] / tipLen, tip[1] / tipLen];
      const along = (q: P): number => q[0] * tAx[0] + q[1] * tAx[1];
      const across = (q: P): number => -q[0] * tAx[1] + q[1] * tAx[0];
      const uBase = ear.lapR * 0.6;
      const uC = uBase + (tipLen - uBase) * 0.35;
      let vLo = Infinity;
      let vHi = -Infinity;
      for (let j = 0; j < o.length; j += 2) {
        const q: P = [o[j]!, o[j + 1]!];
        if (Math.abs(along(q) - uC) > tipLen * 0.12) continue;
        vLo = Math.min(vLo, across(q));
        vHi = Math.max(vHi, across(q));
      }
      const halfW = Math.max(1, (vHi - vLo) / 2);
      const vMid = (vHi + vLo) / 2;
      const axImg = rot(tAx, ear.angle);
      let dense = 0;
      if (plan.earTip !== ref.earTip) {
        const cLocal: P = [tAx[0] * uC - tAx[1] * vMid, tAx[1] * uC + tAx[0] * vMid];
        w = compose(radialReshape(rot(cLocal, ear.angle), axImg, tipLen - uC, halfW, earExponent(plan.earTip), earExponent(ref.earTip)), w);
        dense = 5;
      }
      if (plan.earStiff < 1) {
        // 软的耳朵：从折点开始往后弯、垂到下方（从头顶经过脑后落下来，盖在脸颊后面）。越软，折点越靠近耳根、弯得越多；
        // 弯的半径随软硬从半宽的 1.2 倍降到 0.35 倍（软的像折痕，硬一点的像弧）。
        const tipNow = w(...rot(tip, ear.angle));
        const L1 = Math.hypot(tipNow[0], tipNow[1]);
        const axNow: P = [tipNow[0] / L1, tipNow[1] / L1];
        const soft = 1 - plan.earStiff;
        const uB = ear.lapR * (0.35 + 0.55 * plan.earStiff);
        const uF = uB + Math.max(0, L1 - uB) * Math.pow(plan.earStiff, 0.6);
        const hang = Math.PI / 2 - 0.25 - 2 * Math.PI;
        let phi = (hang - (angleOf(axNow) + this.earTurn[i]!)) * soft;
        const R = halfW * wide * (1.2 - 0.85 * soft);
        const room = Math.max(1e-3, L1 - uF);
        let len = Math.abs(phi) * R;
        if (len > room) {
          len = room;
          phi = Math.sign(phi) * (room / R);
        }
        w = compose(w, bend([axNow[0] * uF, axNow[1] * uF], axNow, len, phi));
        dense = 5;
      }
      fitPiece(e, compose(w, scale(kh)), {}, dense);
    });

    // 尾：最后 n 节；总长按尾长，粗细按尾宽（第一节的粗细对上原样的尾根）。
    const n = Math.max(1, Math.min(rig.tail.length, plan.tailSegs));
    this.tail = rig.tail.slice(rig.tail.length - n);
    for (const id of rig.tail) this.cut.setVisible(id, this.tail.includes(id));
    const tailEnd = (id: string, i: number): P => {
      const next = rig.tail[i + 1];
      if (next) return piv(next);
      const p = this.part(id);
      const dir = rot([1, 0], p.angle);
      const r = reach(p.outline, [1, 0]);
      return add(p.pivot, [dir[0] * r, dir[1] * r]);
    };
    const tailLen = (i: number): number => {
      const e = sub(tailEnd(rig.tail[i]!, i), piv(rig.tail[i]!));
      return Math.hypot(e[0], e[1]);
    };
    const all = rig.tail.reduce((a, _, i) => a + tailLen(i), 0);
    const first = rig.tail.length - n;
    const chosen = rig.tail.slice(first).reduce((a, _, i) => a + tailLen(first + i), 0);
    const kLen = (all * (plan.tailLen / ref.tailLen)) / chosen;
    const kW = (plan.tailW / ref.tailW) * (this.part(rig.tail[0]!).lapR / this.part(rig.tail[first]!).lapR);
    rig.tail.forEach((id, i) => {
      if (i < first) return;
      const end = sub(tailEnd(id, i), piv(id));
      const rB = rig.tail[i + 1] ? this.part(rig.tail[i + 1]!).lapR : 0;
      fitPiece(id, boneWarp({ end, rA: this.part(id).lapR, rB }, kW, tailLen(i) * kLen), { end: tailEnd(id, i) });
    });
    // 尾巴的动力学：每节的长度、粗细（米）按贴好的零件算。
    this.tailChain = new TailChain(
      this.tail.map((id) => {
        const e = fitted.get(id)!.sockets.end!;
        return Math.hypot(e[0], e[1]) * this.s;
      }),
      this.tail.map((id) => this.part(id).lapR * kW * 2 * this.s),
      plan.tailMotion,
    );

    // 铆钉：每个关节一颗，钉在上下两片里上面那片上；大小跟着关节的粗细（圆头半径 × 0.32）。
    const rivets = new Map<string, [number, number, number][]>();
    // 铆钉的大小限制跟着身体大小走（成品图上是 6–11 像素）。
    const kb = plan.bodyLen / ref.bodyLen;
    const pin = (child: string, parent: string, socket: P, rLap: number): void => {
      const c = this.part(child);
      const par = this.part(parent);
      if (c.pivotEstimated) return;
      const onChild = c.z > par.z;
      const top = onChild ? child : parent;
      const list = rivets.get(top) ?? [];
      list.push([...(onChild ? ([0, 0] as P) : socket), Math.max(6 * kb, Math.min(11 * kb, rLap * 0.32))]);
      rivets.set(top, list);
    };
    const so = (id: string, k: string): P => fitted.get(id)!.sockets[k]!;
    const lapW = (id: string, w: number): number => this.part(id).lapR * w;
    pin(rig.chest, rig.hind, [0, 0], lapW(rig.chest, Math.min(kx, plan.chestH / ref.chestH)));
    for (const k of LEGS) {
      const ps = rig.legs[k].parts;
      const near = isHind(k) ? rig.legs.nearHind.parts : rig.legs.nearFore.parts;
      const parent = isHind(k) ? rig.hind : rig.chest;
      // 远侧的腿铆在近侧同一个位置（远近两侧的根是同一个关节）。
      pin(ps[0], parent, so(parent, isHind(k) ? 'hip' : 'shoulder'), lapW(near[0], plan.thighW / ref.thighW));
      pin(ps[1], ps[0], so(ps[0], 'end'), lapW(near[1], plan.legW / ref.legW));
      pin(ps[2], ps[1], so(ps[1], 'end'), lapW(near[2], plan.legW / ref.legW));
    }
    pin(rig.head, rig.chest, so(rig.chest, 'head'), lapW(rig.head, kh));
    pin(rig.jaw, rig.head, so(rig.head, rig.jaw), lapW(rig.jaw, kh));
    if (plan.earOn) for (const e of rig.ears) pin(e, rig.head, so(rig.head, e), lapW(e, kh));
    this.tail.forEach((id, i) => {
      if (i === 0) pin(id, rig.hind, so(rig.hind, 'tail'), lapW(id, kW));
      else pin(id, this.tail[i - 1]!, so(this.tail[i - 1]!, 'end'), lapW(id, kW));
    });
    for (const [id, sh] of shapes) this.cut.setShape(id, sh, rivets.get(id) ?? []);
    this.setScale(this.pxPerM);
  }

  setScale(pxPerM: number): void {
    this.pxPerM = pxPerM;
    this.view.scale.set(pxPerM * this.s);
  }

  apply(pose: Pose, dt: number, breath = 0, extra: PoseExtra = {}): void {
    const { rig } = this.data;
    const s = this.s;
    const plan = this.plan;
    const ground = extra.ground ?? true;
    this.time += dt;
    const so = (id: string, k: string): P => this.fitted.get(id)!.sockets[k]!;
    // 零件放好以后，它身上一个插口在 view 里的位置。
    const at = (pos: P, rotation: number, local: P): P => add(pos, rot(local, rotation));

    // 躯干：倾斜角按 BodyPlan 的髋肩距离算（和代码纸偶一样斜），再减去站姿的倾斜（成品图画的是站姿）。
    const pitch = Math.atan2(pose.shoulderY - pose.hipY, plan.shoulderX - plan.hipX);
    const pitchRest = Math.atan2(this.restRef.shoulderY - this.restRef.hipY, this.ref.shoulderX - this.ref.hipX);
    const aHind = -(pitch - pitchRest);
    const rHind = this.part(rig.hind).angle + aHind;
    const hipV: P = [plan.hipX / s, -pose.hipY / s];
    const midV = sub(hipV, rot(so(rig.hind, 'hip'), rHind));
    const aChest = aHind - pose.spine;
    const rChest = this.part(rig.chest).angle + aChest;
    this.cut.place(rig.hind, ...midV, rHind);
    this.cut.place(rig.chest, ...midV, rChest, 1 + 0.03 * breath);
    const hipAt = at(midV, rHind, so(rig.hind, 'hip'));
    const shoulderAt = at(midV, rChest, so(rig.chest, 'shoulder'));

    // 腿：贴好的三节长度。
    for (const k of LEGS) {
      const leg = rig.legs[k];
      const ends = leg.parts.map((id) => so(id, 'end'));
      const segs = ends.map((e) => Math.hypot(e[0], e[1]) * s) as [number, number, number];
      const legPlan = isHind(k) ? { ...plan, hindSegs: segs } : { ...plan, foreSegs: segs };
      const rootV = isHind(k) ? hipAt : shoulderAt;
      const root: Vec = { x: rootV[0] * s, y: -rootV[1] * s };
      const f = pose.feet[k];
      const j = legJoints(legPlan, k, root, { x: root.x + f.x, y: f.y }, extra.fold?.[k] ?? pose.fold).map((v): P => [v.x / s, -v.y / s]);
      // 关节不能低于地面：膝、踝的中心至少离地半个肢体粗（搭接片的半径），趾尖贴地。
      // 低了就把这一节放平到那个高度（长度不变，朝向不变），后面的节跟着——趴下时腿折起来平放在地上。
      for (let i = 1; ground && i < 4; i++) {
        const h = i < 3 ? this.part(leg.parts[i]!).lapR * (plan.legW / this.ref.legW) : 2;
        if (j[i]![1] <= -h) continue;
        const len = segs[i - 1]! / s;
        const dy = -h - j[i - 1]![1];
        const dx = Math.sqrt(Math.max(0, len * len - dy * dy));
        const side = Math.sign(j[i]![0] - j[i - 1]![0]) || 1;
        const old = j[i]!;
        j[i] = [j[i - 1]![0] + side * dx, -h];
        // 后面的关节平移过去（形状不变），下一轮再检查它们。
        for (let m = i + 1; m < 4; m++) j[m] = [j[m]![0] + j[i]![0] - old[0], j[m]![1] + j[i]![1] - old[1]];
      }
      for (let i = 0; i < 3; i++) {
        const viewA = Math.atan2(j[i + 1]![1] - j[i]![1], j[i + 1]![0] - j[i]![0]);
        this.cut.place(leg.parts[i]!, ...j[i]!, viewA - angleOf(ends[i]!));
      }
    }

    // 头：虚拟脖子（肩 → 头的铆钉）按 pose.neck 摆，头的铆钉跟着画弧；头片按脖子 + 头相对站姿的角度转。
    const headRest = at(midV, rChest, so(rig.chest, 'head'));
    const aNeck = -(pose.neck - this.rest.neck);
    const headV = add(shoulderAt, rot(sub(headRest, shoulderAt), aNeck));
    // 胸片前上方本来画着脖子：这一块跟着虚拟脖子弯，越靠近头转得越多（否则低头时脖子后面会翘出一个尖）。
    const ax = sub(headRest, shoulderAt);
    const axLen2 = ax[0] * ax[0] + ax[1] * ax[1];
    this.cut.setWarp(
      rig.chest,
      Math.abs(aNeck) < 1e-3
        ? null
        : (X, Y) => {
            const t = ((X - shoulderAt[0]) * ax[0] + (Y - shoulderAt[1]) * ax[1]) / axLen2;
            const u = Math.min(1, Math.max(0, (t - 0.25) / 0.75));
            const w = u * u * (3 - 2 * u);
            return add(shoulderAt, rot(sub([X, Y], shoulderAt), w * aNeck));
          },
    );
    const aHead = -(pose.neck + pose.head - this.rest.neck - this.rest.head);
    const rHead = this.part(rig.head).angle + aHead;
    this.cut.place(rig.head, ...headV, rHead);
    this.cut.place(rig.jaw, ...at(headV, rHead, so(rig.head, rig.jaw)), this.part(rig.jaw).angle + aHead + pose.jaw);

    // 耳朵的弹簧（同 Puppet）。
    if (dt > 0) {
      const headAng = pose.neck + pose.head;
      const hv = (headAng - this.lastHead) / dt;
      // 软的耳朵晃得慢、晃得多。
      const earOmega = pendulumOmega(plan.earH) * 1.6 * (0.45 + 0.55 * plan.earStiff);
      const earGain = 0.05 * (2 - plan.earStiff);
      for (const sp of this.earSprings) springStep(sp, Math.max(-0.5, Math.min(0.5, -hv * earGain)), earOmega, 0.28, dt);
      this.lastHead = headAng;
    }
    rig.ears.forEach((id, i) => this.cut.place(id, ...at(headV, rHead, so(rig.head, id)), this.part(id).angle + aHead + this.earTurn[i]! + this.earSprings[i]!.x));

    // 尾巴：尾根挂在臀片上，抬起 pose.tail，每节再弯 tailCurl，这是"想要的"尾巴；动力学（tail.ts）算出每个关节跟不上多少。
    // 有地面时尾巴不钻地：哪一节的末端低于地面（加半个尾巴粗），这一节就往上转到贴着地面——坐着时尾巴顺着地面拖出去，
    // 抬起来的量记回动力学的状态里，下一帧不再往地里甩。
    // 坐标：这里 y 朝下、角度顺时针；动力学 y 朝上，所以位置的 y、角度都取反。
    let pos = at(midV, rHind, so(rig.hind, 'tail'));
    const a0 = aHind + pose.tail - this.rest.tail;
    {
      const dirs: number[] = [];
      let k = a0;
      this.tail.forEach((id, i) => {
        if (i > 0) k += extra.tailCurl ?? 0;
        dirs.push(-(angleOf(so(id, 'end')) + this.part(id).angle + k));
      });
      this.tailChain.step(dt, [pos[0] * s, -pos[1] * s], dirs, idleSwish(this.time, plan.tailLen, plan.tailMotion.idle));
    }
    let a = a0;
    this.tail.forEach((id, i) => {
      a += -this.tailChain.dev[i]! + (i > 0 ? (extra.tailCurl ?? 0) : 0);
      const p = this.part(id);
      const end = so(id, 'end');
      const next = this.tail[i + 1];
      if (ground && next) {
        const v = rot(end, p.angle + a);
        const r = this.part(next).lapR;
        if (pos[1] + v[1] > -r) {
          const len = Math.hypot(end[0], end[1]);
          const dy = -r - pos[1];
          if (Math.abs(dy) < len) {
            const dx = (Math.sign(v[0]) || 1) * Math.sqrt(len * len - dy * dy);
            let d = Math.atan2(dy, dx) - Math.atan2(v[1], v[0]);
            d = Math.atan2(Math.sin(d), Math.cos(d));
            a += d;
            this.tailChain.push(i, -d);
          }
        }
      }
      this.cut.place(id, ...pos, p.angle + a);
      pos = at(pos, p.angle + a, end);
    });
    // 碰到地面的纸片压扁一点、往两边鼓，不穿过地面（趴下时的爪、肘、肚子，走路时踩实的脚掌）。
    this.cut.deform(ground ? -3 : Infinity, 10);
  }
}
