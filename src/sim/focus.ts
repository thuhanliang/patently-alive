/**
 * 关注区：只有这里面的格子展开成个体，其余按格子计数推演。
 *
 * 展开哪些格子会影响推演结果，所以关注区不能直接取自镜头：
 * 它是推演的输入，对齐到区块边界、大小有上限，在 tick 开始时生效；
 * 第 5 步改成写进操作日志的操作。
 */
export interface FocusRect {
  /** 左上角（含）和右下角（不含），单位是格。 */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 关注区对齐到这么多格一块。 */
export const FOCUS_BLOCK = 8;
/** 关注区最大边长（格）。展开的个体太多会拖慢推演和画面。 */
export const FOCUS_MAX_CELLS = 32;

/**
 * 以 (cx, cy) 为中心、想要 w×h 格的关注区：对齐到区块、截到上限、夹在地图内。
 */
export function focusAround(cx: number, cy: number, w: number, h: number, mapW: number, mapH: number): FocusRect {
  const fw = Math.min(FOCUS_MAX_CELLS, roundUp(Math.max(1, w)), roundUp(mapW));
  const fh = Math.min(FOCUS_MAX_CELLS, roundUp(Math.max(1, h)), roundUp(mapH));
  const x0 = clamp(Math.round((cx - fw / 2) / FOCUS_BLOCK) * FOCUS_BLOCK, 0, Math.max(0, mapW - fw));
  const y0 = clamp(Math.round((cy - fh / 2) / FOCUS_BLOCK) * FOCUS_BLOCK, 0, Math.max(0, mapH - fh));
  return { x0, y0, x1: Math.min(mapW, x0 + fw), y1: Math.min(mapH, y0 + fh) };
}

function roundUp(n: number): number {
  return Math.ceil(n / FOCUS_BLOCK) * FOCUS_BLOCK;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function inFocus(f: FocusRect | null, x: number, y: number): boolean {
  return f !== null && x >= f.x0 && x < f.x1 && y >= f.y0 && y < f.y1;
}

export function sameFocus(a: FocusRect | null, b: FocusRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}
