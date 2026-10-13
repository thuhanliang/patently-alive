import { Application, Container } from 'pixi.js';
import { TICKS_PER_DAY, type SimState } from '../sim';
import { Camera } from './camera';
import { GridLayer, type DataLayer } from './gridLayer';
import { CELL_PX, mapWorldSize } from './projection';

/** 格线在一格放大到多少屏幕像素以上时出现。 */
const GRID_LINES_MIN_CELL_PX = 14;

/**
 * 灰盒画面：只读推演状态，不改任何状态。
 * 世界容器跟着镜头平移缩放；界面元素不在这里。
 */
export class GreyboxView {
  readonly camera = new Camera();
  private readonly world = new Container();
  private readonly grid: GridLayer;
  private lastDay = -1;
  private layer: DataLayer = { kind: 'vegetation' };

  private constructor(
    readonly app: Application,
    state: Readonly<SimState>,
  ) {
    const { width, height } = state.grid;
    this.grid = new GridLayer(width, height);
    this.world.addChild(this.grid.container);
    app.stage.addChild(this.world);

    this.camera.setWorld(mapWorldSize(width, height));
    this.camera.setScreen(app.screen.width, app.screen.height);
    this.camera.preset('map');
    app.renderer.on('resize', (w: number, h: number) => this.camera.setScreen(w, h));
  }

  static async mount(host: HTMLElement, state: Readonly<SimState>): Promise<GreyboxView> {
    const app = new Application();
    await app.init({ resizeTo: host, background: 0x2b2b2b, antialias: false });
    host.appendChild(app.canvas);
    return new GreyboxView(app, state);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  get ticker(): Application['ticker'] {
    return this.app.ticker;
  }

  setLayer(layer: DataLayer): void {
    this.layer = layer;
    this.lastDay = -1; // 下一帧重画
  }

  draw(state: Readonly<SimState>): void {
    // 植被每天才变一次，只在换天时重画贴图。
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (day !== this.lastDay) {
      this.grid.update(state, this.layer);
      this.lastDay = day;
    }
    this.grid.setGridLinesVisible(this.camera.zoom * CELL_PX >= GRID_LINES_MIN_CELL_PX);
    this.camera.apply(this.world);
  }
}
