import { Group } from 'three';
import { TERRAIN } from '../../sim/terrain';
import { buildFlora } from './flora';
import { plantMesh, type PlantSpot } from './plants';
import { fbm, levelTop, noise2, type ReliefField } from './relief';
import { floraSpecies, type FloraSpecies } from '../../data';
import { cutPlant, simplifyPlant } from '../flora/shapes';
import { floraFor, pickPlants, type Row } from '../flora/zone';
import { mergeSheets } from './flora';
import { Color } from 'three';

/** 推演给画面的一座岛：每格的地形、草本和灌木的茂盛程度（0–1）。 */
export interface IslandInput {
  width: number;
  height: number;
  terrain: Uint8Array;
  herb?: ArrayLike<number>;
  shrub?: ArrayLike<number>;
  seed: number;
  /** 游戏的月份（0 = 春季第一个月）：这个月开花、结果的画出花和果。不给就按第 3 个月。 */
  month?: number;
  /** 用原来的通用植物（雏菊、毛茛……），不用植物图鉴。车里托盘上的小模型还在用。 */
  generic?: boolean;
}

/**
 * 立着的剪纸植物（flora.ts 的图鉴）：每格按地形、茂盛程度撒，成片地长——
 * 一片草地里某一块是雏菊、旁边一块是毛茛，同一片花的颜色一样；海边是沙草、海石竹和石头；
 * 灌丛里是几种灌木，偶尔一棵矮松或小树；岛上水塘边长香蒲。
 * 每株落在它所在那层纸的顶面上，不放在两层纸的交界上。
 */
/** sparse：只要灌丛、树、花丛（桌上那件 A4 小模型用：草丛太小看不见，又最费三角形）。 */
export function buildVegetation(f: ReliefField, inp: IslandInput, sparse = false): Group {
  if (!inp.generic && !sparse) return buildFloraVegetation(f, inp);
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
    // 小模型：只要看得见的大东西（灌丛、树），而且稀一点。
    if (sparse && (!['shrub', 'berry', 'gorse', 'pine', 'tree'].includes(id) || rnd() < 0.55)) return;
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
      if (!sparse) for (let k = 0; k < nGrass; k++) put('grass', ...at(), tone);
      if (tall > 0.55 && !sparse) for (let k = 0; k < Math.round(1 + herb * 5); k++) put('tallgrass', ...at(), tone);
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
      group.add(plantMesh(part.geom, ps, k.sway * 4, 0.5, 0.03));
    }
  }
  return group;
}

/**
 * 植物图鉴（2026-11-28，整体回顾 A 段）：纸雕岛上长真实的植物（src/data/plants/flora.json），
 * 哪一格长哪几种按 flora/zone.ts（地带、灌丛和草本有多满、湿度），株数跟着生物量走，开花结果按月份。
 * 高度是压缩过的（真实 0.4–12 米 → 0.18–0.6 格），像桌上的模型：草矮、灌木中等、树高一点。
 */
function buildFloraVegetation(f: ReliefField, inp: IslandInput): Group {
  const { width: W, height: H, terrain, seed } = inp;
  const month = inp.month ?? 3;
  let s = (seed * 2654435761 + 7) >>> 0;
  const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
  // 离水几格（切比雪夫距离，最多 8）。
  const dist = new Int16Array(W * H).fill(99);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) if (terrain[i] === TERRAIN.water) (dist[i] = 0), queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % W;
    const y = (i / W) | 0;
    if (dist[i]! >= 8) continue;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (dist[j]! > dist[i]! + 1) (dist[j] = dist[i]! + 1), queue.push(j);
      }
  }
  // 每种植物剪两株（两个种子），归一到高 1；每张纸一种颜色。
  const byId = new Map(floraSpecies.map((sp) => [sp.id, sp]));
  const variants = new Map<string, Array<Array<{ geom: ReturnType<typeof mergeSheets>; color: number }>>>();
  const variantsOf = (sp: FloraSpecies): Array<Array<{ geom: ReturnType<typeof mergeSheets>; color: number }>> => {
    let v = variants.get(sp.id);
    if (v) return v;
    const flower = sp.flowerMonths.includes(month) ? 1 : 0;
    const fruit = sp.fruitMonths.includes(month) ? 1 : 0;
    v = [1, 2].map((k) => {
      // 岛上远看：叶片留一半、轮廓隔点取，三角形少很多（图鉴页和近景用完整的）。
      const cut = simplifyPlant(cutPlant(sp.look, seed * 31 + k * 977 + sp.id.length, flower, fruit), 0.5, 2);
      const h = Math.max(0.05, cut.height);
      return cut.sheets.map((sh, i) => ({ geom: mergeSheets(sh.polys.map((p) => p.map((x) => x / h)), PAPER_T, i * PAPER_T * 1.05), color: new Color(sh.color).getHex() }));
    });
    variants.set(sp.id, v);
    return v;
  };
  const heightOf = (sp: FloraSpecies): number => 0.14 + 0.18 * Math.log(1 + sp.look.height);
  const spots = new Map<string, Array<{ x: number; y: number; z: number; h: number; flip: boolean; v: number }>>();
  const ground = (x: number, z: number, margin: number): number | null => {
    const L = f.levelAt(x, z);
    if (L < 0) return null;
    for (const [dx, dz] of [[margin, 0], [-margin, 0], [0, margin], [0, -margin]] as const) if (f.levelAt(x + dx, z + dz) !== L) return null;
    return levelTop(L);
  };
  // 总株数有上限：大岛（鸟岛 128×128）每格少撒一些，不然几万株、几千万个三角形。
  let land = 0;
  for (let i = 0; i < W * H; i++) if (terrain[i] !== TERRAIN.water) land++;
  const budget = Math.min(1, 9000 / Math.max(1, land * 4));
  const ROWS: Array<[Row, number]> = [
    ['near', 4],
    ['mid', 2],
    ['far', 1],
  ];
  for (let cy = 0; cy < H; cy++)
    for (let cx = 0; cx < W; cx++) {
      const i = cy * W + cx;
      const t = terrain[i]!;
      if (t === TERRAIN.water) continue;
      const herb = inp.herb ? Math.max(0, Math.min(1, inp.herb[i]!)) : 0.6;
      const woody = inp.shrub ? Math.max(0, Math.min(1, inp.shrub[i]!)) : 0.5;
      const wx = cx - W / 2;
      const wz = cy - H / 2;
      const wet = fbm(wx * 0.12, wz * 0.12, seed + 401);
      // 海岸是沙岸还是岩岸：沿岸成段（平滑噪声），不是一格一变。
      const sandy = noise2(wx * 0.08, wz * 0.08, seed + 409) < 0.5;
      const site = { terrain: t === TERRAIN.coast ? 'coast' : t === TERRAIN.shrub ? 'shrub' : 'grass', coastDist: dist[i]!, woody, herb, wet, seed: sandy ? 10 : 60 } as const;
      const picks = floraFor(site);
      for (const [row, base] of ROWS) {
        // 株数跟着生物量走：近排看草本，中排、远排看灌丛。
        const amount = row === 'near' ? 0.2 + herb : row === 'mid' ? 0.3 + woody : woody > 0.5 ? woody : 0;
        let n = Math.floor(base * amount * budget + rnd());
        if (row === 'far' && rnd() > 0.35) n = 0;
        for (const p of pickPlants(picks, row, n, i * 3 + (row === 'near' ? 0 : row === 'mid' ? 1 : 2))) {
          const sp = byId.get(p.id);
          if (!sp) continue;
          const h = heightOf(sp) * p.height * (0.8 + rnd() * 0.4);
          const x = wx + rnd();
          const z = wz + rnd();
          const y = ground(x, z, Math.max(0.05, h * sp.look.aspect * 0.3));
          if (y === null) continue;
          let list = spots.get(sp.id);
          if (!list) spots.set(sp.id, (list = []));
          list.push({ x, y, z, h, flip: rnd() < 0.5, v: rnd() < 0.5 ? 0 : 1 });
        }
      }
    }
  const group = new Group();
  for (const [id, list] of spots) {
    const sp = byId.get(id)!;
    const vs = variantsOf(sp);
    const sway = ['tussock', 'sedge', 'pasture', 'reed', 'spinifex', 'fan'].includes(sp.look.form) ? 0.2 : 0.06;
    vs.forEach((parts, vi) => {
      const mine = list.filter((p) => p.v === vi);
      if (mine.length === 0) return;
      for (const part of parts) {
        const ps: PlantSpot[] = mine.map((p) => ({ x: p.x, y: p.y, z: p.z, w: p.h, h: p.h, flip: p.flip, color: part.color }));
        group.add(plantMesh(part.geom, ps, sway, 0.5, 0.03));
      }
    });
  }
  return group;
}

const PAPER_T = 0.016;
