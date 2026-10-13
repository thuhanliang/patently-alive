import type { IslandTerrain, WorldParams } from '../data/schema/world';
import type { Rng } from './rng';
import { valueNoise } from './noise';

/**
 * 地形类型（每格一个字节）。水不能住、不能走；海岸、草地、灌丛都是陆地。
 * 灌丛是地面筑巢鸟的掩护（阶段 1 第 2 步起用）。
 */
export const TERRAIN = { water: 0, coast: 1, grass: 2, shrub: 3 } as const;
export type TerrainType = (typeof TERRAIN)[keyof typeof TERRAIN];
export const TERRAIN_NAMES: Record<TerrainType, string> = { 0: '水', 1: '海岸', 2: '草地', 3: '灌丛' };

export function isLand(t: number): boolean {
  return t !== TERRAIN.water;
}

/**
 * 生成地形。没有 terrain 参数的世界整张都是草地，而且不抽随机数（阶段 0 的草原结果不变）。
 * 返回每格的地形和地形肥力系数（水为 0）。
 */
export function generateTerrain(
  world: WorldParams,
  rng: Rng,
): { terrain: Uint8Array; island: Uint8Array; fertilityBy: Float64Array } {
  const n = world.width * world.height;
  const t = world.terrain;
  if (!t) {
    return { terrain: new Uint8Array(n).fill(TERRAIN.grass), island: new Uint8Array(n).fill(1), fertilityBy: new Float64Array(n).fill(1) };
  }
  const terrain = islandTerrain(world.width, world.height, t, rng);
  const fertilityBy = new Float64Array(n);
  const factor = [0, t.fertilityBy.coast, t.fertilityBy.grass, t.fertilityBy.shrub];
  for (let i = 0; i < n; i++) fertilityBy[i] = factor[terrain[i]!]!;
  return { terrain, island: labelIslands(terrain, world.width, world.height), fertilityBy };
}

/**
 * 给每块陆地编号：0 是水，1 是最大的一块（主岛），2、3…… 是其余的岛，按面积从大到小、同样大按位置先后。
 * 四连通，和生成时一致。
 */
export function labelIslands(terrain: Uint8Array, width: number, height: number): Uint8Array {
  const comp = new Int32Array(terrain.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < terrain.length; start++) {
    if (terrain[start] === TERRAIN.water || comp[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    comp[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      size += 1;
      const x = i % width;
      const y = (i - x) / width;
      const around = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const j of around) {
        if (j >= 0 && terrain[j] !== TERRAIN.water && comp[j] === -1) {
          comp[j] = id;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  const order = sizes.map((_, k) => k).sort((a, b) => sizes[b]! - sizes[a]! || a - b);
  const rank = new Int32Array(sizes.length);
  order.forEach((k, r) => (rank[k] = r + 1));
  const out = new Uint8Array(terrain.length);
  for (let i = 0; i < out.length; i++) if (comp[i]! >= 0) out[i] = Math.min(255, rank[comp[i]!]!);
  return out;
}

function islandTerrain(width: number, height: number, t: IslandTerrain, rng: Rng): Uint8Array {
  const n = width * height;
  const land = new Uint8Array(n);

  // 主岛：到中心的距离 / 半径，加上海岸线噪声，小于 1 的是陆地。
  const radius = (t.mainRadius * Math.min(width, height)) / 2;
  const coastNoise = valueNoise(width, height, t.coastPatchSize, rng);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / radius;
      if (d + t.coastRoughness * (coastNoise[i]! - 0.5) * 2 < 1) land[i] = 1;
    }
  }
  // 噪声可能在近岸生出零碎的小块：只留最大的一块作主岛，小岛另外按间距放。
  keepLargestComponent(land, width, height);

  // 离岸小岛：在离现有陆地至少 minGapCells 格的水面上放圆形加噪声的小岛。
  const { islets } = t;
  for (let k = 0, tries = 0; k < islets.count && tries < 200; tries++) {
    const r = islets.minRadius + rng.nextInt(islets.maxRadius - islets.minRadius + 1);
    const x0 = r + rng.nextInt(Math.max(1, width - 2 * r));
    const y0 = r + rng.nextInt(Math.max(1, height - 2 * r));
    if (!clearOfLand(land, width, height, x0, y0, r + islets.minGapCells)) continue;
    for (let y = y0 - r; y <= y0 + r; y++) {
      for (let x = x0 - r; x <= x0 + r; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const d = Math.sqrt((x - x0) * (x - x0) + (y - y0) * (y - y0)) / r;
        if (d + 0.5 * t.coastRoughness * (coastNoise[y * width + x]! - 0.5) * 2 < 1) land[y * width + x] = 1;
      }
    }
    k += 1;
  }

  // 海岸：挨着水（含地图外）的陆地。灌丛：内陆里噪声最高的那一部分。
  const terrain = new Uint8Array(n);
  const shrubNoise = valueNoise(width, height, t.shrubPatchSize, rng);
  const interior: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!land[i]) continue;
      if (touchesWater(land, width, height, x, y)) terrain[i] = TERRAIN.coast;
      else {
        terrain[i] = TERRAIN.grass;
        interior.push(i);
      }
    }
  }
  if (interior.length > 0 && t.shrubFraction > 0) {
    // 按噪声排序取前 shrubFraction 的格子；同值按下标排，保证确定。
    interior.sort((a, b) => shrubNoise[b]! - shrubNoise[a]! || a - b);
    const m = Math.round(interior.length * t.shrubFraction);
    for (let k = 0; k < m; k++) terrain[interior[k]!] = TERRAIN.shrub;
  }
  return terrain;
}

function touchesWater(land: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !land[ny * width + nx]) return true;
    }
  }
  return false;
}

/** 以 (x0, y0) 为中心、半径 r 的圆里（含地图外的部分不算）没有陆地。 */
function clearOfLand(land: Uint8Array, width: number, height: number, x0: number, y0: number, r: number): boolean {
  for (let y = Math.max(0, y0 - r); y <= Math.min(height - 1, y0 + r); y++) {
    for (let x = Math.max(0, x0 - r); x <= Math.min(width - 1, x0 + r); x++) {
      if (land[y * width + x] && (x - x0) * (x - x0) + (y - y0) * (y - y0) <= r * r) return false;
    }
  }
  return true;
}

/** 只保留最大的一块四连通陆地，其余改成水。 */
function keepLargestComponent(land: Uint8Array, width: number, height: number): void {
  const label = new Int32Array(land.length).fill(-1);
  const stack: number[] = [];
  let best = -1;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < land.length; start++) {
    if (!land[start] || label[start] !== -1) continue;
    const id = next++;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop()!;
      size += 1;
      const x = i % width;
      const y = (i - x) / width;
      const around = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const j of around) {
        if (j >= 0 && land[j] && label[j] === -1) {
          label[j] = id;
          stack.push(j);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  for (let i = 0; i < land.length; i++) if (land[i] && label[i] !== best) land[i] = 0;
}

