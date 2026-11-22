import { Group } from 'three';
import { TERRAIN } from '../../sim/terrain';
import { buildFlora } from './flora';
import { plantMesh, type PlantSpot } from './plants';
import { fbm, levelTop, noise2, type ReliefField } from './relief';

/** 推演给画面的一座岛：每格的地形、草本和灌木的茂盛程度（0–1）。 */
export interface IslandInput {
  width: number;
  height: number;
  terrain: Uint8Array;
  herb?: ArrayLike<number>;
  shrub?: ArrayLike<number>;
  seed: number;
}

/**
 * 立着的剪纸植物（flora.ts 的图鉴）：每格按地形、茂盛程度撒，成片地长——
 * 一片草地里某一块是雏菊、旁边一块是毛茛，同一片花的颜色一样；海边是沙草、海石竹和石头；
 * 灌丛里是几种灌木，偶尔一棵矮松或小树；岛上水塘边长香蒲。
 * 每株落在它所在那层纸的顶面上，不放在两层纸的交界上。
 */
export function buildVegetation(f: ReliefField, inp: IslandInput): Group {
  const { width: W, height: H, terrain, seed } = inp;
  const flora = buildFlora(seed);
  let s = (seed * 2654435761) >>> 0;
  const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
  const spots = new Map<string, Array<{ x: number; y: number; z: number; h: number; flip: boolean; tone: number }>>();
  const ground = (x: number, z: number, margin: number): number | null => {
    const L = f.levelAt(x, z);
    if (L < 0) return null;
    for (const [dx, dz] of [[margin, 0], [-margin, 0], [0, margin], [0, -margin]] as const) if (f.levelAt(x + dx, z + dz) !== L) return null;
    return levelTop(L);
  };
  const put = (id: string, x: number, z: number, tone: number, scale = 1): void => {
    const k = flora.get(id)!;
    const h = (k.h[0] + rnd() * (k.h[1] - k.h[0])) * scale;
    const y = ground(x, z, Math.max(0.06, h * k.aspect * 0.35));
    if (y === null) return;
    let list = spots.get(id);
    if (!list) spots.set(id, (list = []));
    list.push({ x, y, z, h, flip: rnd() < 0.5, tone });
  };
  // 和外海不连通的水格：水塘。
  const inland = new Uint8Array(W * H);
  {
    const sea = new Uint8Array(W * H);
    const st: number[] = [];
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && terrain[i] === TERRAIN.water) (sea[i] = 1), st.push(i);
    }
    while (st.length) {
      const i = st.pop()!;
      const x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < W * H && terrain[j] === TERRAIN.water && !sea[j]) (sea[j] = 1), st.push(j);
    }
    for (let i = 0; i < W * H; i++) if (terrain[i] === TERRAIN.water && !sea[i]) inland[i] = 1;
  }
  const nearPond = (cx: number, cy: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inland[(cy + dy) * W + cx + dx]) return true;
    return false;
  };
  const FLOWERS = ['daisy', 'buttercup', 'clover'] as const;
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      const t = terrain[i]!;
      if (t === TERRAIN.water) continue;
      const herb = inp.herb ? Math.max(0, Math.min(1, inp.herb[i]!)) : 0.6;
      const shrub = inp.shrub ? Math.max(0, Math.min(1, inp.shrub[i]!)) : 0.7;
      const wx = cx - W / 2;
      const wz = cy - H / 2;
      const at = (): [number, number] => [wx + rnd(), wz + rnd()];
      // 成片：花的种类和颜色按一块块的噪声挑。
      const patch = fbm(wx * 0.11, wz * 0.11, seed + 201);
      const tall = fbm(wx * 0.17, wz * 0.17, seed + 211);
      const tone = Math.floor(noise2(wx * 0.25, wz * 0.25, seed + 223) * 3);
      if (nearPond(cx, cy)) for (let k = 0; k < 5; k++) put('cattail', ...at(), tone);
      if (t === TERRAIN.coast) {
        for (let k = 0; k < 4; k++) put('dunegrass', ...at(), tone);
        if (patch > 0.52) for (let k = 0; k < 3; k++) put('thrift', ...at(), tone);
        if (rnd() < 0.35) put('rock', ...at(), tone);
        continue;
      }
      const nGrass = t === TERRAIN.shrub ? 2 : Math.round(3 + herb * 7);
      for (let k = 0; k < nGrass; k++) put('grass', ...at(), tone);
      if (tall > 0.55) for (let k = 0; k < Math.round(1 + herb * 5); k++) put('tallgrass', ...at(), tone);
      if (t === TERRAIN.grass && patch > 0.42) {
        const kind = FLOWERS[Math.min(2, Math.floor(((patch - 0.42) / 0.3) * 3))]!;
        for (let k = 0; k < Math.round(1 + herb * 5); k++) put(kind, ...at(), tone);
      }
      if (t === TERRAIN.shrub) {
        const L = f.levelAt(wx + 0.5, wz + 0.5);
        const pick = noise2(wx * 0.3, wz * 0.3, seed + 233);
        const nBush = Math.round(1 + shrub * 2.5);
        for (let k = 0; k < nBush; k++) put(pick < 0.4 ? 'shrub' : pick < 0.65 ? 'berry' : 'gorse', ...at(), tone, 0.8 + shrub * 0.4);
        if (rnd() < 0.5) put('fern', ...at(), tone);
        if (L >= 3 && rnd() < 0.14) put(rnd() < 0.55 ? 'pine' : 'tree', ...at(), tone);
      }
    }
  const group = new Group();
  for (const [id, list] of spots) {
    const k = flora.get(id)!;
    for (const part of k.parts) {
      const ps: PlantSpot[] = list.map((p) => ({ x: p.x, y: p.y, z: p.z, w: p.h * k.aspect, h: p.h, flip: p.flip, color: part.colors[p.tone % part.colors.length]! }));
      group.add(plantMesh(part.geom, ps, k.sway * 4, 0.5));
    }
  }
  return group;
}
