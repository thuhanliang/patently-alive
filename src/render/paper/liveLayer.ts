import { Container, Graphics, Text } from 'pixi.js';
import type { GaitRules } from '../../data/schema/gait';
import { countAt, decodeCause, type DerivedSpecies, type SimState, type SpeciesQuarter } from '../../sim';
import { TERRAIN } from '../../sim/terrain';
import type { Dye } from '../puppet/cutout';
import { PuppetActor, type ActorMode, type RigKit } from '../puppet/actor';
import type { BodyPlan } from '../puppet/plan';
import { makeAnimal, puppetKindOf } from './animals';
import type { Sheet } from './assets';
import { rotate, type Cam } from './camera';
import { PX } from './terrain';

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
  mode: ActorMode;
  timer: number;
  age: number;
  /** 幼崽：从小长到大（0–1）。 */
  grow: number;
  /** 正在淡掉（秒）；null 是活着。 */
  dying: number | null;
  len: number;
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
const MINE_CAP = 14;
const OTHER_CAP = 12;
/** 事务所设计的动物画得比别的大一些：它是主角。 */
const MINE_BOOST = 1.5;
/** 演员在屏幕上的身长不小于这么多像素。 */
const MIN_PX = 34;
const MINE_MIN_PX = 62;

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
    /** 一种动物在画面上的身长（剪纸像素）。 */
    private readonly lenOf: (sp: DerivedSpecies) => number,
    seed: number,
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
    for (const a of this.actors) this.dispose(a);
    this.actors = [];
    this.sinceCensus = 1;
  }

  private dispose(a: Actor): void {
    if (a.rig) a.rig.destroy();
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
        if (at) this.spawn(state, s, at.x, at.y, false);
      }
      // 多出来的悄悄退场（不带纸签：纸签只给账上记了的死亡）。
      for (let k = want; k < mine.length; k++) mine[k]!.dying = 0.6;
      const { width } = state.grid;
      for (const a of mine.slice(0, want)) {
        const cx = Math.floor(a.x / PX);
        const cy = Math.floor(a.y / PX);
        let near = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) near += countAt(pop, Math.max(0, Math.min(state.grid.height - 1, cy + dy)) * width + Math.max(0, Math.min(width - 1, cx + dx)));
        if (near === 0) {
          const at = this.pickCell(state, s);
          if (at) {
            a.tx = at.x;
            a.ty = at.y;
            a.mode = 'run';
            a.timer = 8;
          }
        }
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
      if (r < 0) return { x: ((c % state.grid.width) + this.random()) * PX, y: (Math.floor(c / state.grid.width) + this.random()) * PX };
    }
    return null;
  }

  private spawn(state: Readonly<SimState>, s: number, x: number, y: number, young: boolean): Actor | null {
    const sp = this.species[s]!;
    const id = sp.params.id;
    const mine = isMine(id);
    const len = this.lenOf(sp) * (mine ? MINE_BOOST : 1);
    const spec = this.rigs.get(id);
    const box = new Container();
    const inner = new Container();
    const seed = this.random();
    const shadow = new Graphics().ellipse(len * 0.05, 0, len * 0.45, len * 0.1).fill({ color: 0x241a10, alpha: 0.28 });
    let rig: PuppetActor | null = null;
    if (spec && this.kit) {
      rig = new PuppetActor(this.kit, spec.plan, spec.dye, this.rules, spec.speedFactor, seed);
      rig.setLength(len);
      inner.addChild(rig.view);
    } else {
      inner.addChild(makeAnimal(this.P7, puppetKindOf(id), len, 0, false));
    }
    box.addChild(shadow, inner);
    const a: Actor = { s, box, inner, rig, x, y, tx: x, ty: y, mode: 'stand', timer: this.random() * 2, age: 0, grow: young ? 0 : 1, dying: null, len, seed };
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
        if (mine) this.tag(parent, `生了 ${pend.births} 只`, 0x3d6b3a);
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
          if (victim) {
            this.tag(victim, `${causeLabel(top[0], names)} ${top[1]} 只`, 0x8a4a34);
            victim.dying = 0;
            victim.rig?.setMode('lie');
          }
          played = true;
        }
      }
      if (played) pend.wait = 0.9 + this.random() * 0.4;
    });
  }

  private tag(at: Actor, text: string, color: number): void {
    const label = new Text({
      text,
      style: { fontFamily: 'Georgia, "Songti SC", "Noto Serif SC", serif', fontSize: 26, fill: color, fontWeight: '700', stroke: { color: 0xfbf5e6, width: 6, join: 'round' } },
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
      a.rig?.step(dt);
      return;
    }
    a.timer -= dt;
    const moving = a.mode === 'walk' || a.mode === 'run';
    const dx = a.tx - a.x;
    const dy = a.ty - a.y;
    const dist = Math.hypot(dx, dy);
    if (moving && dist > 1) {
      // 画面上走多快：按身体的真实速度折成"每秒几个身长"。
      const v = a.rig ? (a.rig.speedOf(a.mode) / a.rig.plan.bodyLen) * a.len : a.len * (a.mode === 'run' ? 3 : 1.3);
      const step = Math.min(dist, v * dt);
      a.x += (dx / dist) * step;
      a.y += (dy / dist) * step;
      if (Math.abs(dx) > 0.5) a.inner.scale.x = dx < 0 ? -1 : 1;
    }
    if (a.timer <= 0 || (moving && dist <= 1)) this.nextMode(a, state, moving);
    if (a.rig) {
      a.rig.setMode(a.mode);
      a.rig.step(dt);
    } else {
      // 整只剪纸的（鸟）：走的时候一颠一颠。
      a.inner.y = moving ? -Math.abs(Math.sin((a.age + a.seed * 9) * 9)) * a.len * 0.08 : 0;
    }
  }

  private nextMode(a: Actor, state: Readonly<SimState>, wasMoving: boolean): void {
    const r = this.random();
    if (wasMoving) {
      a.mode = r < 0.5 ? 'eat' : r < 0.75 ? 'stand' : r < 0.9 ? 'lie' : 'walk';
    } else {
      a.mode = r < 0.85 ? 'walk' : 'stand';
    }
    if (a.mode === 'walk') {
      const { width, height, terrain } = state.grid;
      for (let k = 0; k < 8; k++) {
        const tx = a.x + (this.random() - 0.5) * 6 * PX;
        const ty = a.y + (this.random() - 0.5) * 6 * PX;
        const cx = Math.floor(tx / PX);
        const cy = Math.floor(ty / PX);
        if (cx < 0 || cy < 0 || cx >= width || cy >= height || terrain[cy * width + cx] === TERRAIN.water) continue;
        a.tx = tx;
        a.ty = ty;
        break;
      }
      a.timer = 7;
    } else a.timer = a.mode === 'eat' ? 2.5 + this.random() * 3 : a.mode === 'lie' ? 3 + this.random() * 4 : 1 + this.random() * 2;
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
      a.box.scale.set(Math.max(1, minPx / (a.len * cam.s)) * young * (0.6 + 0.4 * pop));
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
