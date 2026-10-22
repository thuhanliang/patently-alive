import type { Container } from 'pixi.js';
import { CELL_PX, type Point } from './projection';

/** 镜头的三档预设：全图看整片地图和数据图层，区域看各片的群落图标，地块看清一只一只。 */
export type ZoomPreset = 'map' | 'region' | 'plot';

/** 区域档、地块档下一格在屏幕上的像素数。 */
export const REGION_CELL_SCREEN_PX = 10;
/** 一格放大到这么多像素起算"近处"：画格线、展开个体（地块档）。 */
export const CLOSE_UP_CELL_PX = 14;
const PLOT_CELL_SCREEN_PX = 28;
const MAX_CELL_SCREEN_PX = 64;

/**
 * 镜头：屏幕中心对着世界里的哪一点，以及缩放倍数。
 * 只影响画面，不影响推演。
 *
 * 剪纸画面（render/paper）的镜头还能倾斜、旋转（斜二测，不是透视）：
 * 地面先绕屏幕中心下的那一点转 yaw，再竖直压扁 cos(tilt)，最后放大 zoom。
 * tilt、yaw 都是 0 时就是原来的正俯视，换算和以前完全一样。
 */
export class Camera {
  center: Point = { x: 0, y: 0 };
  zoom = 1;
  /** 倾斜角（弧度）：0 = 正俯视。 */
  tilt = 0;
  /** 绕竖直轴的旋转（弧度）：0 = 北在上。 */
  yaw = 0;
  /** 跟着缩放自动倾斜（拉远俯视、拉近斜看）；null = 倾斜角不跟缩放变。 */
  autoTilt: ((zoom: number) => number) | null = null;
  private screen: Point = { x: 1, y: 1 };
  private world: Point = { x: 1, y: 1 };

  setScreen(width: number, height: number): void {
    this.screen = { x: width, y: height };
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom));
    this.syncTilt();
  }

  /** 屏幕的宽高（像素）。 */
  get screenSize(): Point {
    return this.screen;
  }

  private syncTilt(): void {
    if (this.autoTilt) this.tilt = this.autoTilt(this.zoom);
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
      this.zoom = this.presetZoom(p);
      if (focus) this.center = { ...focus };
    }
    this.syncTilt();
    this.clamp();
  }

  private presetZoom(p: ZoomPreset): number {
    if (p === 'map') return this.fitZoom;
    // 区域档至少比全图放大一点，屏幕很大时也分得开；但不能放大到"近处"，否则会展开个体、改变推演。
    if (p === 'region') return Math.min(Math.max(REGION_CELL_SCREEN_PX, this.fitZoom * CELL_PX * 1.6), CLOSE_UP_CELL_PX * 0.85) / CELL_PX;
    return PLOT_CELL_SCREEN_PX / CELL_PX;
  }

  /** 当前更接近哪一档（按缩放倍数的对数距离），用于界面高亮。 */
  get nearestPreset(): ZoomPreset {
    const presets: ZoomPreset[] = ['map', 'region', 'plot'];
    let best: ZoomPreset = 'map';
    let bestD = Infinity;
    for (const p of presets) {
      const d = Math.abs(Math.log(this.zoom / this.presetZoom(p)));
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** 屏幕上的一段位移对应地面上的哪段位移（倾斜、旋转时先拉回竖直、再转回来）。 */
  private screenDeltaToWorld(dx: number, dy: number): Point {
    const x = dx / this.zoom;
    const y = dy / (this.zoom * Math.cos(this.tilt));
    if (this.yaw === 0) return { x, y };
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return { x: x * c + y * s, y: -x * s + y * c };
  }

  /** 地面上的一点（z = 0）在屏幕上的位置。 */
  worldToScreen(p: Point): Point {
    const dx = p.x - this.center.x;
    const dy = p.y - this.center.y;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return {
      x: this.screen.x / 2 + this.zoom * (dx * c - dy * s),
      y: this.screen.y / 2 + this.zoom * Math.cos(this.tilt) * (dx * s + dy * c),
    };
  }

  /** 屏幕上的一点落在地面（z = 0）上的哪里。 */
  screenToWorld(p: Point): Point {
    const d = this.screenDeltaToWorld(p.x - this.screen.x / 2, p.y - this.screen.y / 2);
    return { x: this.center.x + d.x, y: this.center.y + d.y };
  }

  /** 按屏幕像素平移（拖拽）。 */
  panBy(dx: number, dy: number): void {
    const d = this.screenDeltaToWorld(dx, dy);
    this.center = { x: this.center.x - d.x, y: this.center.y - d.y };
    this.clamp();
  }

  /** 以屏幕上某点为中心缩放，这一点下面的世界位置保持不动。 */
  zoomAt(screenPoint: Point, factor: number): void {
    const before = this.screenToWorld(screenPoint);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.syncTilt();
    const after = this.screenToWorld(screenPoint);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
    this.clamp();
  }

  /** 正俯视的画面用：把世界容器摆到镜头的位置（不管倾斜和旋转）。 */
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
