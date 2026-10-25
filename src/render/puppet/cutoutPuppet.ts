import type { Container, Texture } from 'pixi.js';
import { Cutout, type CutData, type CutPart, type Dye } from './cutout';
import { boneWarp, compose, mapShape, reach, regionStretch, scale, type P, type Shape, type Warp } from './fit';
import { pendulumOmega, springStep, type Spring } from './gait';
import { LEGS, isHind, type BodyPlan, type LegKey } from './plan';
import { legJoints, standPose, type Pose, type Vec } from './pose';

/**
 * 用成品图切出来的零件（cutout.ts）拼出任意一具身体，演设计台的动作：和 Puppet 一样吃 BodyPlan 和每帧的 Pose。
 *
 * 零件属于部件，不属于物种（DECISIONS"纸偶的部件抽象"）。成品图画的是某条现有技术（rig.template，例如猫），
 * 它的 BodyPlan 叫"原样"；换了身体，每片零件按"新身体 ÷ 原样"贴到新的骨头上（fit.ts）：
 * - 躯干：臀片、胸片前后按髋到肩的距离拉，上下按臀、胸的高度拉；
 * - 腿：每节先按粗细（大腿、上臂按 thighW，其余按 legW）整片缩放，再只拉关节之间的杆，补足长度（hindSegs / foreSegs）；
 *   远侧的腿复用近侧的零件、调暗，长短永远一样；
 * - 头：按头的大小整片缩放，吻按嘴型拉长或缩短；耳朵按耳长、耳宽（外观参数）；
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
  private tailSprings: Spring[] = [];
  private earSprings: Spring[] = [];
  private lastHipY = 0;
  private lastHead = 0;
  private time = 0;
  /** 站姿：成品图画的就是站姿，头和尾巴的角度都相对它算。 */
  private rest!: Pose;

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

  /** 换身体：每片零件贴到新的骨头上，算出插口和铆钉。 */
  build(plan: BodyPlan): void {
    this.plan = plan;
    this.rest = standPose(plan);
    const { rig } = this.data;
    const ref = this.ref;
    const shapes = new Map<string, Shape>();
    const fitted = this.fitted;
    fitted.clear();
    // 用一个“成品图坐标里、以零件转轴为原点”的变换 w 贴一片零件，插口（成品图里的点）一起变。
    const fitPiece = (id: string, w: Warp, sockets: Record<string, P>): void => {
      const p = this.part(id);
      // 零件坐标 → 成品图坐标（以转轴为原点）→ 变换 → 零件坐标。
      const f: Warp = (x, y) => {
        const [X, Y] = rot([x, y], p.angle);
        return rot(w(X, Y), -p.angle);
      };
      shapes.set(id, mapShape({ outline: p.outline, stripe: p.stripe, pale: p.pale }, f));
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
    for (const e of rig.ears) headSockets[e] = piv(e);
    fitPiece(rig.head, headWarp, headSockets);
    // 下颌在头的变换里变（它是从头上切下来的），再挪回自己的转轴。
    const jawPiv = piv(rig.jaw);
    const jawAt = headWarp(...sub(jawPiv, head.pivot));
    fitPiece(rig.jaw, (x, y) => sub(headWarp(x + jawPiv[0] - head.pivot[0], y + jawPiv[1] - head.pivot[1]), jawAt), {});
    const earK = plan.earH / plan.headR / (ref.earH / ref.headR);
    for (const e of rig.ears) {
      const ear = this.part(e);
      const dir = rot([1, 0], ear.angle);
      const base: P = [dir[0] * ear.lapR * 0.6, dir[1] * ear.lapR * 0.6];
      fitPiece(e, compose(regionStretch(base, dir, earK, plan.earW / ref.earW), scale(kh)), {});
    }

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
    this.tailSprings = this.tail.map(() => ({ x: 0, v: 0 }));

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
    for (const e of rig.ears) pin(e, rig.head, so(rig.head, e), lapW(e, kh));
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
    const pitchRest = Math.atan2(this.rest.shoulderY - this.rest.hipY, plan.shoulderX - plan.hipX);
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

    // 尾巴、耳朵的弹簧（同 Puppet）。
    if (dt > 0) {
      const vy = (pose.hipY - this.lastHipY) / dt / Math.max(0.05, plan.legLen);
      const omega = pendulumOmega(plan.tailLen) * 2.2;
      const swish = 0.18 * Math.sin(this.time * omega * 0.18) * Math.sin(this.time * 0.37);
      let lead = Math.max(-0.6, Math.min(0.6, vy * 0.12));
      this.tailSprings.forEach((sp, i) => {
        springStep(sp, lead + (i === this.tailSprings.length - 1 ? swish : 0), omega, 0.32, dt);
        lead = sp.x * 0.85;
      });
      const headAng = pose.neck + pose.head;
      const hv = (headAng - this.lastHead) / dt;
      const earOmega = pendulumOmega(plan.earH) * 1.6;
      for (const sp of this.earSprings) springStep(sp, Math.max(-0.5, Math.min(0.5, -hv * 0.05)), earOmega, 0.28, dt);
      this.lastHead = headAng;
    }
    this.lastHipY = pose.hipY;
    rig.ears.forEach((id, i) => this.cut.place(id, ...at(headV, rHead, so(rig.head, id)), this.part(id).angle + aHead + this.earSprings[i]!.x));

    // 尾巴：尾根挂在臀片上，抬起 pose.tail；每节在上一节的基础上再转自己的弹簧（和 tailCurl）。
    // 有地面时尾巴不钻地：哪一节的末端低于地面（加半个尾巴粗），这一节就往上转到贴着地面——坐着时尾巴顺着地面拖出去。
    let pos = at(midV, rHind, so(rig.hind, 'tail'));
    let a = aHind + pose.tail - this.rest.tail;
    this.tail.forEach((id, i) => {
      a += this.tailSprings[i]!.x + (i > 0 ? (extra.tailCurl ?? 0) : 0);
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
