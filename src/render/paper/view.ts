import { Application, Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import { TICKS_PER_DAY, herbIndex, woodyIndex, type DerivedSpecies, type SimState, type SpeciesQuarter } from '../../sim';
import { AnnotationLayer } from '../annotationLayer';
import { CLOSE_UP_CELL_PX, Camera } from '../camera';
import { GridLayer, type DataLayer } from '../gridLayer';
import { BLUEPRINT, colorOf } from '../palette';
import { CELL_PX, mapWorldSize } from '../projection';
import { imageOf, loadPalette, loadSheet, type Sheet } from './assets';
import { PITCH_LIMIT, YAW_LIMIT, anchor, rotate, tiltFor, type Cam } from './camera';
import { LeafKit } from './leaves';
import { PaintPool } from './painter';
import { PaperScene } from './scene';
import { PX, buildFields, type Fields, type Palette } from './terrain';
import { readTerrain, terrainKey, writeTerrain } from './terrainCache';
import { TiledCanvas } from './tiledCanvas';
import { tokenLengthCells } from './tokens';
import { placeVegetation } from './vegetation';
import { AnimalLayer } from './animalLayer';
import type { ViewAngles } from '../view';
import type { GaitRules } from '../../data/schema/gait';
import type { RigKit } from '../puppet/actor';
import { LiveLayer, type RigSpec } from './liveLayer';

/**
 * 小地图画得更细（2026-11-14）：一格在剪纸里占 detail × PX 像素。地形、植被都按细分以后的格子画，
 * 所以 48 格的小岛和 144 格的岛一样细致，放大了看不糊；植物相对岛也小下来，动物站在里面不会被整丛挡住。
 * 只是画面的细分，推演的格子不变。
 */
export function detailOf(w: number, h: number): number {
  return Math.max(1, Math.min(3, Math.round(144 / Math.max(w, h))));
}

/** 把 H 行切成每条 64 行，按离 centre 行的远近排（近的先画）。 */
function bandsFrom(H: number, centre: number): [number, number][] {
  const STEP = 64;
  const out: [number, number][] = [];
  for (let y = 0; y < H; y += STEP) out.push([y, Math.min(H, y + STEP)]);
  return out.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - centre) - Math.abs((b[0] + b[1]) / 2 - centre));
}

/** 两张地形图内容一样吗。 */
function sameTerrain(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 把一张格子图放大 r 倍：数量（0–1）双线性插值。 */
function refine(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r === 1) return src;
  const out = new Float32Array(w * r * h * r);
  for (let y = 0; y < h * r; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) / r - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w * r; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) / r - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const tx = fx - x0;
      out[y * w * r + x] = (src[y0 * w + x0]! * (1 - tx) + src[y0 * w + x1]! * tx) * (1 - ty) + (src[y1 * w + x0]! * (1 - tx) + src[y1 * w + x1]! * tx) * ty;
    }
  }
  return out;
}

/** 把地形放大 r 倍：每一类地形各自插值，取最大的那一类（边界变成斜的、圆的，不是放大了的台阶）。 */
function refineTerrain(terrain: ArrayLike<number>, w: number, h: number, r: number): Uint8Array {
  if (r === 1) return Uint8Array.from(terrain as ArrayLike<number>);
  const kinds = [...new Set(Array.from(terrain as ArrayLike<number>))];
  const out = new Uint8Array(w * r * h * r);
  const best = new Float32Array(out.length).fill(-1);
  for (const k of kinds) {
    const mask = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = terrain[i] === k ? 1 : 0;
    const fine = refine(mask, w, h, r);
    for (let i = 0; i < out.length; i++)
      if (fine[i]! > best[i]!) {
        best[i] = fine[i]!;
        out[i] = k;
      }
  }
  return out;
}
/**
 * 植被变了以后重画剪纸地图：推演里至少过了这么多天，而且离上次画完至少这么多毫秒（高倍速时不至于一直在画）。
 * 重画时草丛、灌丛跟着植被量换样子（被啃的泛黄、稀疏），地面颜色也跟着变。
 */
const REPAINT_DAYS = 10;
const REPAINT_MS = 5000;
/** 草本的平均多少变了这么多（占上限的比例）才值得整张重画。 */
const REPAINT_CHANGE = 0.06;

interface Assets {
  P1: Sheet | null;
  P2: Sheet | null;
  P3: Sheet | null;
  P6: Sheet | null;
  P7: Sheet | null;
  pal: Palette;
  kit: LeafKit | null;
  /** 常驻的绘制 Worker（纸纹、叶片只送一次）。 */
  pool: PaintPool;
}

/**
 * 剪纸画面（游戏唯一的地图画面）：只读推演状态，不改任何状态。
 * - 地形逐像素画成纸雕（Worker 里并行，见 painter.ts），植被立起来、正对镜头（vegetation.ts、scene.ts）；
 * - 镜头可以倾斜、旋转（camera.ts 的 tilt、yaw），拉远俯视、拉近斜看；点击换算走同一个 Camera，点哪儿是哪儿；
 * - 玩家的批注、关注区边框、警报圈、数据图层都画在地面上，跟着地面压扁、旋转；批注的文字立起来。
 * 世界坐标仍是游戏的（一格 CELL_PX），剪纸场景内部是剪纸像素（一格 detail × PX），中间差一个倍数 K。
 */
export class PaperView {
  readonly camera = new Camera();
  private scene: PaperScene | null = null;
  /** 地面上的游戏信息（游戏世界坐标，放大 K 倍叠到剪纸地面上）。 */
  private readonly overlay = new Container();
  private readonly grid: GridLayer;
  private readonly annotations: AnnotationLayer;
  private readonly focusOutline = new Graphics();
  private focusKey = '';
  /** 批注文字原来在地面上的位置（游戏世界坐标）；立起来以后按镜头重新摆。 */
  private readonly labelGround = new WeakMap<Text, { x: number; y: number }>();
  private readonly labelBox = new Container();
  private layer: DataLayer = { kind: 'vegetation' };
  private lastDay = -1;
  private terrain: Uint8Array;
  private building = false;
  /** 现在这张剪纸地图是按哪一天的植被画的、什么时候画完的。 */
  private builtDay = 0;
  /** 上一次画的时候，陆地上草本的平均多少（0–1）。 */
  private builtVeg = 0;
  private repaintAsked = false;
  private builtAt = 0;
  private readonly vignette: Sprite;
  private readonly cam: Cam = { s: 1, t: 0, r: 0, ox: 0, oy: 0 };
  private readonly animals: AnimalLayer;
  /** 一格细分成几份来画（见 detailOf）。 */
  private readonly detail: number;
  /** 剪纸像素 / 游戏世界坐标。 */
  private readonly K: number;
  readonly angles: ViewAngles;

  private constructor(
    readonly app: Application,
    state: Readonly<SimState>,
    species: readonly DerivedSpecies[],
    private readonly assets: Assets,
  ) {
    const { width, height } = state.grid;
    // ?detail=1…3 可以手动指定（查性能、对比画质用）。
    const forced = Number(new URLSearchParams(location.search).get('detail'));
    this.detail = forced >= 1 && forced <= 3 ? Math.round(forced) : detailOf(width, height);
    this.K = (PX * this.detail) / CELL_PX;
    const K = this.K;
    this.angles = { pitchLimit: PITCH_LIMIT, yawLimit: YAW_LIMIT, autoTilt: (zoom) => tiltFor(zoom / K) };
    this.terrain = state.grid.terrain;
    this.grid = new GridLayer(width, height, state.grid.terrain, []);
    this.grid.hideWater = true;
    this.grid.setSmooth(true);
    this.grid.container.alpha = 0.78;
    this.annotations = new AnnotationLayer(state.config.tools);
    this.overlay.scale.set(this.K);
    this.overlay.addChild(this.grid.container, this.focusOutline, this.annotations.container);
    this.labelBox.addChild(this.annotations.labels);
    this.animals = new AnimalLayer(assets.P6, assets.P7, app.renderer, state.config.seed, species, PX * this.detail);
    this.liveSeed = state.config.seed;
    this.setSpecies(species);

    this.vignette = new Sprite(Texture.from(vignetteCanvas()));
    this.vignette.blendMode = 'multiply';
    app.stage.addChild(this.vignette);

    // 俯仰默认跟着缩放（拉远俯视、拉近斜看）；?pitch=（度）固定俯仰。旋转用 Q / E，或 ?yaw=（度）。
    const params = new URLSearchParams(location.search);
    const deg = Math.PI / 180;
    const pitch = params.get('pitch');
    if (pitch !== null) this.camera.tilt = Math.min(PITCH_LIMIT, Math.max(0, Number(pitch) * deg)) || 0;
    else this.camera.autoTilt = this.angles.autoTilt;
    const turn = (r: number): void => {
      this.camera.yaw = Math.min(YAW_LIMIT, Math.max(-YAW_LIMIT, r)) || 0;
    };
    turn(Number(params.get('yaw') ?? 0) * deg);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'q' || e.key === 'Q') turn(this.camera.yaw - 15 * deg);
      if (e.key === 'e' || e.key === 'E') turn(this.camera.yaw + 15 * deg);
    });
    this.camera.setWorld(mapWorldSize(width, height));
    this.camera.setScreen(app.screen.width, app.screen.height);
    this.camera.preset('map');
    const onResize = (w: number, h: number): void => {
      this.camera.setScreen(w, h);
      this.vignette.width = w;
      this.vignette.height = h;
    };
    onResize(app.screen.width, app.screen.height);
    app.renderer.on('resize', onResize);
  }

  static async mount(host: HTMLElement, state: Readonly<SimState>, species: readonly DerivedSpecies[]): Promise<PaperView> {
    const app = new Application();
    await app.init({ resizeTo: host, background: 0x143268, antialias: true });
    host.appendChild(app.canvas);
    const [P1, P2, P3, P6, P7, P8] = await Promise.all(['P1', 'P2', 'P3', 'P6', 'P7', 'P8'].map(loadSheet));
    const pal = await loadPalette();
    const leaves = P8 ? P8.tex.map((row) => row.map(imageOf)) : null;
    const assets: Assets = {
      P1: P1 ?? null,
      P2: P2 ?? null,
      P3: P3 ?? null,
      P6: P6 ?? null,
      P7: P7 ?? null,
      pal,
      kit: leaves ? new LeafKit(leaves) : null,
      pool: await PaintPool.create(pal, leaves),
    };
    const view = new PaperView(app, state, species, assets);
    await view.build(state);
    return view;
  }

  /** 按推演的地形和植被画一张剪纸地图（换一局、读档后地形变了也走这里）。画好以前旧的那张留着。 */
  private async build(state: Readonly<SimState>): Promise<void> {
    this.building = true;
    try {
      await this.buildScene(state);
    } finally {
      this.building = false;
      this.builtAt = performance.now();
    }
  }

  private async buildScene(state: Readonly<SimState>): Promise<void> {
    this.builtDay = Math.floor(state.tick / TICKS_PER_DAY);
    this.builtVeg = this.vegetationLevel(state);
    const { width: w, height: h, terrain } = state.grid;
    const world = state.config.world;
    const herbI = herbIndex(world);
    const woodyI = woodyIndex(world);
    const herb = new Float32Array(w * h);
    const shrub = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      herb[i] = Math.min(1, state.grid.plants[herbI]![i]! / world.plants[herbI]!.maxBiomass);
      if (woodyI >= 0) shrub[i] = Math.min(1, state.grid.plants[woodyI]![i]! / world.plants[woodyI]!.maxBiomass);
    }
    const seed = state.config.seed;
    const { kit, pool } = this.assets;
    // 小地图细分以后再画（见 detailOf）。
    const r = this.detail;
    const fields = buildFields({ width: w * r, height: h * r, terrain: refineTerrain(terrain, w, h, r), herb: refine(herb, w, h, r), shrub: refine(shrub, w, h, r) });
    const W = fields.width * PX;
    const H = fields.height * PX;
    const opts = { softVegetation: !!kit, sculpt: !!kit };
    const gen = ++this.paintGen;
    const first = !this.scene;
    const key = terrainKey(world.name, seed, r, herb, shrub);
    const base = new TiledCanvas(W, H);
    const cached = await readTerrain(key);
    /** 还要不要一块块补细的（先放了一张粗的）。 */
    let refineLater = false;
    if (cached) {
      base.drawImage(cached);
      cached.close();
    } else if (first) {
      // 第一次打开、没有缓存：先秒出一张粗的（原来的格子、不铺叶子），细的等场景搭好以后按瓦片补（refineTerrainTiles）。
      const coarse = r === 1 ? fields : buildFields({ width: w, height: h, terrain: Uint8Array.from(terrain as ArrayLike<number>), herb, shrub });
      const img = await pool.paint(coarse, seed, { ...opts, noLeaves: true });
      const tmp = document.createElement('canvas');
      tmp.width = img.width;
      tmp.height = img.height;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      base.drawImage(tmp);
      refineLater = true;
    } else {
      // 换季重画：旧的那张留着，新的在后台整张画好再换。
      await pool.paintBands(fields, seed, opts, bandsFrom(H, H / 2), (y0, _y1, data) => base.putRows(y0, data));
      if (gen !== this.paintGen) return;
      void writeTerrain(key, base.toCanvas());
    }
    // 地上的贴片（草皮、卵石）另画一张，盖在地形上：地形补细的时候不会把它们擦掉。
    // 半分辨率就够了（贴片本来就是半透明的一片片），省一半多的显存。
    const decal = document.createElement('canvas');
    decal.width = Math.ceil(W / 2);
    decal.height = Math.ceil(H / 2);
    const dctx = decal.getContext('2d')!;
    dctx.scale(0.5, 0.5);
    const scene = new PaperScene();
    base.flush();
    scene.setBaseView(base.view, base.textures);
    const decalTex = Texture.from(decal);
    const decalSprite = new Sprite(decalTex);
    decalSprite.scale.set(2);
    scene.spin.addChildAt(decalSprite, 1);
    scene.own(decalTex);
    if (kit) {
      const rabbit = state.config.species.find((sp) => sp.id === 'rabbit');
      placeVegetation(scene, {
        fields,
        herb: fields.herb,
        shrub: fields.shrub,
        seed,
        rabbitLen: tokenLengthCells(rabbit?.bodyMassKg ?? 1.6) * PX,
        kit,
        P1: this.assets.P1,
        P2: this.assets.P2,
        P3: this.assets.P3,
        art: 'lovart',
        base: dctx,
      });
      decalTex.source.update();
    }
    scene.bakeShadows(this.app.renderer, W, H);
    this.animals.seed = seed;
    this.animals.redraw();
    this.animals.attach(scene);
    scene.topSpin.addChild(this.overlay);
    scene.root.addChild(this.labelBox);
    const old = this.scene;
    this.scene = scene;
    this.app.stage.addChildAt(scene.root, 0);
    old?.dispose();
    if (refineLater) void this.refineTerrainTiles(gen, fields, seed, opts, base, key);
  }

  /** 正在画的是第几张（换了一张就停掉旧的那张的补细）。 */
  private paintGen = 0;

  /**
   * 按瓦片补细：一条一条（每条 64 行）地画，屏幕中间那一带先画；每画好几条就更新一次贴图。全部画完存进浏览器。
   */
  private async refineTerrainTiles(gen: number, fields: Fields, seed: number, opts: { softVegetation: boolean; sculpt: boolean }, base: TiledCanvas, key: string): Promise<void> {
    // 屏幕中心对着剪纸里的哪一行。
    const centre = Math.max(0, Math.min(base.height, this.camera.center.y * this.K));
    const timer = window.setInterval(() => gen === this.paintGen && base.flush(), 200);
    try {
      await this.assets.pool.paintBands(fields, seed, opts, bandsFrom(base.height, centre), (y0, _y1, data) => {
        if (gen === this.paintGen) base.putRows(y0, data);
      });
    } finally {
      window.clearInterval(timer);
    }
    if (gen !== this.paintGen) return;
    base.flush();
    void writeTerrain(key, base.toCanvas());
  }

  /** 素材图集（纸剧场画真实物种用 P7）。 */
  get sheets(): { P6: Sheet | null; P7: Sheet | null } {
    return { P6: this.assets.P6, P7: this.assets.P7 };
  }

  /** 藏起剪纸地图（纸剧场整个盖住时，不用再画它）。 */
  setHidden(hidden: boolean): void {
    if (this.scene) this.scene.root.visible = !hidden;
    this.vignette.visible = !hidden;
  }

  private live: LiveLayer | null = null;
  private liveSeed = 1;

  /**
   * 改用活的图层画动物（小岛上的"立足"型委托，见 liveLayer.ts）：动物是一小群自己走动的演员，不再逐只画个体。
   * kit 是纸偶的切图零件，载入以前设计物种先用通用木偶顶着。
   */
  useLive(rules: GaitRules, kit: Promise<RigKit>, onEvent?: (kind: 'birth' | 'death') => void): void {
    const live = new LiveLayer(this.assets.P7, rules, PX * this.detail, this.liveSeed, onEvent);
    this.live = live;
    this.animals.useLive(live);
    void kit.then((k) => live.setKit(k));
  }

  /** 是不是在用活的图层（用它时不需要把格子展开成个体）。 */
  get isLive(): boolean {
    return this.live !== null;
  }

  /** 一种设计物种的纸偶怎么搭（身体、颜色）。 */
  setRig(id: string, spec: RigSpec): void {
    this.live?.setRig(id, spec);
  }

  /** 这一季到目前为止各物种的账目：活的图层把出生和死亡演出来。 */
  setTally(rows: readonly SpeciesQuarter[]): void {
    this.live?.setTally(rows);
  }

  /** 设计物种在现场画成设计台上那只纸偶的样子（url 是设计台截下来的图）。 */
  async setPortrait(id: string, url: string): Promise<void> {
    const img = new Image();
    img.src = url;
    await img.decode();
    this.animals.setPortrait(id, Texture.from(img));
    this.redraw();
  }

  setSpecies(species: readonly DerivedSpecies[]): void {
    this.grid.speciesColors = species.map((sp) => colorOf(sp.params).chart);
    // 构造时 animals 还没建好（它自己在构造时就拿到了物种）。
    this.animals?.setSpecies(species);
    this.redraw();
  }

  /** 屏幕中心对着哪一格，以及屏幕上看得见的地面有几格宽、几格高（倾斜、旋转时取四角的外接框）。 */
  visibleCells(): { cx: number; cy: number; w: number; h: number } {
    const { x: SW, y: SH } = this.camera.screenSize;
    const corners = [
      { x: 0, y: 0 },
      { x: SW, y: 0 },
      { x: 0, y: SH },
      { x: SW, y: SH },
    ].map((p) => this.camera.screenToWorld(p));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    return {
      cx: this.camera.center.x / CELL_PX,
      cy: this.camera.center.y / CELL_PX,
      w: (Math.max(...xs) - Math.min(...xs)) / CELL_PX,
      h: (Math.max(...ys) - Math.min(...ys)) / CELL_PX,
    };
  }

  /** 镜头是否放大到了能看清个体的程度（CLOSE_UP_CELL_PX）。 */
  get closeUp(): boolean {
    return this.camera.zoom * CELL_PX >= CLOSE_UP_CELL_PX;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get ticker(): Application['ticker'] {
    return this.app.ticker;
  }

  get deathLegendMax(): number {
    return this.grid.lastMax;
  }

  setAlertAt(at: { x: number; y: number } | null): void {
    this.annotations.alertAt = at;
  }

  /** 数据图层：植被就是剪纸地形本身；物种密度、死亡热力图半透明地叠在陆地上。 */
  setLayer(layer: DataLayer): void {
    this.layer = layer;
    this.redraw();
  }

  setCases(cases: readonly { id: string; name: string; x: number; y: number; massKg: number }[]): void {
    this.animals.setCases(cases);
  }

  setFenceStart(p: { x: number; y: number } | null): void {
    this.annotations.fenceStart = p;
  }

  /** 趁现在画面被盖着（季末的验收单），把地图按新的植被重画一遍。 */
  repaintSoon(): void {
    this.repaintAsked = true;
  }

  /** 陆地上草本的平均多少（占上限的比例）：判断值不值得整张重画。 */
  private vegetationLevel(state: Readonly<SimState>): number {
    const world = state.config.world;
    const k = herbIndex(world);
    const herb = state.grid.plants[k]!;
    const max = world.plants[k]!.maxBiomass;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < herb.length; i += 3) {
      if (state.grid.terrain[i] === 0) continue;
      sum += Math.min(1, herb[i]! / max);
      n += 1;
    }
    return n > 0 ? sum / n : 0;
  }

  redraw(): void {
    this.lastDay = -1;
    this.animals?.redraw();
  }

  draw(state: Readonly<SimState>): void {
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (!this.building) {
      if (state.grid.terrain !== this.terrain && !sameTerrain(state.grid.terrain, this.terrain)) {
        // 换了一局：地形变了，重画整张剪纸地图。
        // （每一帧送来的状态都是新拷贝，数组不是同一个；要比内容，不然会一遍接一遍不停地重画。）
        this.terrain = state.grid.terrain;
        void this.build(state);
      } else if (this.repaintAsked || (Math.abs(day - this.builtDay) >= REPAINT_DAYS * this.detail * this.detail && performance.now() - this.builtAt > REPAINT_MS)) {
        // 整张重画要顿一下（细分以后更久）：植被没怎么变就不画，过几天再看；外面说"现在画"（季末的验收单盖着画面时）就马上画。
        const veg = this.vegetationLevel(state);
        if (this.repaintAsked ? Math.abs(veg - this.builtVeg) >= 0.01 : Math.abs(veg - this.builtVeg) >= REPAINT_CHANGE) void this.build(state);
        else this.builtDay = day;
        this.repaintAsked = false;
      }
    }
    const overlayOn = this.layer.kind !== 'vegetation';
    this.grid.container.visible = overlayOn;
    if (day !== this.lastDay) {
      if (overlayOn) this.grid.update(state, this.layer);
      this.lastDay = day;
    }
    this.grid.setGridLinesVisible(false);
    const cellPx = this.camera.zoom * CELL_PX;
    this.annotations.alertRing.visible = cellPx < CLOSE_UP_CELL_PX;
    this.annotations.draw(state);
    this.drawFocus(state);
    this.animals.update(state, this.closeUp);
    this.layout();
  }

  private drawFocus(state: Readonly<SimState>): void {
    const f = state.focus;
    const key = f ? `${f.x0},${f.y0},${f.x1},${f.y1}` : '';
    if (key === this.focusKey) return;
    this.focusKey = key;
    this.focusOutline.clear();
    if (f)
      this.focusOutline
        .rect(f.x0 * CELL_PX, f.y0 * CELL_PX, (f.x1 - f.x0) * CELL_PX, (f.y1 - f.y0) * CELL_PX)
        .stroke({ width: 2, color: BLUEPRINT, alpha: 0.7 });
  }

  /** 把游戏的镜头换算成剪纸场景的镜头，摆好地面和立起来的东西。 */
  private layout(): void {
    const scene = this.scene;
    if (!scene) return;
    const cam = this.cam;
    const { x: SW, y: SH } = this.camera.screenSize;
    const K = this.K;
    cam.s = this.camera.zoom / K;
    cam.t = this.camera.tilt;
    cam.r = this.camera.yaw;
    anchor(cam, this.camera.center.x * K, this.camera.center.y * K, 0, SW / 2, SH / 2);
    scene.layout(cam);
    this.animals.layout(cam);
    this.labelBox.scale.set(cam.s);
    // 批注文字：从地面上的位置立起来，随缩放变大变小。
    const ct = Math.cos(cam.t);
    for (const child of this.annotations.labels.children) {
      const t = child as Text;
      let g = this.labelGround.get(t);
      if (!g) {
        g = { x: t.x, y: t.y };
        this.labelGround.set(t, g);
        t.scale.set(K);
      }
      const [x, y] = rotate(cam, g.x * K, g.y * K);
      t.position.set(x, y * ct);
    }
  }
}

/** 屏幕四角压暗一点、偏暖：把整张图收成一个画面。 */
function vignetteCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 118, 70, 128, 128, 190);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(120,88,56,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}
