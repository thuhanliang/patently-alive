import type { FenceType } from '../data/schema/tools';
import { JUVENILE_SIZE_FACTOR, type DerivedSpecies } from './physiology';
import { TERRAIN } from './terrain';

/**
 * 围栏：玩家在地图上画的直线段，端点在格子的角上（整数坐标，0..width / 0..height）。
 * 一段围栏挡住所有"两个格子中心的连线和它交叉"的相邻格边；被挡住的格边，过不去的动物不能跨。
 * 围栏正好穿过格子中心时，那一格算在哪一边由一个极小的固定偏移（FENCE_NUDGE）决定，
 * 所以围栏是一道墙，不会把它穿过的格子四面都封死，也不会在格子中心处留缝。
 *
 * 谁过得去由性状推出（铁律 5）：
 * - 会飞的过得去；
 * - 比网眼能挡住的最小体重还轻的钻得过去（围栏数据的 minMassKg）；
 * - 会爬的翻得过去，除非围栏顶上有防爬的弧形帽（stopsClimbers）。
 * 幼体按成体体重 × JUVENILE_SIZE_FACTOR（出生到长成的平均）算，比成体容易钻过网眼。
 * 为了简单，每个物种只按成体和这个平均幼体各算一套，出了窝的各年龄段幼体都用幼体那套。
 */
export interface Fence {
  id: number;
  /** 围栏类型在 tools.fences 里的下标。 */
  type: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 一个物种过不去的格边。v[y*w+x]：(x,y) 和 (x+1,y) 之间；h[y*w+x]：(x,y) 和 (x,y+1) 之间。 */
export interface Barrier {
  v: Uint8Array;
  h: Uint8Array;
}

/** 这种围栏挡不挡得住体重 massKg 的这个物种。 */
export function fenceStops(type: FenceType, sp: DerivedSpecies, massKg: number): boolean {
  const m = sp.params.movement;
  if (m.flies) return false;
  if (massKg < type.minMassKg) return false;
  if (m.climbs && !type.stopsClimbers) return false;
  return true;
}

/** 围栏长度（格）。 */
export function fenceLengthCells(f: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = f.x1 - f.x0;
  const dy = f.y1 - f.y0;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 判定格边时把围栏挪开的极小偏移（格）。格子中心都在半格上，围栏端点在整格上，
 * 挪开后只有斜率正好是 FENCE_NUDGE_Y / FENCE_NUDGE_X 的围栏才可能再穿过中心，地图边长在千格以内不会发生。
 */
const FENCE_NUDGE_X = 1e-6;
const FENCE_NUDGE_Y = 1.37e-7;

/** 叉积的符号：c 在 a→b 的哪一边。 */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
}

/** 线段 p1p2 和 q1q2 相交（含端点接触）。 */
export function segmentsTouch(
  p1x: number, p1y: number, p2x: number, p2y: number,
  q1x: number, q1y: number, q2x: number, q2y: number,
): boolean {
  const o1 = orient(p1x, p1y, p2x, p2y, q1x, q1y);
  const o2 = orient(p1x, p1y, p2x, p2y, q2x, q2y);
  const o3 = orient(q1x, q1y, q2x, q2y, p1x, p1y);
  const o4 = orient(q1x, q1y, q2x, q2y, p2x, p2y);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1x, p1y, p2x, p2y, q1x, q1y)) return true;
  if (o2 === 0 && onSegment(p1x, p1y, p2x, p2y, q2x, q2y)) return true;
  if (o3 === 0 && onSegment(q1x, q1y, q2x, q2y, p1x, p1y)) return true;
  if (o4 === 0 && onSegment(q1x, q1y, q2x, q2y, p2x, p2y)) return true;
  return false;
}

/** 把一段围栏挡住的格边标进 barrier。 */
export function markFence(barrier: Barrier, width: number, height: number, f: Fence): void {
  const ax = f.x0 + FENCE_NUDGE_X;
  const ay = f.y0 + FENCE_NUDGE_Y;
  const bx = f.x1 + FENCE_NUDGE_X;
  const by = f.y1 + FENCE_NUDGE_Y;
  const xMin = Math.max(0, Math.floor(Math.min(f.x0, f.x1)) - 1);
  const xMax = Math.min(width - 1, Math.ceil(Math.max(f.x0, f.x1)));
  const yMin = Math.max(0, Math.floor(Math.min(f.y0, f.y1)) - 1);
  const yMax = Math.min(height - 1, Math.ceil(Math.max(f.y0, f.y1)));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (x + 1 < width && segmentsTouch(cx, cy, cx + 1, cy, ax, ay, bx, by)) barrier.v[y * width + x] = 1;
      if (y + 1 < height && segmentsTouch(cx, cy, cx, cy + 1, ax, ay, bx, by)) barrier.h[y * width + x] = 1;
    }
  }
}

/**
 * 每个物种（成体、最大的幼体各一套）过不去的格边。没有任何围栏挡得住它时为 null，省得每步都查。
 * 由状态里的围栏推出，不进快照。
 */
export function buildBarriers(
  fences: readonly Fence[],
  types: readonly FenceType[],
  species: readonly DerivedSpecies[],
  width: number,
  height: number,
): { adult: (Barrier | null)[]; juvenile: (Barrier | null)[] } {
  const make = (mass: (sp: DerivedSpecies) => number): (Barrier | null)[] =>
    species.map((sp) => {
      const mine = fences.filter((f) => fenceStops(types[f.type]!, sp, mass(sp)));
      if (mine.length === 0) return null;
      const b: Barrier = { v: new Uint8Array(width * height), h: new Uint8Array(width * height) };
      for (const f of mine) markFence(b, width, height, f);
      return b;
    });
  return {
    adult: make((sp) => sp.params.bodyMassKg),
    juvenile: make((sp) => sp.params.bodyMassKg * JUVENILE_SIZE_FACTOR),
  };
}

/** 从 (px,py) 格走到相邻的 (cx,cy) 格（横、竖或斜一步）要不要跨被挡住的格边。 */
function edgeBlocked(b: Barrier, width: number, px: number, py: number, cx: number, cy: number): boolean {
  const vAt = (x0: number, x1: number, y: number): boolean => b.v[y * width + Math.min(x0, x1)] === 1;
  const hAt = (x: number, y0: number, y1: number): boolean => b.h[Math.min(y0, y1) * width + x] === 1;
  if (cx !== px && cy === py) return vAt(px, cx, py);
  if (cy !== py && cx === px) return hAt(px, py, cy);
  if (cx === px && cy === py) return false;
  // 斜着走：先横后竖、先竖后横两条路都被挡才算过不去（擦着围栏的角走不算翻过去）。
  const viaX = vAt(px, cx, py) || hAt(cx, py, cy);
  const viaY = hAt(px, py, cy) || vAt(px, cx, cy);
  return viaX && viaY;
}

/**
 * 从 (x0,y0) 直线走到 (x1,y1)（连续坐标，单位是格）路上有没有水或挡得住它的围栏。
 * 按半格的步长取点，起点不算，相邻两点最多差一格。动物不会游泳：格子扩散的一跳、个体一小时的一步
 * 都不能越过水面或挡得住它的围栏，哪怕落点是对岸的陆地。barrier 为 null 时只看水。
 */
export function pathBlocked(
  terrain: Uint8Array,
  barrier: Barrier | null,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
  let px = Math.floor(x0);
  let py = Math.floor(y0);
  for (let k = 1; k <= steps; k++) {
    const x = Math.floor(x0 + (dx * k) / steps);
    const y = Math.floor(y0 + (dy * k) / steps);
    if (terrain[y * width + x] === TERRAIN.water) return true;
    if (barrier && edgeBlocked(barrier, width, px, py, x, y)) return true;
    px = x;
    py = y;
  }
  return false;
}
