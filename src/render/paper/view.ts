import { Application, Container, Graphics, Sprite, Texture, type Text } from 'pixi.js';
import { TICKS_PER_DAY, herbIndex, woodyIndex, type DerivedSpecies, type SimState } from '../../sim';
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
import { PX, buildFields, type Palette } from './terrain';
import { tokenLengthCells } from './tokens';
import { placeVegetation } from './vegetation';
import { AnimalLayer } from './animalLayer';
import type { ViewAngles } from '../view';

/** 剪纸像素 / 游戏世界坐标：游戏一格 CELL_PX，剪纸一格 PX。 */
const K = PX / CELL_PX;
/**
 * 植被变了以后重画剪纸地图：推演里至少过了这么多天，而且离上次画完至少这么多毫秒（高倍速时不至于一直在画）。
 * 重画时草丛、灌丛跟着植被量换样子（被啃的泛黄、稀疏），地面颜色也跟着变。
 */
const REPAINT_DAYS = 10;
const REPAINT_MS = 5000;

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
 * 剪纸画面（默认；?art=notes 换回田野笔记的旧画面）：和 MapView 同一套接口，main.ts 不用改。只读推演状态，不改任何状态。
 * - 地形逐像素画成纸雕（Worker 里并行，见 painter.ts），植被立起来、正对镜头（vegetation.ts、scene.ts）；
 * - 镜头可以倾斜、旋转（camera.ts 的 tilt、yaw），拉远俯视、拉近斜看；点击换算走同一个 Camera，点哪儿是哪儿；
 * - 玩家的批注、关注区边框、警报圈、数据图层都画在地面上，跟着地面压扁、旋转；批注的文字立起来。
 * 世界坐标仍是游戏的（一格 CELL_PX），剪纸场景内部是剪纸像素（一格 PX），中间差一个倍数 K。
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
  private builtAt = 0;
  private readonly vignette: Sprite;
  private readonly cam: Cam = { s: 1, t: 0, r: 0, ox: 0, oy: 0 };
  private readonly animals: AnimalLayer;
  readonly angles: ViewAngles = { pitchLimit: PITCH_LIMIT, yawLimit: YAW_LIMIT, autoTilt: (zoom) => tiltFor(zoom / K) };

  private constructor(
    readonly app: Application,
    state: Readonly<SimState>,
    species: readonly DerivedSpecies[],
    private readonly assets: Assets,
  ) {
    const { width, height } = state.grid;
    this.terrain = state.grid.terrain;
    this.grid = new GridLayer(width, height, state.grid.terrain, []);
    this.grid.hideWater = true;
    this.grid.setSmooth(true);
    this.grid.container.alpha = 0.78;
    this.annotations = new AnnotationLayer(state.config.tools);
    this.overlay.scale.set(K);
    this.overlay.addChild(this.grid.container, this.focusOutline, this.annotations.container);
    this.labelBox.addChild(this.annotations.labels);
    this.animals = new AnimalLayer(assets.P6, assets.P7, app.renderer, state.config.seed, species);
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
    const fields = buildFields({ width: w, height: h, terrain, herb, shrub });
    const img = await pool.paint(fields, seed, { softVegetation: !!kit, sculpt: !!kit });
    const base = document.createElement('canvas');
    base.width = img.width;
    base.height = img.height;
    const ctx = base.getContext('2d')!;
    ctx.putImageData(img, 0, 0);
    const scene = new PaperScene();
    const baseTex = Texture.from(base);
    scene.setBase(baseTex);
    if (kit) {
      const rabbit = state.config.species.find((sp) => sp.id === 'rabbit');
      placeVegetation(scene, {
        fields,
        herb,
        shrub,
        seed,
        rabbitLen: tokenLengthCells(rabbit?.bodyMassKg ?? 1.6) * PX,
        kit,
        P1: this.assets.P1,
        P2: this.assets.P2,
        P3: this.assets.P3,
        art: 'lovart',
        base: ctx,
      });
      baseTex.source.update();
    }
    scene.bakeShadows(this.app.renderer, img.width, img.height);
    this.animals.seed = seed;
    this.animals.redraw();
    this.animals.attach(scene);
    scene.topSpin.addChild(this.overlay);
    scene.root.addChild(this.labelBox);
    const old = this.scene;
    this.scene = scene;
    this.app.stage.addChildAt(scene.root, 0);
    old?.dispose();
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

  /** 镜头是否放大到了能看清个体的程度（和田野笔记画面同一个门槛）。 */
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

  redraw(): void {
    this.lastDay = -1;
    this.animals?.redraw();
  }

  draw(state: Readonly<SimState>): void {
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (!this.building) {
      if (state.grid.terrain !== this.terrain) {
        // 换了一局：地形变了，重画整张剪纸地图。
        this.terrain = state.grid.terrain;
        void this.build(state);
      } else if (Math.abs(day - this.builtDay) >= REPAINT_DAYS && performance.now() - this.builtAt > REPAINT_MS) {
        void this.build(state);
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
    cam.s = this.camera.zoom / K;
    cam.t = this.camera.tilt;
    cam.r = this.camera.yaw;
    anchor(cam, this.camera.center.x * K, this.camera.center.y * K, 0, SW / 2, SH / 2);
    scene.layout(cam);
    this.animals.layout(cam);
    this.labelBox.scale.set(cam.s);
    // 批注文字：从地面上的位置立起来，和田野笔记画面一样随缩放变大变小。
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
