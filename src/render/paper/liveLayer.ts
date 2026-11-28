import { Container, Graphics, Text } from 'pixi.js';
import { HAND, warm } from '../font';
import type { GaitRules } from '../../data/schema/gait';
import { countAt, decodeCause, type DerivedSpecies, type SimState, type SpeciesQuarter } from '../../sim';
import { TERRAIN } from '../../sim/terrain';
import type { Dye } from '../puppet/cutout';
import { PuppetActor, type RigKit } from '../puppet/actor';
import type { BodyPlan } from '../puppet/plan';
import { makeAnimal, puppetKindOf } from './animals';
import type { Sheet } from './assets';
import { rotate, type Cam } from './camera';
import { PX } from './terrain';
import { tokenLengthCells } from './tokens';

/**
 * 活的图层（2026-11-11）：小岛上不再画"每个时刻每只在哪"（倍速一开就是一帧一个随机位置），
 * 而是按真实的数量摆出一小群演员，照自己的节奏走动、吃、趴下——事务所设计的动物是会动的纸偶（和设计台同一个身体）。
 *
 * - 演员的只数随真实总数变（压缩过：20 只画 8 只，60 只以上画 14 只），站在真的有这种动物的格子附近；
 * - 这一季的出生和死亡（引擎记的账，见 Session.quarterSoFar）落在演员身上：生了，旁边冒出一只小的；
 *   死了，一只趴下、淡掉，头上一张小纸签写着怎么死的、几只。纸签上的数加起来就是账上的数。
 * 只是画面：不读个体，不改推演，也不需要把格子展开成个体。
 */

/** 一种设计物种的纸偶怎么搭：身体、三档颜色、推演里的速度倍数。 */
export interface RigSpec {
  plan: BodyPlan;
  dye: Dye;
  speedFactor: number;
}

type Doing = 'stand' | 'eat' | 'lie' | 'go';

/** 快照里的一只演员（见 LiveLayer.snapshot）。key 在演员活着时不变，拿来对应别的画面里的那一只。 */
export interface LiveActorView {
  key: object;
  s: number;
  id: string;
  x: number;
  y: number;
  face: number;
  len: number;
  grow: number;
  alpha: number;
  pop: number;
  rig: PuppetActor | null;
  hop: number;
  lying: boolean;
}
export interface LiveTagView {
  key: object;
  x: number;
  y: number;
  age: number;
  life: number;
  text: string;
  color: number;
}

interface Actor {
  s: number;
  box: Container;
  /** 左右翻转用的一层。 */
  inner: Container;
  rig: PuppetActor | null;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** 家：它出现的地方。只在家附近转，不会走到没有这种动物的地方去。 */
  hx: number;
  hy: number;
  doing: Doing;
  timer: number;
  /** 现在的速度，占走路速度的几成（0–1）：起步、停步都有个过程，不是一下子动起来。 */
  v: number;
  /** 脸朝哪边（−1 左，1 右）：转身时从一边压扁了翻到另一边，像把纸片翻个面。 */
  face: number;
  want: number;
  age: number;
  /** 幼崽：从小长到大（0–1）。 */
  grow: number;
  /** 正在淡掉（秒）；null 是活着。 */
  dying: number | null;
  /** 身长（剪纸像素，没放大以前）。 */
  len: number;
  /** 正在扑谁（它吃掉的那一只）；扑到了那一只才倒下。 */
  hunt: { prey: Actor; label: string; left: number } | null;
  /** 正被谁追着。 */
  hunted: boolean;
  /** 这一帧画面上放大了几倍（layout 里定）：走路的快慢按画出来的身长算，脚才不打滑。 */
  shown: number;
  seed: number;
}

interface Tag {
  box: Container;
  x: number;
  y: number;
  age: number;
  lift: number;
}

const TAG_LIFE = 2.2;
/** 岛上的纸偶只有几十像素：白边、投影、纸纹放大这么多倍才看得出是剪纸。 */
const FIELD_DETAIL = 3.2;
const MINE_CAP = 14;
const OTHER_CAP = 12;
/** 演员在屏幕上的身长不小于这么多像素（主角大一些）。 */
const MIN_PX = 30;
const MINE_MIN_PX = 54;
/** 演员的身长（剪纸像素）：和代表单位一样按体重压缩着变，主角画得大一些。 */
const lengthOf = (massKg: number, mine: boolean): number => tokenLengthCells(massKg) * PX * (mine ? 1.5 : 0.62);
/** 演员离家最远几格（左右）。 */
const LEASH_CELLS = 2.2;
/** 起步、停步用多久（秒）。 */
const ACCEL_S = 0.45;
/** 转身用多久（秒）。 */
const TURN_S = 0.28;

const isMine = (id: string): boolean => id.startsWith('d_');

/** 真实总数 → 画几只演员。 */
export function actorCount(total: number, mine: boolean): number {
  if (total <= 0) return 0;
  const n = Math.round((mine ? 2.2 : 1.6) * Math.pow(total, 0.45));
  return Math.max(1, Math.min(total, mine ? MINE_CAP : OTHER_CAP, n));
}

/** 死因纸签上的说法。 */
function causeLabel(cause: number, names: readonly string[]): string {
  const d = decodeCause(cause, names.length);
  switch (d.kind) {
    case 'starvation':
      return '饿死';
    case 'malnutrition':
      return '营养不良';
    case 'fracture':
      return '骨折';
    case 'dystocia':
      return '难产';
    case 'parasite':
      return '虫病';
    case 'predation':
      return `被${names[d.predator]}吃掉`;
    case 'nest':
      return `窝被${names[d.predator]}端了`;
    case 'removed':
      return '被移走';
    case 'other':
      return '老死病死';
  }
}

export class LiveLayer {
  private bill: Container | null = null;
  private species: readonly DerivedSpecies[] = [];
  private actors: Actor[] = [];
  private tags: Tag[] = [];
  private kit: RigKit | null = null;
  private readonly rigs = new Map<string, RigSpec>();
  private rnd: number;
  private sinceCensus = 1;
  /** 上一次看到的这一季的账（按物种 id）。 */
  private prev = new Map<string, { births: number; deaths: Map<number, number> }>();
  /** 攒着还没演出来的出生和死亡。 */
  private pending = new Map<string, { births: number; deaths: Map<number, number>; wait: number }>();

  constructor(
    private readonly P7: Sheet | null,
    private readonly rules: GaitRules,
    /** 一格在剪纸里占多少像素（小地图细分以后是 PX 的几倍）。 */
    private readonly cellPx: number,
    seed: number,
    /** 演出了一次出生或死亡（主角的）：外面拿去配一声。 */
    private readonly onEvent?: (kind: 'birth' | 'death') => void,
  ) {
    this.rnd = (seed * 2654435761) >>> 0 || 1;
  }

  private random(): number {
    this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) >>> 0;
    return this.rnd / 0x1_0000_0000;
  }

  attach(bill: Container): void {
    this.bill = bill;
    for (const a of this.actors) bill.addChild(a.box);
    for (const t of this.tags) bill.addChild(t.box);
  }

  setKit(kit: RigKit): void {
    this.kit = kit;
    this.rebuild();
  }

  setRig(id: string, spec: RigSpec): void {
    this.rigs.set(id, spec);
    this.rebuild();
  }

  setSpecies(species: readonly DerivedSpecies[]): void {
    this.species = species;
    this.rebuild();
  }

  /** 换了物种、纸偶的搭法：演员全部重来。 */
  private rebuild(): void {
    for (const a of this.actors) this.dispose(a, false);
    for (const list of this.spare.values()) for (const r of list) r.destroy();
    this.spare.clear();
    this.actors = [];
    this.sinceCensus = 1;
  }

  /** 用过的纸偶收在这里（按物种），下次要用先从这里拿：搭一只纸偶要把每片零件贴一遍骨头，很费。 */
  private readonly spare = new Map<string, PuppetActor[]>();
  /** 这一帧还能新搭几只纸偶（一帧最多一只，不然一下子生十只会顿一下）。 */
  private buildsLeft = 1;

  private dispose(a: Actor, keepRig = true): void {
    if (a.rig) {
      if (keepRig) {
        a.rig.view.removeFromParent();
        const id = this.species[a.s]?.params.id ?? '';
        const list = this.spare.get(id) ?? [];
        list.push(a.rig);
        this.spare.set(id, list);
      } else a.rig.destroy();
    }
    a.box.destroy({ children: true });
  }

  /** 这一季到目前为止的账（每帧给一次）：和上一次比，多出来的出生、死亡攒起来等着演。 */
  setTally(rows: readonly SpeciesQuarter[]): void {
    for (const q of rows) {
      let p = this.prev.get(q.id);
      const deaths = new Map(q.deaths);
      // 新的一季（账清零了）：从零比起。
      if (!p || q.births < p.births || [...p.deaths].some(([c, n]) => (deaths.get(c) ?? 0) < n)) p = { births: 0, deaths: new Map() };
      let pend = this.pending.get(q.id);
      if (!pend) this.pending.set(q.id, (pend = { births: 0, deaths: new Map(), wait: 0 }));
      pend.births += q.births - p.births;
      for (const [c, n] of deaths) {
        const d = n - (p.deaths.get(c) ?? 0);
        if (d > 0) pend.deaths.set(c, (pend.deaths.get(c) ?? 0) + d);
      }
      this.prev.set(q.id, { births: q.births, deaths });
    }
  }

  update(state: Readonly<SimState>, dt: number): void {
    if (!this.bill) return;
    // 一帧最多新搭一只纸偶；帧很慢的时候（软件渲染、截图）按时间多搭几只，不然半天补不齐。
    this.buildsLeft = Math.max(1, Math.min(6, Math.round(dt * 20)));
    this.sinceCensus += dt;
    if (this.sinceCensus >= 0.5) {
      this.sinceCensus = 0;
      this.census(state);
    }
    this.playEvents(state, dt);
    for (const a of this.actors) this.stepActor(a, state, dt);
    this.actors = this.actors.filter((a) => {
      if (a.dying !== null && a.dying >= 1.4) {
        this.dispose(a);
        return false;
      }
      return true;
    });
    for (const t of this.tags) t.age += dt;
    this.tags = this.tags.filter((t) => {
      if (t.age >= TAG_LIFE) {
        t.box.destroy({ children: true });
        return false;
      }
      return true;
    });
  }

  /** 按真实总数增减演员；站的地方已经没有这种动物了的，换个地方。 */
  private census(state: Readonly<SimState>): void {
    this.species.forEach((sp, s) => {
      const pop = state.populations[s];
      if (!pop) return;
      const total = state.lastDay[s]?.total ?? 0;
      const want = actorCount(total, isMine(sp.params.id));
      const mine = this.actors.filter((a) => a.s === s && a.dying === null);
      for (let k = mine.length; k < want; k++) {
        const at = this.pickCell(state, s);
        if (at && !this.spawn(state, s, at.x, at.y, false)) {
          // 这一帧搭不了了，下一帧接着补。
          this.sinceCensus = 0.5;
          break;
        }
      }
      // 多出来的悄悄退场（不带纸签：纸签只给账上记了的死亡）。
      for (let k = want; k < mine.length; k++) mine[k]!.dying = 0.6;
      const { width } = state.grid;
      for (const a of mine.slice(0, want)) {
        const cx = Math.floor(a.hx / this.cellPx);
        const cy = Math.floor(a.hy / this.cellPx);
        let near = 0;
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) near += countAt(pop, Math.max(0, Math.min(state.grid.height - 1, cy + dy)) * width + Math.max(0, Math.min(width - 1, cx + dx)));
        // 站的地方已经没有这种动物了：这一只悄悄退场，下一轮在有的地方补一只（不让它横穿整座岛跑过去）。
        if (near === 0) a.dying = 0.6;
      }
    });
  }

  /** 按这种动物在各格的数量抽一格，返回格子里的一个点（剪纸像素）。 */
  private pickCell(state: Readonly<SimState>, s: number): { x: number; y: number } | null {
    const pop = state.populations[s]!;
    const n = state.grid.width * state.grid.height;
    let total = 0;
    for (let c = 0; c < n; c++) total += countAt(pop, c);
    if (total === 0) return null;
    let r = this.random() * total;
    for (let c = 0; c < n; c++) {
      r -= countAt(pop, c);
      if (r < 0) return { x: ((c % state.grid.width) + this.random()) * this.cellPx, y: (Math.floor(c / state.grid.width) + this.random()) * this.cellPx };
    }
    return null;
  }

  private spawn(state: Readonly<SimState>, s: number, x: number, y: number, young: boolean): Actor | null {
    const sp = this.species[s]!;
    const id = sp.params.id;
    const mine = isMine(id);
    const len = lengthOf(sp.params.bodyMassKg, mine);
    const spec = this.rigs.get(id);
    const box = new Container();
    const inner = new Container();
    const seed = this.random();
    const shadow = new Graphics().ellipse(len * 0.05, 0, len * 0.45, len * 0.1).fill({ color: 0x241a10, alpha: 0.28 });
    let rig: PuppetActor | null = null;
    if (spec && this.kit) {
      rig = this.spare.get(id)?.pop() ?? null;
      if (!rig) {
        // 这一帧已经搭过一只了：这一只下一帧再来（返回 null，调用的一方下次再试）。
        if (this.buildsLeft <= 0) {
          shadow.destroy();
          inner.destroy();
          box.destroy();
          return null;
        }
        this.buildsLeft -= 1;
        rig = new PuppetActor(this.kit, spec.plan, spec.dye, this.rules, spec.speedFactor, seed, FIELD_DETAIL);
      }
      rig.view.alpha = 1;
      rig.setLength(len);
      inner.addChild(rig.view);
    } else {
      inner.addChild(makeAnimal(this.P7, puppetKindOf(id), len, 0, false));
    }
    box.addChild(shadow, inner);
    const face = this.random() < 0.5 ? -1 : 1;
    inner.scale.x = face;
    const a: Actor = { s, box, inner, rig, x, y, tx: x, ty: y, hx: x, hy: y, doing: 'stand', timer: this.random() * 2, v: 0, face, want: face, age: 0, grow: young ? 0 : 1, dying: null, len, shown: 1, seed, hunt: null, hunted: false };
    this.actors.push(a);
    this.bill?.addChild(box);
    void state;
    return a;
  }

  /** 把攒着的出生、死亡演出来：每种动物大约一秒演一次，数加起来不变。 */
  private playEvents(state: Readonly<SimState>, dt: number): void {
    const names = this.species.map((sp) => sp.params.name);
    this.species.forEach((sp, s) => {
      const id = sp.params.id;
      const pend = this.pending.get(id);
      if (!pend) return;
      pend.wait -= dt;
      if (pend.wait > 0) return;
      const mine = isMine(id);
      const alive = this.actors.filter((a) => a.s === s && a.dying === null);
      let played = false;
      if (pend.births > 0 && alive.length > 0) {
        const parent = alive[Math.floor(this.random() * alive.length)]!;
        // 只给主角的出生贴纸签；别的动物只冒出一只小的。
        if (mine) {
          this.tag(parent, `生了 ${pend.births} 只`, 0x3d6b3a);
          this.onEvent?.('birth');
        }
        if (alive.length < (mine ? MINE_CAP : OTHER_CAP) + 2) this.spawn(state, s, parent.x + (this.random() - 0.5) * parent.len, parent.y + (this.random() - 0.5) * parent.len * 0.5, true);
        pend.births = 0;
        played = true;
      } else if (pend.births > 0 && alive.length === 0) pend.births = 0;
      if (pend.deaths.size > 0) {
        // 一次演死得最多的那一种；主角的每种死因都演，别的动物只演被吃掉和窝被端。
        const list = [...pend.deaths].filter(([c]) => mine || ['predation', 'nest'].includes(decodeCause(c, names.length).kind)).sort((a, b) => b[1] - a[1]);
        if (list.length === 0) pend.deaths.clear();
        const top = list[0];
        if (top) {
          pend.deaths.delete(top[0]);
          const victim = alive[Math.floor(this.random() * alive.length)];
          const label = `${causeLabel(top[0], names)} ${top[1]} 只`;
          const dc = decodeCause(top[0], names.length);
          // 被事务所设计的动物吃掉的：让最近的那只主角真的跑过去扑它，扑到了再倒下、出纸签。
          const hunter =
            victim && dc.kind === 'predation' && isMine(this.species[dc.predator]?.params.id ?? '')
              ? this.actors
                  .filter((a) => a.s === dc.predator && a.dying === null && !a.hunt && a.grow === 1)
                  .sort((a, b) => Math.hypot(a.x - victim.x, a.y - victim.y) - Math.hypot(b.x - victim.x, b.y - victim.y))[0]
              : undefined;
          if (victim && hunter && Math.hypot(hunter.x - victim.x, hunter.y - victim.y) < 14 * this.cellPx) {
            hunter.hunt = { prey: victim, label, left: 4 };
            victim.hunted = true;
          } else if (victim) {
            this.tag(victim, label, 0x8a4a34);
            victim.dying = 0;
            if (mine) this.onEvent?.('death');
            victim.doing = 'lie';
            victim.rig?.setMode('lie');
          }
          played = true;
        }
      }
      if (played) pend.wait = 0.9 + this.random() * 0.4;
    });
  }

  private tag(at: Actor, text: string, color: number): void {
    void warm(text);
    const label = new Text({
      text,
      style: { fontFamily: HAND, fontSize: 26, fill: color, fontWeight: '700', stroke: { color: 0xfbf5e6, width: 6, join: 'round' } },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    const box = new Container();
    box.addChild(label);
    this.tags.push({ box, x: at.x, y: at.y, age: 0, lift: at.len * 1.1 });
    this.bill?.addChild(box);
  }

  private stepActor(a: Actor, state: Readonly<SimState>, dt: number): void {
    a.age += dt;
    if (a.grow < 1) a.grow = Math.min(1, a.grow + dt / 10);
    if (a.dying !== null) {
      a.dying += dt;
      a.box.alpha = Math.max(0, 1 - Math.max(0, a.dying - 0.5) / 0.9);
      a.v = Math.max(0, a.v - dt / ACCEL_S);
      a.rig?.setSpeed(0);
      a.rig?.step(dt);
      return;
    }
    // 被追着的：往远离的方向逃（逃不掉——账上它已经被吃了）。
    if (a.hunted && a.doing !== 'go') {
      a.doing = 'go';
      a.tx = a.x + a.want * a.len * a.shown * 6;
      a.ty = a.y;
      a.timer = 5;
    }
    // 扑食：盯着猎物跑（比走快），扑到了或者追了太久就结束——猎物倒下、出纸签，自己停下来吃。
    if (a.hunt) {
      const h = a.hunt;
      h.left -= dt;
      a.tx = h.prey.x;
      a.ty = h.prey.y;
      a.doing = 'go';
      a.timer = 5;
      if (Math.hypot(h.prey.x - a.x, h.prey.y - a.y) < a.len * a.shown * 0.55 || h.left <= 0 || h.prey.dying !== null) {
        if (h.prey.dying === null) {
          this.tag(h.prey, h.label, 0x8a4a34);
          h.prey.dying = 0;
          h.prey.hunted = false;
          h.prey.rig?.setMode('lie');
        }
        a.hunt = null;
        a.tx = a.x;
        a.ty = a.y;
        a.doing = 'eat';
        a.timer = 3;
        a.hx = a.x;
        a.hy = a.y;
      }
    }
    a.timer -= dt;
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const dist = Math.hypot(dx, dy);
    // 画面上一个身长是多少剪纸像素（已经算上放大），一秒走几个身长由身体定。
    const body = a.len * a.shown * (0.45 + 0.55 * a.grow);
    const lengthsPerS = a.rig ? a.rig.walkMs / a.rig.plan.bodyLen : 1.3;
    // 扑食、逃命的时候跑起来（按身体的奔跑速度，最多三倍于走）。
    const hurry = a.hunt || a.hunted ? Math.min(3, a.rig ? a.rig.runMs / a.rig.walkMs : 2.2) : 1;
    const top = lengthsPerS * body * hurry;
    // 离目标近了就提前收步：按现在的速度和停步要的时间算刹车距离。
    const going = a.doing === 'go' && dist > 0.5 && dist > 0.5 * a.v * top * ACCEL_S;
    if (a.doing === 'go' && Math.abs(dx) > 1) a.want = dx < 0 ? -1 : 1;
    // 转身：先停一停，纸片翻过来，再走。
    const turning = Math.sign(a.face) !== a.want || Math.abs(a.face) < 1;
    a.face += Math.sign(a.want - a.face) * Math.min(Math.abs(a.want - a.face), (2 * dt) / TURN_S);
    a.inner.scale.x = (a.face < 0 ? -1 : 1) * Math.max(0.08, Math.abs(a.face));
    const vTarget = going && !turning ? 1 : 0;
    a.v += Math.sign(vTarget - a.v) * Math.min(Math.abs(vTarget - a.v), dt / ACCEL_S);
    if (a.v > 0 && dist > 1e-6) {
      const step = Math.min(dist, a.v * top * dt);
      a.x += (dx / dist) * step;
      a.y += (dy / dist) * step;
    }
    if (a.doing === 'go' ? (dist <= 0.5 && a.v < 0.05) || a.timer <= 0 : a.timer <= 0) this.next(a, state);
    if (a.rig) {
      a.rig.setMode(a.doing === 'go' ? 'stand' : a.doing);
      a.rig.setSpeed(a.v * a.rig.walkMs * hurry);
      a.rig.step(dt);
    } else {
      // 整只剪纸的（鸟）：走的时候一颠一颠。
      a.inner.y = -Math.abs(Math.sin((a.age + a.seed * 9) * 9)) * a.len * 0.08 * a.v;
    }
  }

  /** 这一段做完了，接着做什么：走一段 → 吃 / 站 / 趴 → 再走。 */
  private next(a: Actor, state: Readonly<SimState>): void {
    const r = this.random();
    if (a.doing === 'go') a.doing = r < 0.5 ? 'eat' : r < 0.78 ? 'stand' : r < 0.92 ? 'lie' : 'go';
    else a.doing = r < 0.85 ? 'go' : 'stand';
    if (a.doing !== 'go') {
      a.timer = a.doing === 'eat' ? 2.5 + this.random() * 3 : a.doing === 'lie' ? 3 + this.random() * 4 : 1 + this.random() * 2;
      return;
    }
    // 纸偶是侧面的：走的路线基本是横着的，只带一点上下，不会"一边迈步一边横着飘"。
    // 尽量落在草地、海岸上（灌丛里会被叶子挡住）；实在找不到就原地站着。
    const { width, height, terrain } = state.grid;
    const body = a.len * a.shown;
    let found = false;
    for (let k = 0; k < 14 && !found; k++) {
      // 离家远了就往回走；不远就多半顺着现在的方向。
      const away = (a.x - a.hx) / (LEASH_CELLS * this.cellPx);
      const side = Math.abs(away) > 1 ? -Math.sign(away) : this.random() < 0.65 ? a.want : -a.want;
      const run = side * (2 + this.random() * 5) * body;
      const tx = a.x + run;
      const ty = a.y + run * (this.random() - 0.5) * 0.5 - (a.y - a.hy) * 0.3;
      const cx = Math.floor(tx / this.cellPx);
      const cy = Math.floor(ty / this.cellPx);
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const t = terrain[cy * width + cx];
      if (t === TERRAIN.water || (t === TERRAIN.shrub && k < 9)) continue;
      a.tx = tx;
      a.ty = ty;
      found = true;
    }
    if (!found) {
      a.doing = 'stand';
      a.timer = 1 + this.random();
      return;
    }
    a.timer = 14;
  }

  /**
   * 给别的画面（纸雕岛，2026-11-28）读的快照：演员和纸签都在"剪纸像素"坐标里（一格 = cellPx）。
   * 用了快照的画面不调 layout，由它自己用 setShown 定演员画多大（走路的快慢按画出来的身长算）。
   */
  snapshot(): { actors: LiveActorView[]; tags: LiveTagView[] } {
    return {
      actors: this.actors.map((a) => ({
        key: a,
        s: a.s,
        id: this.species[a.s]?.params.id ?? '',
        x: a.x,
        y: a.y,
        face: a.face,
        len: a.len,
        grow: a.grow,
        alpha: a.dying === null ? 1 : Math.max(0, 1 - Math.max(0, a.dying - 0.5) / 0.9),
        pop: Math.min(1, a.age / 0.35),
        rig: a.rig,
        hop: a.rig ? 0 : Math.abs(Math.sin((a.age + a.seed * 9) * 9)) * 0.08 * a.v,
        lying: a.doing === 'lie',
      })),
      tags: this.tags.map((t) => ({ key: t, x: t.x, y: t.y, age: t.age, life: TAG_LIFE, text: (t.box.children[0] as Text).text, color: (t.box.children[0] as Text).style.fill as number })),
    };
  }

  /** 每只演员画出来是原来身长的几倍（见 snapshot）。 */
  setShown(k: (mine: boolean, len: number) => number): void {
    for (const a of this.actors) a.shown = k(isMine(this.species[a.s]?.params.id ?? ''), a.len);
  }

  /** 按镜头摆好：演员不小于 MIN_PX，纸签不随缩放变小。 */
  layout(cam: Cam): void {
    const ct = Math.cos(cam.t);
    const crowded = this.actors.length > 22;
    for (const a of this.actors) {
      const [x, ry] = rotate(cam, a.x, a.y);
      const y = ry * ct;
      const young = 0.45 + 0.55 * a.grow;
      const pop = Math.min(1, a.age / 0.35);
      a.box.position.set(x, y);
      // 主角（会动的纸偶）画得更大：纸偶的头体长比整只剪纸的鸟显小。
      const minPx = a.rig ? MINE_MIN_PX : crowded ? MIN_PX * 0.8 : MIN_PX;
      a.shown = Math.max(1, minPx / (a.len * cam.s));
      a.box.scale.set(a.shown * young * (0.6 + 0.4 * pop));
      a.box.zIndex = y + 0.5;
    }
    for (const t of this.tags) {
      const [x, ry] = rotate(cam, t.x, t.y);
      const k = 13 / (26 * cam.s);
      const rise = Math.min(1, t.age / 0.5);
      t.box.position.set(x, ry * ct - (t.lift + 10 * rise) * Math.max(1, MIN_PX / (t.lift * cam.s)) * 0.9);
      t.box.scale.set(k);
      t.box.alpha = t.age > TAG_LIFE - 0.6 ? Math.max(0, (TAG_LIFE - t.age) / 0.6) : 1;
      t.box.zIndex = 1e6;
    }
  }
}
