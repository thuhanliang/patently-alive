import { Application, Container } from 'pixi.js';
import { buildShapeTextures, shapeOf } from './sprites';
import { AnnotationLayer } from './annotationLayer';
import { TICKS_PER_DAY, type DerivedSpecies, type SimState } from '../sim';
import { Camera } from './camera';
import { GridLayer, type DataLayer } from './gridLayer';
import { IndividualLayer } from './individualLayer';
import { CELL_PX, mapWorldSize } from './projection';
import { PAPER, speciesColor } from './palette';

/** 格线在一格放大到多少屏幕像素以上时出现。 */
const GRID_LINES_MIN_CELL_PX = 14;

/**
 * 地图画面（田野笔记的占位画法，见 palette.ts）：只读推演状态，不改任何状态。
 * 世界容器跟着镜头平移缩放；界面元素不在这里。
 */
export class MapView {
  readonly camera = new Camera();
  private readonly world = new Container();
  private readonly grid: GridLayer;
  private readonly individuals: IndividualLayer;
  private readonly annotations: AnnotationLayer;
  private lastTick = -1;
  private lastDay = -1;
  private layer: DataLayer = { kind: 'vegetation' };

  private constructor(
    readonly app: Application,
    state: Readonly<SimState>,
    species: readonly DerivedSpecies[],
  ) {
    const { width, height } = state.grid;
    const colors = species.map((sp) => speciesColor(sp.params.id));
    this.grid = new GridLayer(width, height, state.grid.terrain, colors.map((c) => c.chart));
    const shapes = buildShapeTextures(app.renderer);
    this.individuals = new IndividualLayer(
      species,
      species.map((sp) => shapes[shapeOf(sp.params.id)]),
      colors.map((c) => c.body),
    );
    this.annotations = new AnnotationLayer(state.config.tools);
    this.world.addChild(this.grid.container, this.individuals.container, this.annotations.container);
    app.stage.addChild(this.world);

    this.camera.setWorld(mapWorldSize(width, height));
    this.camera.setScreen(app.screen.width, app.screen.height);
    this.camera.preset('map');
    app.renderer.on('resize', (w: number, h: number) => this.camera.setScreen(w, h));
  }

  static async mount(
    host: HTMLElement,
    state: Readonly<SimState>,
    species: readonly DerivedSpecies[],
  ): Promise<MapView> {
    const app = new Application();
    await app.init({ resizeTo: host, background: PAPER, antialias: true });
    host.appendChild(app.canvas);
    return new MapView(app, state, species);
  }

  /** 屏幕中心对着哪一格，以及屏幕上看得见几格宽、几格高。 */
  visibleCells(): { cx: number; cy: number; w: number; h: number } {
    const cellPx = this.camera.zoom * CELL_PX;
    return {
      cx: this.camera.center.x / CELL_PX,
      cy: this.camera.center.y / CELL_PX,
      w: this.app.screen.width / cellPx,
      h: this.app.screen.height / cellPx,
    };
  }

  /** 镜头是否放大到了能看清个体的程度（和出现格线是同一个门槛）。 */
  get closeUp(): boolean {
    return this.camera.zoom * CELL_PX >= GRID_LINES_MIN_CELL_PX;
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get ticker(): Application['ticker'] {
    return this.app.ticker;
  }

  setLayer(layer: DataLayer): void {
    this.layer = layer;
    this.redraw();
  }

  /** 正在画的围栏的起点（格角坐标），在地图上标出来；null 表示没在画。 */
  setFenceStart(p: { x: number; y: number } | null): void {
    this.annotations.fenceStart = p;
  }

  /** 下一帧强制重画格子和个体（换了一局、投放了动物时用）。 */
  redraw(): void {
    this.lastDay = -1;
    this.lastTick = -1;
  }

  draw(state: Readonly<SimState>): void {
    // 格子图层每天才变一次，只在换天时重画贴图；个体每个 tick 都可能动。
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (day !== this.lastDay) {
      this.grid.update(state, this.layer);
      this.lastDay = day;
    }
    if (state.tick !== this.lastTick) {
      this.individuals.draw(state);
      this.lastTick = state.tick;
    }
    this.annotations.draw(state);
    this.grid.setGridLinesVisible(this.camera.zoom * CELL_PX >= GRID_LINES_MIN_CELL_PX);
    this.camera.apply(this.world);
  }
}
