import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import { TICKS_PER_DAY, countAt, isJuvenileAt, type DerivedSpecies, type SimState } from '../../sim';
import { TERRAIN } from '../../sim/terrain';
import { GROUP_OFFSETS, groupSize, makeAnimal, makeCountTag, makeTag, puppetKindOf, speciesTokens } from './animals';
import { P7_POSES, P7_ROW, type Sheet } from './assets';
import { rotate, type Cam } from './camera';
import { hash2 } from './noise';
import type { PaperScene } from './scene';
import { PX } from './terrain';
import { drawPuppet, tokenLengthCells, type PuppetKind } from './tokens';

/** 幼体的剪纸缩小到这个比例。 */
const JUVENILE_SCALE = 0.65;

/** 近景个体按体重的基础身长（格）：30 克 ≈ 0.2 格，250 克 ≈ 0.27 格，1.6 千克 ≈ 0.37 格；越重越大，但不超过半格。 */
export function sizeInCells(massKg: number): number {
  return Math.min(0.5, 0.14 + 0.2 * Math.cbrt(massKg));
}
/**
 * 近景个体的身长：sizeInCells（按体重、不超过半格）再放大一点，剪纸才看得出形状。
 * 比代表单位小得多：代表单位是地图图标，个体要和格子、和别的个体比得出疏密。
 */
const INDIVIDUAL_SCALE = 2.4;
/** 代表单位最快多久重新聚一次（毫秒）：高倍速时每天都重聚太费。 */
const TOKEN_INTERVAL_MS = 1000;

/** 一张会动的立牌：位置是剪纸像素，每帧按镜头重排。 */
interface Mover {
  obj: Container;
  x: number;
  y: number;
  bias: number;
}

/** 每个物种的近景个体画法：贴图（按姿势）、缩放、锚点。 */
interface Look {
  tex: Texture[];
  scale: number;
  anchorX: number;
  anchorY: number;
  len: number;
}

/**
 * 剪纸画面里的动物（只读推演状态）：
 * - 拉远（全图、区域）：每个物种几个代表单位（P7 剪纸 + 数量签，数量签上的数加起来等于总数），像地图图标一样不随缩放变小；
 * - 近景（关注区展开成个体）：一只一张剪纸，按推演的位置摆；朝向跟着移动方向，姿势按出生日等固定挑，不会闪。
 * 地上的影子是一层椭圆，画在地面上（被植物挡住）。
 */
export class AnimalLayer {
  /** 地上的影子：放进 scene.spin，跟着地面压扁、旋转。 */
  readonly shadows = new Graphics();
  private scene: PaperScene | null = null;
  private tokens: Mover[] = [];
  private icons: Container[] = [];
  private companions: Container[] = [];
  private tokenDay = -1;
  private tokenAt = -Infinity;
  /** 近景个体：每只一个小容器，里面是脚下的影子和剪纸本身（影子跟着它走，不用每个 tick 重画一层影子）。 */
  private readonly pool: { box: Container; body: Sprite; shadow: Sprite }[] = [];
  private shadowTex: Texture | null = null;
  private readonly people: Mover[] = [];
  /** 个案动物（不在推演的数量里）：一只小剪纸，拉远拉近都画。 */
  private cases: (Mover & { near: number })[] = [];
  private casesKey = '';
  private used = 0;
  private lastTick = -1;
  private looks: Look[] = [];
  private closeUp = false;

  constructor(
    private readonly P6: Sheet | null,
    private readonly P7: Sheet | null,
    private readonly renderer: Renderer,
    /** 推演的种子（代表单位挑姿势用；换一局时跟着换）。 */
    public seed: number,
    private species: readonly DerivedSpecies[],
  ) {
    this.shadows.alpha = 0.3;
    this.setSpecies(species);
  }

  setSpecies(species: readonly DerivedSpecies[]): void {
    this.species = species;
    this.looks = species.map((sp) => this.lookOf(sp));
    this.redraw();
  }

  /** 下一帧重新聚代表单位、重摆个体。 */
  redraw(): void {
    this.tokenDay = -1;
    this.tokenAt = -Infinity;
    this.lastTick = -1;
  }

  /** 换了场景（重画了剪纸地图）：影子和立牌挪到新场景里。 */
  attach(scene: PaperScene): void {
    this.scene = scene;
    scene.spin.addChild(this.shadows);
    for (const m of [...this.tokens, ...this.people, ...this.cases]) scene.bill.addChild(m.obj);
  }

  private lookOf(sp: DerivedSpecies): Look {
    const kind = puppetKindOf(sp.params.id);
    const len = sizeInCells(sp.params.bodyMassKg) * INDIVIDUAL_SCALE * PX;
    const rowI = P7_ROW[kind] ?? -1;
    const row = this.P7?.tex[rowI];
    if (row) {
      const area = this.P7!.rows[rowI]![0]![2] ?? (row[0]!.width / 1.65) ** 2;
      const poses = P7_POSES[kind] ?? [0];
      return { tex: poses.map((p) => row[p]!), scale: (len * 0.79) / Math.sqrt(area), anchorX: 0.5, anchorY: 1, len };
    }
    // 没有剪纸素材的物种：代码画的通用木偶烤成一张贴图，脚底中点对准原点。
    const pup = drawPuppet(kind as PuppetKind, len);
    const b = pup.getLocalBounds();
    const tex = this.renderer.generateTexture({ target: pup, resolution: 2 });
    pup.destroy({ children: true });
    return { tex: [tex], scale: 1, anchorX: -b.minX / b.width, anchorY: -b.minY / b.height, len };
  }

  /** 在野外的个案动物：每只一张黑白花小猫剪纸（体型按小猫，比代表单位小）。 */
  setCases(list: readonly { id: string; name: string; x: number; y: number; massKg: number }[]): void {
    const key = list.map((c) => `${c.id}:${c.x},${c.y},${c.massKg}`).join('|');
    if (key === this.casesKey) return;
    this.casesKey = key;
    for (const m of this.cases) m.obj.destroy({ children: true });
    this.cases = [];
    for (const c of list) {
      // 拉远时和代表单位一样是地图图标（按体重压缩的大小）；近景时换成和近景个体一样的比例。
      const len = tokenLengthCells(c.massKg) * PX * 0.8;
      const obj = makeAnimal(this.P7, 'cat-piebald', len, 0, true);
      // 名字签代替数量签：它不是哪一群的代表，就是这一只。
      obj.addChild(makeTag(this.P6, c.name, len));
      this.cases.push({ obj, x: (c.x + 0.5) * PX, y: (c.y + 0.5) * PX, bias: 0.5, near: (sizeInCells(c.massKg) * INDIVIDUAL_SCALE * PX) / len });
      this.scene?.bill.addChild(obj);
    }
  }

  update(state: Readonly<SimState>, closeUp: boolean): void {
    this.closeUp = closeUp;
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    const now = performance.now();
    if (!closeUp && day !== this.tokenDay && now - this.tokenAt > TOKEN_INTERVAL_MS) {
      this.tokenDay = day;
      this.tokenAt = now;
      this.buildTokens(state);
      this.drawShadows();
    }
    if (closeUp && state.tick !== this.lastTick) {
      this.lastTick = state.tick;
      this.placeIndividuals(state);
    }
    for (const m of this.tokens) m.obj.visible = !closeUp;
    for (let i = 0; i < this.used; i++) this.pool[i]!.box.visible = closeUp;
    this.shadows.visible = !closeUp;
  }

  private buildTokens(state: Readonly<SimState>): void {
    for (const m of this.tokens) m.obj.destroy({ children: true });
    this.tokens = [];
    this.icons = [];
    this.companions = [];
    const { width: w, height: h, terrain } = state.grid;
    const info = speciesTokens(
      this.species.map((sp, s) => {
        const pop = state.populations[s]!;
        const counts = new Int32Array(w * h);
        for (let i = 0; i < w * h; i++) counts[i] = countAt(pop, i);
        return { id: sp.params.id, bodyMassKg: sp.params.bodyMassKg, counts };
      }),
      w,
      h,
      (i) => terrain[i] !== TERRAIN.water,
    );
    const rnd = (x: number, y: number, k: number): number => hash2(x * 7 + k, y * 13 - k, this.seed + 1000);
    const si = (id: string): number => [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 1000;
    for (const { id, kind, tokens, len } of info)
      tokens.forEach((tk, j) => {
        const cx = (tk.x + 0.5) * PX;
        const cy = (tk.y + 0.5) * PX;
        const n = groupSize(tk.count);
        for (let m = 0; m < n; m++) {
          const k: PuppetKind = id === 'cat' && (j + m) % 2 === 1 ? 'cat-piebald' : kind;
          const [ox, oy] = GROUP_OFFSETS[m]!;
          const poses = P7_POSES[k] ?? [0];
          // 鸟：多数趴在巢里（P7 自带巢），少数站着。
          const pose = id === 'dotterel' ? ((j + m) % 3 === 2 ? 0 : 3) : poses[Math.floor(rnd(j * 7 + m, si(id), 9) * poses.length)]!;
          const unit = makeAnimal(this.P7, k, len, pose, (j + m) % 3 === 2 && id !== 'dotterel');
          this.add(this.tokens, unit, cx + ox * len, cy + oy * len, 0.5);
          this.icons.push(unit);
          if (m > 0) this.companions.push(unit);
        }
        // 数量签永远画在最上面，不被别的动物和植物挡住。
        const tag = makeCountTag(this.P6, tk.count, len);
        this.add(this.tokens, tag, cx, cy, 1e5);
        this.icons.push(tag);
      });
  }

  private add(list: Mover[], obj: Container, x: number, y: number, bias: number): void {
    list.push({ obj, x, y, bias });
    this.scene?.bill.addChild(obj);
  }

  private placeIndividuals(state: Readonly<SimState>): void {
    const ind = state.individuals;
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    this.shadowTex ??= softEllipse(this.renderer);
    while (this.pool.length < ind.count) {
      const box = new Container();
      const shadow = new Sprite(this.shadowTex);
      shadow.anchor.set(0.5);
      shadow.tint = 0x241a10;
      shadow.alpha = 0.32;
      const body = new Sprite();
      box.addChild(shadow, body);
      this.pool.push({ box, body, shadow });
      this.add(this.people, box, 0, 0, 0.5);
    }
    for (let i = 0; i < ind.count; i++) {
      const s = ind.species[i]!;
      const look = this.looks[s];
      const sp = this.species[s];
      const { box, body: spr, shadow } = this.pool[i]!;
      if (!look || !sp) {
        box.visible = false;
        continue;
      }
      // 姿势按出生日、性别固定挑（个体在数组里的下标会因生死而变，不能用下标）。
      const pose = look.tex[Math.floor(hash2(ind.born[i]!, s * 7 + ind.female[i]!, this.seed + 3000) * look.tex.length)]!;
      const k = look.scale * (isJuvenileAt(sp, ind.born[i]!, day) ? JUVENILE_SCALE : 1);
      spr.texture = pose;
      spr.anchor.set(look.anchorX, look.anchorY);
      // 朝向跟着移动方向（剪纸默认头朝右）。
      spr.scale.set(ind.vx[i]! < 0 ? -k : k, k);
      box.visible = true;
      // 脚下的影子：光从左上来，往右偏一点；宽约身长的 0.8。
      const len = look.len * (k / look.scale);
      shadow.width = len * 0.85;
      shadow.height = len * 0.2;
      shadow.position.set(len * 0.06, 0);
      const m = this.people[i]!;
      m.x = ind.x[i]! * PX;
      m.y = ind.y[i]! * PX;
    }
    for (let i = ind.count; i < this.used; i++) this.pool[i]!.box.visible = false;
    this.used = ind.count;
  }

  /** 代表单位脚下的影子（画在地面上，被植物挡住）。 */
  private drawShadows(): void {
    const g = this.shadows;
    g.clear();
    for (const m of this.tokens) {
      if (m.bias !== 0.5) continue;
      const r = Math.abs(m.obj.width) * 0.42;
      g.ellipse(m.x + r * 0.15, m.y + 1, r, r * 0.24);
    }
    g.fill(0x241a10);
  }

  /** 按镜头摆：会动的立牌每帧重排；代表单位拉远时反向放大，保持能看清的大小。 */
  layout(cam: Cam): void {
    const k = Math.max(1, 0.95 / cam.s);
    for (const u of this.icons) u.scale.set(k);
    for (const m of this.cases) m.obj.scale.set(this.closeUp ? m.near : k);
    for (const u of this.companions) u.visible = !this.closeUp && k < 1.05;
    const ct = Math.cos(cam.t);
    const list = [...(this.closeUp ? this.people.slice(0, this.used) : this.tokens), ...this.cases];
    for (const m of list) {
      const [x, ry] = rotate(cam, m.x, m.y);
      const y = ry * ct;
      m.obj.position.set(x, y);
      m.obj.zIndex = y + m.bias;
    }
  }
}

/** 一张边缘柔和的椭圆（白色，用时着色、拉伸）：近景个体脚下的影子。 */
function softEllipse(renderer: Renderer): Texture {
  const g = new Graphics();
  for (let k = 0; k < 6; k++) g.ellipse(0, 0, 32 - k * 4, 32 - k * 4).fill({ color: 0xffffff, alpha: 0.18 });
  const t = renderer.generateTexture({ target: g, resolution: 1 });
  g.destroy();
  return t;
}
