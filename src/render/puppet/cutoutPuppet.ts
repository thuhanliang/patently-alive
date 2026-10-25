import type { Container, Texture } from 'pixi.js';
import { Cutout, type CutData, type CutPart, type Dye } from './cutout';
import { pendulumOmega, springStep, type Spring } from './gait';
import { LEGS, isHind, type BodyPlan } from './plan';
import { legJoints, standPose, type Pose, type Vec } from './pose';

/**
 * 用成品图切出来的零件（cutout.ts）演设计台的动作：和 Puppet 一样吃 BodyPlan 和每帧的 Pose。
 *
 * 骨架的尺寸从零件上量（相邻铆钉之间的距离），不用 BodyPlan 的比例，所以关节处严丝合缝：
 * - 躯干：臀片绕髋按“肩比髋高多少”倾斜（相对成品图里的倾斜），胸片再绕中间的铆钉转 spine；
 * - 腿：四条腿各用自己量出的三节长度，用 pose.ts 的 legJoints 解出膝、踝、趾；每片零件放在自己的关节上，
 *   转角 = 成品图里的转角 + （解出来的骨头方向 − 成品图里的骨头方向）；
 * - 头：脖子 + 头的角度（相对站姿）直接给头片（这只猫没有单独的颈片）；下颌按 pose.jaw 张开；耳朵、尾巴用弹簧跟随（同 Puppet）。
 * 整体大小：成品图里髋的高度对上 BodyPlan 站立时髋的高度。
 *
 * 坐标：view 的原点在身体中点正下方的地面（同 Puppet），内部单位是成品图的像素，y 朝下。
 */

type P = [number, number];

export class CutoutPuppet {
  readonly view: Container;
  private readonly cut: Cutout;
  private plan!: BodyPlan;
  /** 米 / 成品图像素。 */
  private s = 1;
  private pxPerM = 1;
  private readonly piv = new Map<string, P>();
  private tailSprings: Spring[] = [];
  private earSprings: Spring[] = [];
  private lastHipY = 0;
  private lastHead = 0;
  private time = 0;
  /** 站姿：成品图画的就是站姿，头和尾巴的角度都相对它算。 */
  private rest!: Pose;

  constructor(
    readonly data: CutData,
    paper: Texture,
    dye: Dye,
    plan: BodyPlan,
  ) {
    this.cut = new Cutout(data, paper, dye);
    this.view = this.cut.view;
    for (const p of data.parts) this.piv.set(p.id, p.pivot);
    this.tailSprings = data.rig.tail.map(() => ({ x: 0, v: 0 }));
    this.earSprings = data.rig.ears.map(() => ({ x: 0, v: 0 }));
    this.build(plan);
  }

  /** 换身体：只用到体型大小（髋高）。 */
  build(plan: BodyPlan): void {
    this.plan = plan;
    this.rest = standPose(plan);
    const hipPx = this.data.rig.ground - this.pv(this.data.rig.legs.nearHind.parts[0])[1];
    this.s = this.rest.hipY / hipPx;
    this.setScale(this.pxPerM);
  }

  setScale(pxPerM: number): void {
    this.pxPerM = pxPerM;
    this.view.scale.set(pxPerM * this.s);
  }

  private pv(id: string): P {
    return this.piv.get(id)!;
  }

  private part(id: string): CutPart {
    return this.cut.part(id)!;
  }

  apply(pose: Pose, dt: number, breath = 0): void {
    const { rig } = this.data;
    const s = this.s;
    const plan = this.plan;
    this.time += dt;
    const hipImg = this.pv(rig.legs.nearHind.parts[0]);
    const shImg = this.pv(rig.legs.nearFore.parts[0]);
    const midImg = this.pv(rig.chest);
    const rot = (q: P, a: number): P => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    const add = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]];
    const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];

    // 躯干：肩比髋高多少 → 倾斜（相对成品图）。
    // 倾斜角按 BodyPlan 的髋肩距离算（和代码纸偶一样斜），再减去成品图里本来的倾斜。
    const pitch = Math.atan2(pose.shoulderY - pose.hipY, plan.shoulderX - plan.hipX);
    const pitchRest = Math.atan2(this.rest.shoulderY - this.rest.hipY, plan.shoulderX - plan.hipX);
    const aHind = -(pitch - pitchRest);
    const hipV: P = [plan.hipX / s, -pose.hipY / s];
    const hindAt = (q: P): P => add(hipV, rot(sub(q, hipImg), aHind));
    const midV = hindAt(midImg);
    const aChest = aHind - pose.spine;
    const chestAt = (q: P): P => add(midV, rot(sub(q, midImg), aChest));
    this.cut.place(rig.hind, ...midV, this.part(rig.hind).angle + aHind);
    this.cut.place(rig.chest, ...midV, this.part(rig.chest).angle + aChest, 1 + 0.03 * breath);

    // 腿：四条腿各自的三节长度。
    for (const k of LEGS) {
      const leg = rig.legs[k];
      const pts: P[] = [...leg.parts.map((id) => this.pv(id)), leg.toe];
      const segs = [0, 1, 2].map((i) => Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]) * s) as [number, number, number];
      const legPlan = isHind(k) ? { ...plan, hindSegs: segs } : { ...plan, foreSegs: segs };
      const rootV = (isHind(k) ? hindAt : chestAt)(pts[0]!);
      const root: Vec = { x: rootV[0] * s, y: -rootV[1] * s };
      const f = pose.feet[k];
      const j = legJoints(legPlan, k, root, { x: root.x + f.x, y: f.y }, pose.fold).map((v): P => [v.x / s, -v.y / s]);
      for (let i = 0; i < 3; i++) {
        const imgA = Math.atan2(pts[i + 1]![1] - pts[i]![1], pts[i + 1]![0] - pts[i]![0]);
        const viewA = Math.atan2(j[i + 1]![1] - j[i]![1], j[i + 1]![0] - j[i]![0]);
        this.cut.place(leg.parts[i]!, ...j[i]!, this.part(leg.parts[i]!).angle + viewA - imgA);
      }
    }

    // 头：这只猫没有颈片，用一节藏在胸片里的“虚拟脖子”（从肩的铆钉到头的铆钉）按 pose.neck 摆动，
    // 头的铆钉跟着它画弧；头片再按脖子 + 头相对站姿的角度转。下颌、耳朵跟着头。
    const headImg = this.pv(rig.head);
    const neckV = chestAt(shImg);
    const headV = add(neckV, rot(sub(headImg, shImg), -(pose.neck - this.rest.neck)));
    const aHead = -(pose.neck + pose.head - this.rest.neck - this.rest.head);
    const headAt = (q: P): P => add(headV, rot(sub(q, headImg), aHead));
    this.cut.place(rig.head, ...headV, this.part(rig.head).angle + aHead);
    this.cut.place(rig.jaw, ...headAt(this.pv(rig.jaw)), this.part(rig.jaw).angle + aHead + pose.jaw);

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
    rig.ears.forEach((id, i) => this.cut.place(id, ...headAt(this.pv(id)), this.part(id).angle + aHead + this.earSprings[i]!.x));
    // 尾巴：尾根挂在臀片上，抬起 pose.tail；每节在上一节的基础上再转自己的弹簧。
    let at: P = hindAt(this.pv(rig.tail[0]!));
    let a = aHind + pose.tail - this.rest.tail;
    rig.tail.forEach((id, i) => {
      a += this.tailSprings[i]!.x;
      this.cut.place(id, ...at, this.part(id).angle + a);
      const next = rig.tail[i + 1];
      if (next) at = add(at, rot(sub(this.pv(next), this.pv(id)), a));
    });
  }
}
