import { type Group, type Mesh } from 'three';
import { bake } from './bake';
import { buildVan, type VanParts } from './body';
import { buildInterior, type Interior } from './interior';

/**
 * 「阿宝」：车身 + 里面 + 它的表情（2026-11-25）。
 * 表情就是游戏的反馈（docs/research/studio.md）：平时眼皮半闭、轻轻呼吸；来信时耳朵朝前、眼睛睁圆、铃铛晃、嘴里叼出信；
 * 停下来支开（营地）：后门打开、雕花板放下成桌、篷子展开。
 */
export class Van {
  readonly parts: VanParts;
  readonly inside: Interior;
  private t = 0;
  private lid = 0.45;
  private lidGoal = 0.45;
  private ear = 0;
  private earGoal = 0;
  private ringT = 0;
  private camp = 0;
  private campGoal = 0;
  private doors = 0;
  private doorsGoal = 0;
  private pingT = 0;
  private blinkT = 3;
  night = 0;

  constructor(seed = 11) {
    this.parts = buildVan(seed);
    this.inside = buildInterior(this.parts.interior, seed);
    // 会动的零件不合批；其余的按材质合成几个大网格（bake.ts）。
    const p = this.parts;
    const nb = (o: { userData: Record<string, unknown> } | null | undefined): void => {
      if (o) o.userData['noBake'] = true;
    };
    for (const l of [...p.lids, ...p.smallLids]) nb(l.parent?.parent);
    for (const o of [...p.ears, ...p.doors, p.flap, p.awning, p.awningRoll, p.bell, p.letter, ...p.smoke, p.nearSide, p.interior]) nb(o);
    nb(p.tail.userData['tassel'] as Group);
    nb(p.vane.userData['top'] as Group);
    bake(p.root);
    bake(p.nearSide);
  }

  get root(): Group {
    return this.parts.root;
  }

  /** 剖开（把 -z 那一侧的墙藏起来）：在"家"的视角里看里面。 */
  setCutaway(on: boolean): void {
    this.parts.nearSide.visible = !on;
  }

  setCamp(on: boolean): void {
    this.campGoal = on ? 1 : 0;
    this.doorsGoal = on ? 1 : this.doorsGoal;
  }

  setDoors(open: boolean): void {
    this.doorsGoal = open ? 1 : 0;
  }

  /** 眼皮：0 闭上，1 睁开。 */
  setEyes(open: number): void {
    this.lidGoal = open;
  }

  /** 来信了。 */
  ping(): void {
    this.pingT = 3.2;
    this.ringT = 1.6;
  }

  update(dt: number): void {
    this.t += dt;
    const p = this.parts;
    const k = (r: number): number => 1 - Math.exp(-dt * r);
    if (this.pingT > 0) this.pingT -= dt;
    const pinging = this.pingT > 0;
    // 眨眼：每隔几秒眨一下。
    this.blinkT -= dt;
    let blink = 0;
    if (this.blinkT < 0.16) blink = Math.sin(Math.max(0, this.blinkT / 0.16) * Math.PI);
    if (this.blinkT < 0) this.blinkT = 3 + ((this.t * 7.3) % 4);
    this.lid += ((pinging ? 1 : this.lidGoal) - this.lid) * k(pinging ? 14 : 4);
    const open = Math.max(0, this.lid - blink * this.lid);
    // 眼皮往下拉：盖住眼睛的比例 = 1 − 睁开（半闭时盖住一大半，像在打盹）。
    const cover = Math.min(1, Math.max(0.04, 1 - open * 0.9));
    for (const l of [...p.lids, ...p.smallLids]) (l.userData['pivot'] as Group).scale.y = cover * 2;
    this.earGoal = pinging ? 1 : 0;
    this.ear += (this.earGoal - this.ear) * k(pinging ? 16 : 3);
    p.ears.forEach((e, i) => {
      const s = i === 0 ? 1 : -1;
      e.rotation.y = s * (-0.35 + this.ear * 0.55) + Math.sin(this.t * 0.7 + i) * 0.03;
      e.rotation.z = this.ear * 0.18 * s;
    });
    // 铃铛：来信时晃。
    this.ringT = Math.max(0, this.ringT - dt);
    p.bell.rotation.x = Math.sin(this.t * 18) * 0.5 * this.ringT * this.ringT;
    p.letter.visible = pinging || this.lidGoal > 0.2;
    p.letter.position.y = 0.98 + (pinging ? Math.min(1, (3.2 - this.pingT) * 4) * 0.04 : 0);
    // 呼吸：车身轻轻起伏。
    p.root.scale.y = 1 + Math.sin(this.t * 1.4) * 0.003;
    // 风向标转一转。
    (p.vane.userData['top'] as Group).rotation.y = Math.sin(this.t * 0.31) * 0.6 + Math.sin(this.t * 1.7) * 0.06;
    // 烟囱的烟：几团纸卷一样的白烟往上飘、变大、变淡。
    for (const s of p.smoke) {
      const ph = ((this.t * 0.18 + (s.userData['phase'] as number)) % 1 + 1) % 1;
      s.position.set(0.82 - ph * 0.5, 2.68 + 0.5 + ph * 0.9, -0.42 - ph * 0.15);
      s.scale.setScalar(0.6 + ph * 1.6);
      const m = s.material as Mesh['material'] & { opacity: number; transparent: boolean };
      m.transparent = true;
      m.opacity = Math.sin(ph * Math.PI) * 0.85;
    }
    // 尾巴的流苏晃一晃。
    const tassel = p.tail.userData['tassel'] as Group;
    tassel.rotation.z = Math.sin(this.t * 1.3) * 0.12;
    tassel.rotation.x = Math.sin(this.t * 0.9) * 0.1;
    // 营地：篷子、雕花板、后门。
    this.camp += (this.campGoal - this.camp) * k(3);
    this.doors += (this.doorsGoal - this.doors) * k(3);
    p.awning.visible = this.camp > 0.02;
    p.awning.scale.set(1, 0.3 + 0.7 * this.camp, 0.2 + 0.8 * this.camp);
    p.awning.position.set(0, (1 - this.camp) * 1.6, (1 - this.camp) * 0.8);
    p.awningRoll.visible = this.camp < 0.98;
    p.awningRoll.scale.setScalar(1 - 0.6 * this.camp);
    p.flap.rotation.x = this.camp * (Math.PI / 2);
    p.doors.forEach((d, i) => (d.rotation.y = (i === 0 ? 1 : -1) * 1.5 * this.doors));
    // 夜里眼睛是暖的。
    p.eyeGlow.emissiveIntensity = 0.15 + this.night * 1.4;
    this.inside.update(dt, this.t);
  }
}
