import { Assets, Container, type Texture } from 'pixi.js';
import type { GaitRules } from '../../data/schema/gait';
import type { CutData, Dye } from './cutout';
import { CutoutPuppet } from './cutoutPuppet';
import { breathsPerMin, chewHz, gaitOf, topSpeed, walkSpeed } from './gait';
import { intermembralOf, type BodyPlan } from './plan';
import { blendPose, eatPose, gaitPose, liePose, standPose, type Pose } from './pose';

/**
 * 纸偶演员（2026-11-11）：设计台上那只纸偶，放到别的画面里自己演——站、走、跑、吃、趴。
 * 和设计台用同一个身体（BodyPlan）、同一套姿态和缩放律：步频随腿长，走还是跳由腿的几何定，呼吸随体重。
 * 只是画面，不读也不改推演。
 */

/** 切图零件和纸纹（一套成品图），以及成品图画的那条现有技术的身体。 */
export interface RigKit {
  data: CutData;
  paper: Texture;
  ref: BodyPlan;
}

const CUT_DATA = import.meta.glob<unknown>('../../../art/incoming/lovart/paper/cuts/*/vector.json', { import: 'default' });
const CUT_PAPER = import.meta.glob<string>('../../../art/incoming/lovart/paper/cuts/*/paper.png', { query: '?url', import: 'default' });

/** 载入一套切图零件。refOf 按成品图画的模板（data.rig.template）给出它的 BodyPlan。 */
export async function loadRigKit(cut: string, refOf: (template: string) => BodyPlan): Promise<RigKit> {
  const dir = `../../../art/incoming/lovart/paper/cuts/${cut}`;
  const data = (await CUT_DATA[`${dir}/vector.json`]!()) as CutData;
  const paper = (await Assets.load(await CUT_PAPER[`${dir}/paper.png`]!())) as Texture;
  paper.source.addressMode = 'repeat';
  return { data, paper, ref: refOf(data.rig.template) };
}

export type ActorMode = 'stand' | 'walk' | 'run' | 'eat' | 'lie';

/** 换姿势用多久（秒）：大动物慢一些（按 √腿长）。 */
const blendTime = (legM: number): number => 0.25 + 0.5 * Math.sqrt(legM);

export class PuppetActor {
  /** 脚底中点在原点，头朝 +x；要朝左就把 view.scale.x 取负。 */
  readonly view = new Container();
  private readonly puppet: CutoutPuppet;
  private mode: ActorMode = 'stand';
  private from: Pose | null = null;
  private w = 1;
  private phase: number;
  private time: number;
  private breath = 0;
  private last: Pose;
  /** 走、跑的速度（米/秒），由身体定。 */
  readonly walkMs: number;
  readonly runMs: number;

  constructor(
    kit: RigKit,
    readonly plan: BodyPlan,
    dye: Dye,
    private readonly rules: GaitRules,
    /** 推演里腿长带来的速度倍数（params.body.speed）。 */
    speedFactor = 1,
    /** 每只演员错开一点，不会齐步走。 */
    seed = 0,
  ) {
    this.puppet = new CutoutPuppet(kit.data, kit.paper, dye, kit.ref, plan);
    this.puppet.build(plan);
    this.view.addChild(this.puppet.view);
    this.phase = seed % 1;
    this.time = seed * 7;
    this.walkMs = walkSpeed(rules, plan.legLen);
    this.runMs = Math.min(topSpeed(rules, plan.massKg, speedFactor) * 0.55, Math.max(this.walkMs * 2.2, this.walkMs + 0.5));
    this.last = standPose(plan);
  }

  /** 身长（头体长）在画面上占多少像素。 */
  setLength(px: number): void {
    this.puppet.setScale(px / this.plan.bodyLen);
  }

  /** 这种姿态下在地上走多快（米/秒）；站、吃、趴是 0。 */
  speedOf(mode: ActorMode): number {
    return mode === 'walk' ? this.walkMs : mode === 'run' ? this.runMs : 0;
  }

  setMode(mode: ActorMode): void {
    if (mode === this.mode) return;
    this.from = this.last;
    this.w = 0;
    this.mode = mode;
  }

  step(dt: number): void {
    const { plan, rules } = this;
    this.time += dt;
    const speed = this.speedOf(this.mode);
    const gs = gaitOf(rules, speed, plan.legLen, intermembralOf(plan));
    this.phase = (this.phase + gs.strideHz * dt) % 1;
    let pose: Pose;
    if (this.mode === 'walk' || this.mode === 'run') pose = gaitPose(plan, gs, this.phase);
    else if (this.mode === 'eat') pose = eatPose(plan, this.time, chewHz(rules, plan.massKg));
    else if (this.mode === 'lie') pose = liePose(plan);
    else {
      const p = standPose(plan);
      pose = { ...p, head: p.head + 0.18 * Math.sin(this.time * 0.7) * Math.sin(this.time * 0.23), neck: p.neck + 0.08 * Math.sin(this.time * 0.31) };
    }
    if (this.from) {
      this.w = Math.min(1, this.w + dt / blendTime(plan.legLen));
      const t = this.w * this.w * (3 - 2 * this.w);
      pose = blendPose(this.from, pose, t);
      if (this.w >= 1) this.from = null;
    }
    this.last = pose;
    const rest = breathsPerMin(rules, plan.massKg) / 60;
    this.breath += (this.mode === 'run' ? Math.max(rest * 2.5, gs.strideHz) : this.mode === 'walk' ? rest * 1.5 : rest) * dt;
    this.puppet.apply(pose, dt, Math.sin(this.breath * Math.PI * 2));
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
