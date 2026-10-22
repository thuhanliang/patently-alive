/**
 * 随缩放变化的倾斜镜头（斜二测，不是透视）：拉远时正俯视，像地图；拉近时往斜上方倾，像看一张立体贺卡。
 * - 地面（地形、投影）只在竖直方向压扁 cos t；
 * - 高处（台阶、立起来的植物和动物）再往上抬 z·sin t；
 * - 植物和动物是"立起来的纸片"，始终正对镜头，不压扁。
 * - 还可以绕竖直轴转一个角度 r（有限）：地面先在自己的平面里转，再压扁；纸片只换位置，仍正对镜头。
 * 所有坐标换算只走这里的 project / unprojectGround。
 */

export interface Cam {
  /** 缩放：一个世界像素在屏幕上多少像素。 */
  s: number;
  /** 倾斜角（弧度）：0 = 正俯视。 */
  t: number;
  /** 绕竖直轴的旋转（弧度）：0 = 北在上。 */
  r: number;
  /** 世界原点在屏幕上的位置。 */
  ox: number;
  oy: number;
}

export const TILT_MAX = (50 * Math.PI) / 180;
/** 手动调俯仰、旋转时的上限：俯仰 0–60°，旋转 ±45°（再大，平贴在地上的纸和立着的纸片就对不上了）。 */
export const PITCH_LIMIT = (60 * Math.PI) / 180;
export const YAW_LIMIT = (45 * Math.PI) / 180;
/** 缩放在 TILT_FROM 以下完全俯视，到 TILT_TO 倾到最大。 */
const TILT_FROM = 0.5;
const TILT_TO = 2.2;

export function tiltFor(s: number): number {
  const x = Math.min(1, Math.max(0, (s - TILT_FROM) / (TILT_TO - TILT_FROM)));
  return TILT_MAX * x * x * (3 - 2 * x);
}

/** 地面点绕原点转 r 以后的坐标（还没压扁）。 */
export function rotate(cam: Cam, x: number, y: number): [number, number] {
  const c = Math.cos(cam.r);
  const s = Math.sin(cam.r);
  return [x * c - y * s, x * s + y * c];
}

/** 世界点（x, y 在地面上，z 为抬高）到屏幕。 */
export function project(cam: Cam, x: number, y: number, z: number): [number, number] {
  const [rx, ry] = rotate(cam, x, y);
  return [cam.ox + cam.s * rx, cam.oy + cam.s * (ry * Math.cos(cam.t) - z * Math.sin(cam.t))];
}

/** 屏幕点落在地面（z = 0）上的哪里。 */
export function unprojectGround(cam: Cam, sx: number, sy: number): [number, number] {
  const rx = (sx - cam.ox) / cam.s;
  const ry = (sy - cam.oy) / (cam.s * Math.cos(cam.t));
  const c = Math.cos(cam.r);
  const s = Math.sin(cam.r);
  return [rx * c + ry * s, -rx * s + ry * c];
}

/** 让世界点 (x, y, z) 落在屏幕 (sx, sy) 上：改 ox、oy。 */
export function anchor(cam: Cam, x: number, y: number, z: number, sx: number, sy: number): void {
  const [rx, ry] = rotate(cam, x, y);
  cam.ox = sx - cam.s * rx;
  cam.oy = sy - cam.s * (ry * Math.cos(cam.t) - z * Math.sin(cam.t));
}
