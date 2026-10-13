import { Application, Graphics } from 'pixi.js';
import { PLACEHOLDER_GRID, type SimState } from '../sim';

/**
 * 灰盒画面：只读推演状态，画灰色方块。不改任何状态。
 * 第 2 步换成格子地图、植被着色和平移缩放。
 */
export class GreyboxView {
  private readonly app: Application;
  private readonly board = new Graphics();
  private readonly marks = new Graphics();

  private constructor(app: Application) {
    this.app = app;
    app.stage.addChild(this.board, this.marks);
  }

  static async mount(host: HTMLElement): Promise<GreyboxView> {
    const app = new Application();
    await app.init({ resizeTo: host, background: 0x2b2b2b, antialias: false });
    host.appendChild(app.canvas);
    return new GreyboxView(app);
  }

  get ticker(): Application['ticker'] {
    return this.app.ticker;
  }

  draw(state: Readonly<SimState>): void {
    const { width, height } = this.app.screen;
    const n = PLACEHOLDER_GRID;
    const cell = Math.max(1, Math.floor((Math.min(width, height) - 32) / n));
    const ox = Math.floor((width - cell * n) / 2);
    const oy = Math.floor((height - cell * n) / 2);

    this.board.clear().rect(ox, oy, cell * n, cell * n).fill(0x4a4a4a);

    this.marks.clear();
    for (const w of state.walkers) {
      this.marks.rect(ox + w.x * cell, oy + w.y * cell, cell, cell);
    }
    this.marks.fill(0xc8c8c8);
  }
}
