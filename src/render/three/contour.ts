/**
 * 等高线（2026-11-22，纸雕地形）：在一张标量场上找出 v ≥ iso 的区域的边界，连成闭合的环。
 * 纯函数，不碰渲染。场外当作无穷低，所以环总是闭合的。
 *
 * 环的方向是固定的：算出的有向面积（x 向右、y 向下的采样坐标里，Σ x_i·y_{i+1} − x_{i+1}·y_i）
 * 外边界是负的，洞是正的。
 */

export interface Field {
  /** 采样点的列数、行数。 */
  w: number;
  h: number;
  /** 行优先：v[y * w + x]。 */
  v: ArrayLike<number>;
}

export interface Region {
  outer: number[];
  holes: number[][];
}

const LOW = -1e9;

/** v ≥ iso 的区域的全部边界环，每个环是 [x0, y0, x1, y1, ……]（采样坐标）。 */
export function isoLoops(f: Field, iso: number): number[][] {
  const { w, h, v } = f;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? LOW : v[y * w + x]!);
  // 边的编号：横边 (x, y)–(x+1, y)、竖边 (x, y)–(x, y+1)，x、y 从 −1 起。
  const W = w + 2;
  const hKey = (x: number, y: number): number => ((y + 1) * W + (x + 1)) * 2;
  const vKey = (x: number, y: number): number => ((y + 1) * W + (x + 1)) * 2 + 1;
  const pts = new Map<number, [number, number]>();
  const cross = (a: number, b: number): number => {
    const t = (iso - a) / (b - a);
    return Math.min(1, Math.max(0, t));
  };
  const hPoint = (x: number, y: number): number => {
    const k = hKey(x, y);
    if (!pts.has(k)) pts.set(k, [x + cross(at(x, y), at(x + 1, y)), y]);
    return k;
  };
  const vPoint = (x: number, y: number): number => {
    const k = vKey(x, y);
    if (!pts.has(k)) pts.set(k, [x, y + cross(at(x, y), at(x, y + 1))]);
    return k;
  };
  const next = new Map<number, number>();
  for (let y = -1; y < h; y++)
    for (let x = -1; x < w; x++) {
      const tl = at(x, y) >= iso;
      const tr = at(x + 1, y) >= iso;
      const br = at(x + 1, y + 1) >= iso;
      const bl = at(x, y + 1) >= iso;
      const n = +tl + +tr + +br + +bl;
      if (n === 0 || n === 4) continue;
      // 按 左上 → 右上 → 右下 → 左下 绕一圈：从里到外的边是出口，从外到里的是入口。
      const corners = [tl, tr, br, bl];
      const edge = [(): number => hPoint(x, y), (): number => vPoint(x + 1, y), (): number => hPoint(x, y + 1), (): number => vPoint(x, y)];
      const kinds: Array<{ e: number; exit: boolean }> = [];
      for (let e = 0; e < 4; e++) {
        const a = corners[e]!;
        const b = corners[(e + 1) % 4]!;
        if (a !== b) kinds.push({ e, exit: a });
      }
      const link = (entry: number, exit: number): void => {
        next.set(edge[entry]!(), edge[exit]!());
      };
      if (kinds.length === 2) {
        const en = kinds.find((k) => !k.exit)!.e;
        const ex = kinds.find((k) => k.exit)!.e;
        link(en, ex);
      } else {
        // 鞍点：看中心。中心在里面时，两个在里的角连通，切掉两个在外的角。
        const center = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= iso;
        // 在外的角夹在它前后两条边之间；在里的角同理。
        const cut = (corner: number): void => {
          const before = (corner + 3) % 4; // 进这个角的边
          const after = corner; // 出这个角的边
          const bIsExit = kinds.find((k) => k.e === before)!.exit;
          if (bIsExit) link(after, before);
          else link(before, after);
        };
        for (let c = 0; c < 4; c++) if (corners[c] !== center) cut(c);
      }
    }
  const loops: number[][] = [];
  const used = new Set<number>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let k: number | undefined = start;
    while (k !== undefined && !used.has(k)) {
      used.add(k);
      const p = pts.get(k)!;
      loop.push(p[0], p[1]);
      k = next.get(k);
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}

/** 有向面积（见文件头）。 */
export function signedArea(loop: ArrayLike<number>): number {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[i * 2]! * loop[j * 2 + 1]! - loop[j * 2]! * loop[i * 2 + 1]!;
  }
  return a / 2;
}

export function pointInLoop(x: number, y: number, loop: ArrayLike<number>): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[i * 2]!;
    const yi = loop[i * 2 + 1]!;
    const xj = loop[j * 2]!;
    const yj = loop[j * 2 + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 把环分成外边界和洞：每个洞归到包住它的最小的外边界。 */
export function regions(loops: number[][]): Region[] {
  const outers: Array<Region & { area: number }> = [];
  const holes: number[][] = [];
  for (const l of loops) {
    const a = signedArea(l);
    if (a < 0) outers.push({ outer: l, holes: [], area: -a });
    else holes.push(l);
  }
  outers.sort((a, b) => a.area - b.area);
  for (const hole of holes) {
    const host = outers.find((o) => pointInLoop(hole[0]!, hole[1]!, o.outer));
    if (host) host.holes.push(hole);
  }
  return outers.map(({ outer, holes: hs }) => ({ outer, holes: hs }));
}

/** Chaikin 圆滑一遍（闭合环）。 */
export function chaikin(loop: number[]): number[] {
  const n = loop.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = loop[i * 2]!;
    const ay = loop[i * 2 + 1]!;
    const bx = loop[j * 2]!;
    const by = loop[j * 2 + 1]!;
    out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
  }
  return out;
}

/** 去掉太近的点（闭合环），min 是最小间距。 */
export function thin(loop: number[], min: number): number[] {
  const out: number[] = [loop[0]!, loop[1]!];
  for (let i = 2; i < loop.length; i += 2) {
    const lx = out[out.length - 2]!;
    const ly = out[out.length - 1]!;
    if (Math.hypot(loop[i]! - lx, loop[i + 1]! - ly) >= min) out.push(loop[i]!, loop[i + 1]!);
  }
  return out;
}
