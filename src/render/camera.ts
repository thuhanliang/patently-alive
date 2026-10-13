import type { Container } from 'pixi.js';
import { CELL_PX, type Point } from './projection';

/** 镜头的两档预设：全图看整片地图，地块看清一格一格。 */
export type ZoomPreset = 'map' | 'plot';

/** 地块档下一格在屏幕上的像素数。 */
const PLOT_CELL_SCREEN_PX = 28;
const MAX_CELL_SCREEN_PX = 64;

/**
 * 镜头：屏幕中心对着世界里的哪一点，以及缩放倍数。
 * 只影响画面，不影响推演。
 */
export class Camera {
  center: Point = { x: 0, y: 0 };
  zoom = 1;
  private screen: Point = { x: 1, y: 1 };
  private world: Point = { x: 1, y: 1 };

  setScreen(width: number, height: number): void {
    this.screen = { x: width, y: height };
  }

  setWorld(size: Point): void {
    this.world = size;
  }

  get fitZoom(): number {
    const margin = 0.92;
    return Math.min(this.screen.x / this.world.x, this.screen.y / this.world.y) * margin;
  }

  get minZoom(): number {
    return this.fitZoom * 0.5;
  }

  get maxZoom(): number {
    return MAX_CELL_SCREEN_PX / CELL_PX;
  }

  preset(p: ZoomPreset, focus?: Point): void {
    if (p === 'map') {
      this.zoom = this.fitZoom;
      this.center = { x: this.world.x / 2, y: this.world.y / 2 };
    } else {
      this.zoom = PLOT_CELL_SCREEN_PX / CELL_PX;
      if (focus) this.center = { ...focus };
    }
    this.clamp();
  }

  /** 当前更接近哪一档，用于界面高亮。 */
  get nearestPreset(): ZoomPreset {
    const plot = PLOT_CELL_SCREEN_PX / CELL_PX;
    return Math.abs(Math.log(this.zoom / this.fitZoom)) <= Math.abs(Math.log(this.zoom / plot)) ? 'map' : 'plot';
  }

  screenToWorld(p: Point): Point {
    return {
      x: this.center.x + (p.x - this.screen.x / 2) / this.zoom,
      y: this.center.y + (p.y - this.screen.y / 2) / this.zoom,
    };
  }

  /** 按屏幕像素平移（拖拽）。 */
  panBy(dx: number, dy: number): void {
    this.center = { x: this.center.x - dx / this.zoom, y: this.center.y - dy / this.zoom };
    this.clamp();
  }

  /** 以屏幕上某点为中心缩放，这一点下面的世界位置保持不动。 */
  zoomAt(screenPoint: Point, factor: number): void {
    const before = this.screenToWorld(screenPoint);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    const after = this.screenToWorld(screenPoint);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
    this.clamp();
  }

  apply(target: Container): void {
    target.scale.set(this.zoom);
    target.position.set(this.screen.x / 2 - this.center.x * this.zoom, this.screen.y / 2 - this.center.y * this.zoom);
  }

  /** 镜头中心不离开地图。 */
  private clamp(): void {
    this.center = {
      x: Math.min(this.world.x, Math.max(0, this.center.x)),
      y: Math.min(this.world.y, Math.max(0, this.center.y)),
    };
  }
}
