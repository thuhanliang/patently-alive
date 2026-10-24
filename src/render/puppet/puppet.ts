import { Container, Graphics } from 'pixi.js';
import { pendulumOmega, springStep, type Spring } from './gait';
import { LEGS, isHind, type BodyPlan, type LegKey } from './plan';
import { skeletonOf, type Pose, type Vec } from './pose';
import { anchors, drawChest, drawEar, drawHead, drawHind, drawJaw, drawLegSegment, drawNeck, drawTailSegment, partCtx, type Look } from './parts';

export { lookOf, type Look } from './parts';

/**
 * 剪纸纸偶（M1-1，代码画的占位零件）：每片纸挂在一根骨头上，绕关节的金色纸钉转。
 *
 * 和场景无关：给它身材（BodyPlan）和颜色，每帧给姿态（Pose），它就摆好。设计台用它，以后现场的近景、相机、纪录片也用它。
 * 每片零件的画法在 parts.ts（零件参考图也用它）；这里只把零件挂到骨头上、每帧摆姿态。
 * 画的先后：远侧的腿（调暗）→ 尾 → 臀 → 胸 → 颈 → 头 → 近侧的腿。
 *
 * 坐标：内部按"头体长 = 100 单位"画（小动物的圆也有足够的边数），view 的缩放由调用的人按每米多少像素设。
 * 原点在身体中点正下方的地面，朝右。
 */

/** 尾型：尾根往下垂多少（弧度）、每节往上卷多少、尾尖颜色深不深。只是画面。 */
const TAIL_STYLE: Record<string, { droop: number; curl: number }> = {
  balance_tail: { droop: 0.55, curl: -0.04 },
  bushy_tail: { droop: 0.4, curl: -0.1 },
  short_tail: { droop: -0.5, curl: 0 },
  fat_tail: { droop: 1.05, curl: 0.12 },
};

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
  /** 地上的影子（零件参考图里关掉）。 */
  shadow = new Graphics();
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
    const ctx = partCtx(plan, look);
    const k = (this.k = ctx.k);
    this.view.scale.set(scale / k || 1);
    const a = anchors(ctx);
    const part = (draw: (g: Graphics) => void, x = 0, y = 0): Container => {
      const c = new Container();
      c.position.set(x, y);
      const g = new Graphics();
      draw(g);
      c.addChild(g);
      return c;
    };

    // 地上的影子。
    this.shadow = new Graphics().ellipse(0, 0, 55, 5).fill({ color: 0x3a2a1a, alpha: 0.16 });
    this.view.addChild(this.shadow);

    // ---- 腿 ----
    const makeLeg = (key: LegKey): LegParts => {
      const group = new Container();
      const hind = isHind(key);
      const segs = ([0, 1, 2] as const).map((i) => group.addChild(part((g) => drawLegSegment(g, ctx, hind, i)))) as [Container, Container, Container];
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

    // 尾巴：挂在臀片后上方，画在臀片后面。
    const tailRoot = new Container();
    tailRoot.position.set(...a.tailRoot);
    this.torso.addChild(tailRoot);
    this.tail = [];
    this.tailRest = TAIL_STYLE[plan.parts.tail] ?? { droop: 0.8, curl: 0.1 };
    let parent: Container = tailRoot;
    for (let i = 0; i < plan.tailSegs; i++) {
      const c = part((g) => drawTailSegment(g, ctx, i), i > 0 ? a.tailSegL * 0.92 : 0, 0);
      parent.addChild(c);
      parent = c;
      this.tail.push(c);
    }
    this.tailSprings = this.tail.map(() => ({ x: 0, v: 0 }));

    // 臀片（带肚子）、胸片。
    this.torso.addChild(part((g) => drawHind(g, ctx)));
    this.chest = this.torso.addChild(part((g) => drawChest(g, ctx)));

    // 颈、头；下颌画在头片后面，远侧的耳朵在最后面。
    this.neck = this.chest.addChild(part((g) => drawNeck(g, ctx), ...a.neckRoot));
    this.head = this.neck.addChild(new Container());
    this.head.position.set(...a.head);
    const farEar = this.head.addChild(part((g) => drawEar(g, ctx, true), ...a.farEar));
    this.jaw = this.head.addChild(part((g) => drawJaw(g, ctx), ...a.jaw));
    this.head.addChild(part((g) => drawHead(g, ctx)));
    const nearEar = this.head.addChild(part((g) => drawEar(g, ctx, false), ...a.nearEar));
    this.ears = [farEar, nearEar];
    this.earSprings = this.ears.map(() => ({ x: 0, v: 0 }));

    // 近侧的腿最后画：盖在身体上，髋、肩的纸钉露在外面。
    for (const key of ['nearHind', 'nearFore'] as const) {
      this.legs[key] = makeLeg(key);
      this.view.addChild(this.legs[key].group);
    }
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
