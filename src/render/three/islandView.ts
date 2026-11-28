import { CanvasTexture, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { Container } from 'pixi.js';
import type { GaitRules } from '../../data/schema/gait';
import { herbIndex, woodyIndex, type DerivedSpecies, type SimState, type SpeciesQuarter } from '../../sim';
import { CELL_PX } from '../projection';
import { LiveLayer, type LiveActorView, type RigSpec } from '../paper/liveLayer';
import { imageOf, loadSheet, P7_ROW, type Sheet } from '../paper/assets';
import { puppetKindOf } from '../paper/animals';
import { PX } from '../paper/terrain';
import type { RigKit } from '../puppet/actor';
import { Island3D } from './island3d';
import { levelTop } from './relief';
import { Puppet3D } from './puppet3d';

/**
 * 游戏里的岛（2026-11-28，整体回顾 A 段）：纸雕岛（和车里托盘上的是同一座）就是地图。
 * 剧场退役：要看近处就在同一座岛上推近；动物是 3D 纸偶，在纸板上走。
 * 演员的逻辑（几只、站在哪、生死落在谁身上）沿用 LiveLayer，只换了画法。
 * 坐标：推演的格 (cx, cy) 的中心在世界的 (cx − W/2 + 0.5, cy − H/2 + 0.5)，一格一个世界单位；高度是那一层纸的顶面。
 */

interface Ticker {
  add(fn: () => void): void;
  deltaMS: number;
}

/** 演员在岛上画多长（格）：比真实大很多，像桌上的棋子，拉远也看得见。 */
const MINE_CELLS = 0.6;
const OTHER_CELLS = 0.38;

export class IslandView {
  readonly ticker: Ticker;
  readonly isl: Island3D;
  private readonly live: LiveLayer;
  readonly actorRoot = new Group();
  private readonly shown = new Map<object, { obj: Group; p3?: Puppet3D; plane?: Mesh }>();
  private readonly tagLayer: HTMLElement;
  private readonly tagEls = new Map<object, HTMLElement>();
  private readonly ray = new Raycaster();
  private species: readonly DerivedSpecies[] = [];
  private vegAt = -1;
  private vegSig = '';
  private readonly W: number;
  private readonly H: number;
  /** 点地图（不是拖动）：给外面一个格子坐标（剪纸地图的世界像素，和 PaperView 的 screenToWorld 一样）。 */
  onTap: ((world: { x: number; y: number }) => void) | null = null;

  private constructor(
    private readonly host: HTMLElement,
    state: Readonly<SimState>,
    private readonly P7: Sheet | null,
  ) {
    const g = state.grid;
    this.W = g.width;
    this.H = g.height;
    const veg = vegetationOf(state);
    this.isl = new Island3D(host, { width: g.width, height: g.height, terrain: g.terrain, herb: veg.herb, shrub: veg.shrub, seed: state.config.seed, month: Math.floor(state.tick / 24 / 30) % 12 });
    this.isl.scene.add(this.actorRoot);
    this.live = new LiveLayer(P7, null as unknown as GaitRules, PX, 7);
    this.tagLayer = document.createElement('div');
    this.tagLayer.className = 'island-tags';
    Object.assign(this.tagLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    host.style.position ||= 'relative';
    host.appendChild(this.tagLayer);
    const fns: Array<() => void> = [];
    const ticker: Ticker = { add: (fn) => fns.push(fn), deltaMS: 16 };
    this.ticker = ticker;
    let last = performance.now();
    // ?fps=n：最多每秒画 n 帧（软件渲染的截图脚本用；推演和演员照常走）。
    const fpsCap = Number(new URLSearchParams(location.search).get('fps') ?? 0);
    let drawnAt = 0;
    const loop = (t: number): void => {
      ticker.deltaMS = Math.min(100, t - last);
      last = t;
      for (const fn of fns) fn();
      const draw = !fpsCap || t - drawnAt >= 1000 / fpsCap;
      if (draw) drawnAt = t;
      this.isl.update(ticker.deltaMS / 1000, draw);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // 点（不是拖）：按下和抬起离得很近。
    const el = this.isl.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const w = this.screenToWorld({ x: e.clientX, y: e.clientY });
      if (w) this.onTap?.(w);
    });
  }

  static async mount(host: HTMLElement, state: Readonly<SimState>, species: readonly DerivedSpecies[]): Promise<IslandView> {
    const P7 = await loadSheet('P7');
    const v = new IslandView(host, state, P7);
    (window as unknown as { islandView: IslandView }).islandView = v;
    v.setSpecies(species);
    return v;
  }

  get canvas(): HTMLCanvasElement {
    return this.isl.renderer.domElement;
  }

  /** 屏幕上一点 → 剪纸地图的世界像素（CELL_PX 一格）。先和海平面求交，再按那里那层纸的高度修两次。 */
  screenToWorld(screen: { x: number; y: number }): { x: number; y: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new Vector2(((screen.x - r.left) / r.width) * 2 - 1, -((screen.y - r.top) / r.height) * 2 + 1), this.isl.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    let y = 0;
    let p = new Vector3();
    for (let k = 0; k < 3; k++) {
      const t = (y - o.y) / d.y;
      p = o.clone().addScaledVector(d, t);
      y = levelTop(Math.max(0, this.isl.field.levelAt(p.x, p.z)));
    }
    return { x: (p.x + this.W / 2) * CELL_PX, y: (p.z + this.H / 2) * CELL_PX };
  }

  /** 镜头移到一格（剪纸世界像素）。 */
  focus(at: { x: number; y: number }, close = false): void {
    this.isl.cam.glide(at.x / CELL_PX - this.W / 2, at.y / CELL_PX - this.H / 2, close ? 9 : undefined);
  }

  useLive(rules: GaitRules, kit: Promise<RigKit>, onEvent?: (kind: 'birth' | 'death') => void): void {
    const live = new LiveLayer(this.P7, rules, PX, 7, onEvent);
    (this as unknown as { live: LiveLayer }).live = live;
    live.attach(new Container());
    live.setSpecies(this.species);
    void kit.then((k) => live.setKit(k));
  }

  setRig(id: string, spec: RigSpec): void {
    this.live.setRig(id, spec);
  }

  setTally(rows: readonly SpeciesQuarter[]): void {
    this.live.setTally(rows);
  }

  setSpecies(species: readonly DerivedSpecies[]): void {
    this.species = species;
    this.live.setSpecies(species);
  }

  draw(state: Readonly<SimState>): void {
    const dt = this.ticker.deltaMS / 1000;
    // 演员画多长：主角 MINE_CELLS 格，别的 OTHER_CELLS 格（走路的快慢按画出来的身长算）。
    this.live.setShown((mine, len) => ((mine ? MINE_CELLS : OTHER_CELLS) * PX) / len);
    this.live.update(state, dt);
    this.syncActors();
    this.refreshVegetation(state);
  }

  /** 植被变了一成以上（或者过了一季）就重撒植物。 */
  private refreshVegetation(state: Readonly<SimState>): void {
    const day = Math.floor(state.tick / 24);
    if (this.vegAt >= 0 && day - this.vegAt < 30) return;
    const veg = vegetationOf(state);
    let h = 0;
    let w = 0;
    for (let i = 0; i < veg.herb.length; i++) {
      h += veg.herb[i]!;
      w += veg.shrub[i]!;
    }
    const month = Math.floor(state.tick / 24 / 30) % 12;
    const sig = `${month}|${Math.round((h / veg.herb.length) * 12)}|${Math.round((w / veg.herb.length) * 12)}`;
    this.vegAt = day;
    if (sig === this.vegSig) return;
    const first = this.vegSig === '';
    this.vegSig = sig;
    if (!first) this.isl.setVegetation(veg.herb, veg.shrub, month);
  }

  private syncActors(): void {
    const snap = this.live.snapshot();
    const seen = new Set<object>();
    const camYaw = this.isl.cam.yawNow;
    const lean = Math.max(0, this.isl.cam.elevation - 0.35) * 0.8;
    for (const a of snap.actors) {
      seen.add(a.key);
      let it = this.shown.get(a.key);
      if (!it) {
        it = this.makeActor(a);
        this.shown.set(a.key, it);
        this.actorRoot.add(it.obj);
      }
      const wx = a.x / PX - this.W / 2;
      const wz = a.y / PX - this.H / 2;
      const L = Math.max(0, this.isl.field.levelAt(wx, wz));
      const lenCells = (a.id.startsWith('d_') ? MINE_CELLS : OTHER_CELLS) * (0.45 + 0.55 * a.grow) * (0.6 + 0.4 * a.pop);
      it.obj.position.set(wx, levelTop(L) + a.hop * lenCells, wz);
      it.obj.rotation.order = 'YXZ';
      it.obj.rotation.y = camYaw;
      it.obj.rotation.x = -lean;
      const flip = (a.face < 0 ? -1 : 1) * Math.max(0.08, Math.abs(a.face));
      if (it.p3 && a.rig) {
        it.p3.sync();
        const k = lenCells / a.rig.plan.bodyLen;
        it.obj.scale.set(k * flip, k, k);
      } else if (it.plane) {
        it.obj.scale.set(lenCells * flip, lenCells, lenCells);
      }
      // 淡出：纸偶的纸是各只共用的材质，不能改透明度（会一起变透明），改成倒下、缩小。
      it.obj.visible = a.alpha > 0.02;
      if (a.alpha < 1) it.obj.scale.multiplyScalar(0.4 + 0.6 * a.alpha);
    }
    for (const [k, it] of this.shown)
      if (!seen.has(k)) {
        this.actorRoot.remove(it.obj);
        it.p3?.dispose();
        this.shown.delete(k);
      }
    // 纸签：投到屏幕上，跟着头顶往上飘。
    const seenTag = new Set<object>();
    const r = this.canvas.getBoundingClientRect();
    for (const t of snap.tags) {
      seenTag.add(t.key);
      let el = this.tagEls.get(t.key);
      if (!el) {
        el = document.createElement('div');
        el.textContent = t.text;
        Object.assign(el.style, {
          position: 'absolute',
          transform: 'translate(-50%, -100%)',
          font: '700 15px "LXGW WenKai Screen", serif',
          color: `#${t.color.toString(16).padStart(6, '0')}`,
          background: '#fbf5e6',
          padding: '1px 7px',
          borderRadius: '3px',
          boxShadow: '1px 2px 0 #0002',
          whiteSpace: 'nowrap',
        });
        this.tagLayer.appendChild(el);
        this.tagEls.set(t.key, el);
      }
      const wx = t.x / PX - this.W / 2;
      const wz = t.y / PX - this.H / 2;
      const p = new Vector3(wx, levelTop(Math.max(0, this.isl.field.levelAt(wx, wz))) + 0.9 + Math.min(1, t.age / 0.5) * 0.3, wz).project(this.isl.camera);
      el.style.left = `${((p.x + 1) / 2) * r.width}px`;
      el.style.top = `${((1 - p.y) / 2) * r.height}px`;
      el.style.opacity = String(t.age > t.life - 0.6 ? Math.max(0, (t.life - t.age) / 0.6) : 1);
    }
    for (const [k, el] of this.tagEls)
      if (!seenTag.has(k)) {
        el.remove();
        this.tagEls.delete(k);
      }
  }

  private makeActor(a: LiveActorView): { obj: Group; p3?: Puppet3D; plane?: Mesh } {
    const obj = new Group();
    if (a.rig) {
      const p3 = new Puppet3D(a.rig.rig.cutout, a.rig.rig.metersPerPx);
      obj.add(p3.root);
      return { obj, p3 };
    }
    // 别的动物（双斑鸻、兔、鼠……）：成品图里的整只剪纸，一张立着的纸片。
    const row = this.P7?.tex[P7_ROW[puppetKindOf(a.id)] ?? -1];
    const tex = row?.[0];
    const plane = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: 0xffffff, side: DoubleSide, alphaTest: 0.4, roughness: 0.9 }));
    if (tex) {
      const img = imageOf(tex) as HTMLCanvasElement;
      const t = new CanvasTexture(img);
      t.colorSpace = SRGBColorSpace;
      (plane.material as MeshStandardMaterial).map = t;
      const aspect = img.height / img.width;
      plane.scale.set(1.25, 1.25 * aspect, 1);
      plane.position.y = (1.25 * aspect) / 2;
    }
    plane.castShadow = true;
    obj.add(plane);
    return { obj, plane };
  }

  // ---- 和 PaperView 一样的接口（游戏本体用到的），纸雕岛上暂时没有的先空着 ----
  get isLive(): boolean {
    return true;
  }
  get closeUp(): boolean {
    return this.isl.cam.near > 0.7;
  }
  get deathLegendMax(): number {
    return 0;
  }
  setHidden(hidden: boolean): void {
    this.canvas.style.visibility = hidden ? 'hidden' : 'visible';
  }
  setPortrait(_id: string, _url: string): Promise<void> {
    return Promise.resolve();
  }
  setAlertAt(_at: { x: number; y: number } | null): void {}
  setLayer(_layer: unknown): void {}
  setCases(_cases: readonly unknown[]): void {}
  setFenceStart(_p: unknown): void {}
  repaintSoon(): void {
    this.vegAt = -1;
  }
  redraw(): void {
    this.vegAt = -1;
  }
  visibleCells(): { cx: number; cy: number; w: number; h: number } {
    return { cx: this.W / 2, cy: this.H / 2, w: this.W, h: this.H };
  }
}

/** 推演的植被 → 纸雕岛要的每格茂盛程度（0–1）。 */
function vegetationOf(state: Readonly<SimState>): { herb: Float64Array; shrub: Float64Array } {
  const g = state.grid;
  const world = state.config.world;
  const n = g.width * g.height;
  const hi = herbIndex(world);
  const wi = woodyIndex(world);
  const herb = new Float64Array(n);
  const shrub = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hp = world.plants[hi];
    if (hp) herb[i] = g.plants[hi]![i]! / Math.max(1, hp.maxBiomass * g.fertility[i]!);
    const wp = wi >= 0 ? world.plants[wi] : undefined;
    if (wp) shrub[i] = g.plants[wi]![i]! / Math.max(1, wp.maxBiomass);
  }
  return { herb, shrub };
}
