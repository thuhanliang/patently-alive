/**
 * 格子坐标 ↔ 世界坐标（像素，未缩放）的唯一换算处。
 * 现在是正俯视：一格是 CELL_PX × CELL_PX 的正方形。
 * 以后如果改成等距 2.5 维，只改这个文件。
 */
export const CELL_PX = 8;

export interface Point {
  x: number;
  y: number;
}

/** 格子 (cx, cy) 左上角的世界坐标。 */
export function cellToWorld(cx: number, cy: number): Point {
  return { x: cx * CELL_PX, y: cy * CELL_PX };
}

/** 世界坐标落在哪一格（可能超出地图，调用方自己判断）。 */
export function worldToCell(p: Point): Point {
  return { x: Math.floor(p.x / CELL_PX), y: Math.floor(p.y / CELL_PX) };
}

/** 离世界坐标最近的格角（格子坐标，整数；围栏端点用）。 */
export function worldToCorner(p: Point): Point {
  return { x: Math.round(p.x / CELL_PX), y: Math.round(p.y / CELL_PX) };
}

export function mapWorldSize(width: number, height: number): Point {
  return { x: width * CELL_PX, y: height * CELL_PX };
}
