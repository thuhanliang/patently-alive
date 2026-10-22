import { Application, Assets, BlurFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { scenarioLibrary, speciesFor, worldFor } from '../../data';
import { Sim, TICKS_PER_DAY, countAt, herbIndex, woodyIndex } from '../../sim';
import { TERRAIN } from '../../sim/terrain';
import { anchor, tiltFor, unprojectGround, type Cam } from './camera';
import { LeafKit, applyCarpet, bakeShrub, bakeTussock, paveGround } from './leaves';
import { fbm, hash2 } from './noise';
import { LEVELS, LEVEL_H, Terraces } from './terraces';
import { PX, buildFields, imagePaper, paintTerrain, proceduralPaper, sample, type Palette, type PaperTex } from './terrain';
import { clusterTokens, drawPuppet, tokenLengthCells, type PuppetKind, type Token } from './tokens';

/**
 * 剪纸风格 demo（M0 · V2 的第一块）：用真实推演出来的鸟岛，按剪纸方式画地形、植被、代表单位、干预标记和界面。
 * 独立页面，只读推演，不接操作。素材来自 Lovart（art/incoming/lovart/paper/），缺的部分用代码画占位。
 * 参数：?seed=1&days=40&view=region|island|close&mode=leaves|stickers&terraces=1|0&tilt=1|0
 * - mode=leaves（默认）：草丛、灌丛、地面碎叶都由 P8 叶片在代码里拼（leaves.ts）；
 *   mode=stickers：草丛、灌丛用 P1、P2 整张贴纸（第一版，留作对照）；
 * - terraces：装饰性的地形台阶（terraces.ts），推演里没有高程；
 * - tilt：随缩放变化的倾斜镜头（camera.ts），拉远俯视、拉近斜看。
 */

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);
const DAYS = Number(params.get('days') ?? 40);
const LEAVES = params.get('mode') !== 'stickers';
const TERRACES = params.get('terraces') !== '0';
const TILT = params.get('tilt') !== '0';

type Sheet = { rows: number[][][]; tex: Texture[][] };

async function loadSheet(name: string): Promise<Sheet | null> {
  try {
    const res = await fetch(`proto/paper/${name}/manifest.json`);
    if (!res.ok) return null;
    const rows = (await res.json()) as number[][][];
    const tex = await Promise.all(rows.map((row, r) => Promise.all(row.map((_, c) => Assets.load<Texture>(`proto/paper/${name}/${r}_${c}.png`)))));
    return { rows, tex };
  } catch {
    return null;
  }
}

type Img = CanvasImageSource & { width: number; height: number };
const imageOf = (t: Texture): Img => t.source.resource as Img;

/** P4 纸纹（3×3）：有就用真图，没有就用代码生成的纸。顺序见提示词：深海、中海、浅海、浪花、卵石滩、沙、草地、灌丛、牛皮纸。 */
async function loadPalette(): Promise<Palette> {
  const colors = [0x1f5d7a, 0x2f89b4, 0x7cc0b0, 0xefe9dc, 0x9b8a7a, 0xe5bb80, 0x9cb052, 0x5c7639, 0xc99460];
  const p4 = await loadSheet('P4');
  const texs: PaperTex[] = colors.map((hex, i) => {
    const t = p4?.tex[Math.floor(i / 3)]?.[i % 3];
    if (!t) return proceduralPaper(hex, 100 + i);
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d')!;
    // 四边各裁掉一点，去掉切图时残留的品红边。
    const inset = 8;
    ctx.drawImage(imageOf(t), inset, inset, t.width - 2 * inset, t.height - 2 * inset, 0, 0, size, size);
    return imagePaper(ctx.getImageData(0, 0, size, size).data, size);
  });
  return {
    deep: texs[0]!,
    mid: texs[1]!,
    shallow: texs[2]!,
    foam: texs[3]!,
    beach: texs[4]!,
    grass: texs[6]!,
    shrub: texs[7]!,
    dry: proceduralPaper(0xc7b26c, 120),
    rim: proceduralPaper(0xf7f2e6, 121),
  };
}

/** P7 里每种木偶在第几行，以及代表单位可以随机用的姿势（列）。 */
const P7_ROW: Partial<Record<PuppetKind, number>> = { 'cat-orange': 0, 'cat-piebald': 1, bird: 2, rabbit: 3, rat: 4 };
const P7_POSES: Partial<Record<PuppetKind, number[]>> = {
  'cat-orange': [0, 1, 2, 3, 4],
  'cat-piebald': [0, 1, 2, 3, 4],
  bird: [0, 3],
  rabbit: [0, 1, 2, 3, 4],
  rat: [0, 1, 2, 3, 4],
};
const si = (id: string): number => [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 1000;
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 屏幕四角压暗一点、偏暖：把整张图收成一个画面，而不是一块块素材。 */
function vignette(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 118, 70, 128, 128, 190);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(120,88,56,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}

async function main(): Promise<void> {
  const status = document.getElementById('status')!;
  status.textContent = `推演 ${DAYS} 天……`;
  await tick();
  const timing: string[] = [];
  const timed = <T,>(label: string, f: () => T): T => {
    const t0 = performance.now();
    const v = f();
    timing.push(`${label} ${Math.round(performance.now() - t0)}`);
    return v;
  };

  // ---- 推演（只读用） ----
  const scenario = scenarioLibrary.get('bird-island')!;
  const world = worldFor(scenario);
  const sim = Sim.create({ seed: SEED, world, species: speciesFor(world) });
  sim.stepN(DAYS * TICKS_PER_DAY);
  const st = sim.state;
  const grid = st.grid;
  const { width: w, height: h } = grid;
  const herbI = herbIndex(world);
  const woodyI = woodyIndex(world);
  const herbMax = world.plants[herbI]!.maxBiomass;
  const herb = new Float32Array(w * h);
  const shrub = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    herb[i] = Math.min(1, grid.plants[herbI]![i]! / herbMax);
    if (woodyI >= 0) shrub[i] = Math.min(1, grid.plants[woodyI]![i]! / world.plants[woodyI]!.maxBiomass);
  }

  // ---- 素材 ----
  status.textContent = '载入素材……';
  const [P1, P2, P3, P6, P7, P8] = await Promise.all(['P1', 'P2', 'P3', 'P6', 'P7', 'P8'].map(loadSheet));
  const pal = await loadPalette();
  const kit = LEAVES && P8 ? new LeafKit(P8.tex.map((row) => row.map(imageOf))) : null;

  // ---- 地形：纸层 → 地面铺叶 → 台阶 ----
  status.textContent = '画地形……';
  await tick();
  const fields = buildFields({ width: w, height: h, terrain: grid.terrain, herb, shrub });
  const painted = timed('地形', () => paintTerrain(fields, pal, SEED));
  const W = painted.width;
  const H = painted.height;
  const img = new ImageData(painted.data, W, H);
  if (kit) {
    // 和地形绘制用同一个低频扭曲判断这个像素落在哪层纸上，撕边附近留空。
    const carpet = timed('铺叶', () =>
      paveGround(
        kit,
        W,
        H,
        (px, py) => {
          const u = (px + 0.5) / PX - 0.5;
          const v = (py + 0.5) / PX - 0.5;
          const warp = (fbm(px / (PX * 5), py / (PX * 5), SEED) - 0.5) * 1.6;
          if (sample(fields.sd, w, h, u, v) + warp < 0.5) return null;
          const g = sample(fields.grass, w, h, u, v) + warp * 0.12;
          if (g > 0.62) return sample(fields.shrubLand, w, h, u, v) + warp * 0.12 > 0.5 ? 'shrub' : 'grass';
          if (g < 0.38) return 'pebble';
          return null;
        },
        SEED + 50,
      ),
    );
    applyCarpet(img, carpet);
  }
  const terr = TERRACES ? new Terraces(fields, SEED, W, H) : null;
  const layers = terr ? timed('台阶', () => terr.split(img, pal.beach)) : null;
  const baseCv = document.createElement('canvas');
  baseCv.width = W;
  baseCv.height = H;
  baseCv.getContext('2d')!.putImageData(img, 0, 0);
  let texBytes = W * H * 4;

  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1f5d7a, antialias: true });
  document.body.appendChild(app.canvas);
  status.textContent = '';

  // 场景：root 下面两层。ground 是地面（竖直压扁 cos t），bill 是立起来的纸片（不压扁）。
  const root = new Container();
  app.stage.addChild(root);
  const ground = new Container();
  const bill = new Container();
  bill.sortableChildren = true;
  root.addChild(ground, bill);
  ground.addChild(new Sprite(Texture.from(baseCv)));

  /** 台阶：每层一张顶面、SIDE_COPIES 张侧面（同一个剪影往下叠，越往下越暗；每隔几张亮一点，像一层层纸板的边）。 */
  const SIDE_COPIES = 12;
  const levelNodes: { top: Sprite; sides: Sprite[]; y: number; k: number }[] = [];
  layers?.tops.forEach((top, k) => {
    const side = layers.sides[k]!;
    const sideTex = Texture.from(side.canvas);
    const sides = Array.from({ length: SIDE_COPIES }, (_, j) => {
      const s = new Sprite(sideTex);
      s.x = side.x;
      const f = j / (SIDE_COPIES - 1);
      const g = Math.min(1, 0.46 + 0.42 * f + (j % 4 === 3 ? 0.1 : 0));
      s.tint = (Math.round(g * 255) << 16) | (Math.round(g * 0.96 * 255) << 8) | Math.round(g * 0.9 * 255);
      ground.addChild(s);
      return s;
    });
    const t = new Sprite(Texture.from(top.canvas));
    t.x = top.x;
    ground.addChild(t);
    levelNodes.push({ top: t, sides, y: top.y, k });
    texBytes += (top.canvas.width * top.canvas.height + side.canvas.width * side.canvas.height) * 4;
  });

  const shadows = new Container();
  shadows.filters = [new BlurFilter({ strength: 3, quality: 2 })];
  shadows.alpha = 0.32;
  ground.addChild(shadows);

  // 立起来的东西和地上的投影都按地面坐标登记，镜头一变就统一重排。
  const zAt = (x: number, y: number): number => (terr ? terr.levelAt(x, y) * LEVEL_H : 0);
  type Bill = { obj: Container; x: number; y: number; z: number; bias: number };
  const bills: Bill[] = [];
  const shads: { obj: Container; y: number; z: number }[] = [];
  const relayouts: (() => void)[] = [];
  const place = (obj: Container, x: number, y: number, bias = 0): Bill => {
    const b = { obj, x, y, z: zAt(x, y), bias };
    bills.push(b);
    bill.addChild(obj);
    return b;
  };
  const shadowAt = (obj: Container, x: number, y: number, z: number): void => {
    obj.x = x;
    shads.push({ obj, y, z });
    shadows.addChild(obj);
  };
  /** 代表单位和数量签：拉远时反向放大，像地图图标一样保持能看清的大小。 */
  const iconScaled: Container[] = [];

  const rnd = (x: number, y: number, k: number): number => hash2(x * 7 + k, y * 13 - k, SEED + 1000);
  const sdAt = (x: number, y: number): number => fields.sd[y * w + x]!;

  /** 贴一张立起来的纸片：底边中点在 (cx, cy) 像素处，宽 widthPx。投影是同一张图压扁、往右下偏，贴在地上。 */
  const stick = (tex: Texture, cx: number, cy: number, widthPx: number, flip = false, bias = 0, shade = 1): Sprite => {
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    if (shade !== 1) {
      const g = Math.round(Math.min(1, shade) * 255);
      s.tint = (g << 16) | (g << 8) | Math.round(g * 0.97);
    }
    const k = widthPx / tex.width;
    s.scale.set(flip ? -k : k, k);
    const b = place(s, cx, cy, bias);
    const sh = new Sprite(tex);
    sh.anchor.set(0.5, 1);
    sh.tint = 0x241a10;
    sh.scale.set(flip ? -k : k, k * 0.55);
    sh.skew.x = -0.6;
    shadowAt(sh, cx + widthPx * 0.08, cy + 2, b.z);
    return s;
  };
  const pick = (sheet: Sheet | null | undefined, rows: number[], r: number): Texture | null => {
    if (!sheet) return null;
    const row = rows[Math.floor(r * rows.length) % rows.length]!;
    const list = sheet.tex[row]!;
    return list[Math.floor((r * 997) % 1 * list.length)] ?? list[0]!;
  };

  // ---- 叶片拼出来的植被：启动时烤好若干变体，按植被量挑最近的一档 ----
  const LV = [0.15, 0.4, 0.7, 1];
  const DRY = [0, 0.5, 1];
  const VAR = 3;
  const BAKE = 96;
  const tussocks: Texture[][][] = [];
  const flowers: Texture[] = [];
  const shrubs: Texture[][] = [];
  const fromCanvas = (c: HTMLCanvasElement): Texture => {
    texBytes += c.width * c.height * 4;
    return Texture.from(c);
  };
  if (kit)
    timed('烤植被', () => {
      LV.forEach((b, bi) => {
        tussocks[bi] = DRY.map((d, di) => Array.from({ length: VAR }, (_, v) => fromCanvas(bakeTussock(kit, b, d, SEED * 97 + bi * 31 + di * 7 + v, BAKE))));
        shrubs[bi] = Array.from({ length: VAR + 1 }, (_, v) => fromCanvas(bakeShrub(kit, b, SEED * 89 + bi * 13 + v, BAKE)));
      });
      for (let v = 0; v < VAR; v++) flowers.push(fromCanvas(bakeTussock(kit, 0.8, 0, SEED * 71 + v, BAKE, true)));
    });
  const level = (x: number): number => LV.reduce((best, l, i) => (Math.abs(l - x) < Math.abs(LV[best]! - x) ? i : best), 0);
  const choose = <T,>(list: T[], r: number): T => list[Math.floor(r * list.length) % list.length]!;

  // ---- 植被和岩石（按格子撒，同一个种子位置固定） ----
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = grid.terrain[i]!;
      const r1 = rnd(x, y, 1);
      const r2 = rnd(x, y, 2);
      const jx = (x + 0.15 + 0.7 * rnd(x, y, 3)) * PX;
      const jy = (y + 0.3 + 0.7 * rnd(x, y, 4)) * PX;
      const flip = rnd(x, y, 5) < 0.5;
      if (kit && t === TERRAIN.shrub) {
        const a = shrub[i]!;
        // 每丛明暗略有不同，免得一片灌丛像同一个图章盖出来的。
        if (r1 < 0.26 + 0.3 * a) stick(choose(shrubs[level(a)]!, r2), jx, jy, PX * (1.3 + 1.4 * rnd(x, y, 6) ** 2), flip, 0, 0.84 + 0.16 * rnd(x, y, 8));
      } else if (kit && t === TERRAIN.grass) {
        const b = herb[i]!;
        // 被啃得越狠，草丛越稀、越枯；草丛成片长（低频噪声），不是均匀撒。
        const dry = Math.min(1, Math.max(0, (0.65 - b) / 0.5));
        const clump = Math.min(1, Math.max(0, (fbm(x / 7, y / 7, SEED + 77) - 0.42) / 0.25));
        if (r1 < (0.03 + 0.2 * clump) * (0.4 + 0.6 * b)) {
          const tex = b > 0.5 && r2 < 0.1 ? choose(flowers, rnd(x, y, 7)) : choose(tussocks[level(b)]![Math.round(dry * 2)]!, rnd(x, y, 7));
          stick(tex, jx, jy, PX * (1.8 + 1.4 * rnd(x, y, 6)), flip, 0, 0.88 + 0.12 * rnd(x, y, 8));
        } else if (r1 > 0.985 && sdAt(x, y) < 6) {
          const tex = pick(P3, [3], r2);
          if (tex) stick(tex, jx, jy, PX * (1.2 + 0.5 * rnd(x, y, 6)), flip);
        }
      } else if (t === TERRAIN.shrub) {
        const a = shrub[i]!;
        if (r1 < 0.22 + 0.25 * a) {
          const rows = a > 0.55 ? [0, 1, 2] : a > 0.25 ? [4] : [5];
          const tex = pick(P2, rows, r2);
          if (tex) stick(tex, jx, jy, PX * (1.7 + 0.6 * rnd(x, y, 6)), flip);
        }
      } else if (t === TERRAIN.grass) {
        const b = herb[i]!;
        if (r1 < 0.075) {
          const rows = b > 0.5 ? (r2 < 0.12 ? [3] : [0, 1]) : b > 0.25 ? [2] : [4];
          const tex = pick(P1, rows, rnd(x, y, 7));
          if (tex) stick(tex, jx, jy, PX * (1.1 + 0.5 * rnd(x, y, 6)), flip);
        } else if (r1 < 0.095 && sdAt(x, y) < 6) {
          const tex = pick(P3, [3], r2);
          if (tex) stick(tex, jx, jy, PX * (1.2 + 0.5 * rnd(x, y, 6)), flip);
        }
      } else if (t === TERRAIN.coast) {
        if (r1 < 0.05) {
          const tex = pick(P3, [0, 1], r2);
          if (tex) stick(tex, jx, jy, PX * (1.2 + 0.9 * rnd(x, y, 6)), flip);
        } else if (r1 < 0.11) {
          const tex = pick(P3, [2], r2);
          if (tex) stick(tex, jx, jy, PX * (0.9 + 0.4 * rnd(x, y, 6)), flip);
        } else if (r1 < 0.13) {
          const tex = pick(P3, [4], r2);
          if (tex) stick(tex, jx, jy, PX * (0.9 + 0.4 * rnd(x, y, 6)), flip);
        }
      } else {
        const d = sdAt(x, y);
        if (d > -2.2 && d < -0.9 && r1 < 0.03) {
          const tex = r2 < 0.5 ? pick(P3, [5], rnd(x, y, 8) * 0.83) : P3?.tex[4]?.[r2 < 0.75 ? 1 : 4] ?? null;
          if (tex) stick(tex, jx, jy, PX * (1.1 + 0.6 * rnd(x, y, 6)), flip);
        }
      }
    }

  // ---- 代表单位 ----
  const isLand = (i: number): boolean => grid.terrain[i] !== TERRAIN.water;
  const tokenInfo: { id: string; kind: PuppetKind; tokens: Token[]; len: number }[] = [];
  sim.species.forEach((sp, spI) => {
    const pop = st.populations[spI]!;
    const counts = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) counts[i] = countAt(pop, i);
    const id = sp.params.id;
    const kind: PuppetKind = id === 'cat' ? 'cat-orange' : id === 'dotterel' ? 'bird' : id === 'rabbit' ? 'rabbit' : id === 'rat' ? 'rat' : 'generic';
    tokenInfo.push({ id, kind, tokens: clusterTokens(counts, w, h, isLand), len: tokenLengthCells(sp.params.bodyMassKg) * PX });
  });
  // 不同物种的代表挨得太近时往外推一点，免得叠在一起。
  const all = tokenInfo.flatMap((s) => s.tokens);
  for (let it = 0; it < 40; it++)
    for (const a of all)
      for (const b of all) {
        if (a === b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < 7 && d > 0) {
          a.x += (dx / d) * 0.3;
          a.y += (dy / d) * 0.3;
        } else if (d === 0) a.x += 0.5;
      }

  const tagTex = P6?.tex[4]?.[3] ?? null;
  const nestTex = P6?.tex[0] ?? null;
  tokenInfo.forEach(({ id, kind, tokens, len }) => {
    tokens.forEach((tk, j) => {
      const cx = (tk.x + 0.5) * PX;
      const cy = (tk.y + 0.5) * PX;
      const k: PuppetKind = id === 'cat' && j % 2 === 1 ? 'cat-piebald' : kind;
      const unit = new Container();
      const flip = j % 3 === 2 && id !== 'dotterel';
      // P7 整只剪纸：每个物种一行五个姿势；同一物种按站姿（第 0 个）统一缩放，换姿势大小不变。
      // 按剪纸面积的平方根缩放，而不是按宽度：长尾巴、长耳朵不会让一个物种显得更小或更大。
      const rowI = P7_ROW[k] ?? -1;
      const row = P7?.tex[rowI];
      if (row) {
        const poses = P7_POSES[k]!;
        // 鸟：偶数个代表趴在巢里（P7 自带巢），其余站在巢边。
        const pose = id === 'dotterel' ? (j % 2 === 0 ? 3 : 0) : poses[Math.floor(rnd(j, si(id), 9) * poses.length)]!;
        if (id === 'dotterel' && pose !== 3 && nestTex) stick(nestTex[1 + (j % 3 === 1 ? 1 : 0)]!, cx - len * 0.45, cy + len * 0.05, len * 0.8, false, -len * 0.05 - 1);
        const area = P7!.rows[rowI]![0]![2] ?? (row[0]!.width / 1.65) ** 2;
        const kk = (len * 0.79) / Math.sqrt(area);
        const spr = new Sprite(row[pose]!);
        spr.anchor.set(0.5, 1);
        spr.scale.set(flip ? -kk : kk, kk);
        unit.addChild(spr);
      } else {
        if (id === 'dotterel' && nestTex) stick(nestTex[1 + (j % 2)]!, cx - len * 0.05, cy + len * 0.15, len * 0.95, false, -len * 0.15 - 1);
        const pup = drawPuppet(k, len);
        if (flip) pup.scale.x = -1;
        unit.addChild(pup);
      }
      const b = place(unit, cx, cy, 0.5);
      iconScaled.push(unit);
      shadowAt(new Graphics().ellipse(0, 0, len * 0.42, len * 0.1).fill(0x241a10), cx + len * 0.06, cy + 1, b.z);
      // 数量签
      const tag = new Container();
      const label = new Text({
        text: `×${tk.count.toLocaleString('zh-CN')}`,
        style: { fontFamily: 'Georgia, "Songti SC", "Noto Serif SC", serif', fontSize: 30, fill: 0x4a3a28, fontWeight: '600' },
        resolution: 2,
      });
      label.anchor.set(0.5);
      const tw = label.width + 34;
      if (tagTex) {
        const bg = new Sprite(tagTex);
        bg.anchor.set(0.5);
        bg.width = tw;
        bg.height = 50;
        tag.addChild(bg);
      } else tag.addChild(new Graphics().roundRect(-tw / 2, -25, tw, 50, 6).fill(0xf0e2c4));
      tag.addChild(label);
      tag.scale.set((PX * 1.3) / 50);
      // 签挂在动物右上方，和单位一起缩放。
      tag.position.set(len * 0.45 + (tw * tag.scale.x) / 2, -len * 0.8);
      unit.addChild(tag);
    });
  });

  // ---- 干预标记（静态示意）和一处警报 ----
  const landNear = (x0: number, y0: number, dx: number, dy: number): [number, number] => {
    for (let s = 0; s < 30; s++) {
      const x = Math.round(x0 + dx * s);
      const y = Math.round(y0 + dy * s);
      if (x >= 0 && y >= 0 && x < w && y < h && grid.terrain[y * w + x] === TERRAIN.grass) return [x, y];
    }
    return [Math.round(x0), Math.round(y0)];
  };
  // 区域视图的焦点：第一只猫的代表；标记都放在离焦点最近的各物种代表旁边。
  const focus = tokenInfo.find((s) => s.id === 'cat')?.tokens[0] ?? { x: w / 2, y: h / 2, count: 0 };
  const tokensOf = (id: string): Token[] =>
    [...(tokenInfo.find((s) => s.id === id)?.tokens ?? [])].sort(
      (a, b) => Math.hypot(a.x - focus.x, a.y - focus.y) - Math.hypot(b.x - focus.x, b.y - focus.y),
    );
  const blue = P6?.tex[1] ?? null;
  const red = P6?.tex[2] ?? null;
  const cat = tokensOf('cat')[0];
  if (cat && blue) {
    const [tx, ty] = landNear(cat.x + 5, cat.y + 3, 1, 0);
    stick(blue[0]!, (tx + 0.5) * PX, (ty + 0.5) * PX, PX * 1.7);
  }
  if (blue) {
    const [bx, by] = landNear(focus.x - 7, focus.y - 2, -1, 0);
    stick(blue[1]!, (bx + 0.5) * PX, (by + 0.5) * PX, PX * 1.3);
  }
  if (blue) {
    const [sx, sy] = landNear(focus.x - 1, focus.y - 6, 0, -1);
    const ring = stick(blue[2]!, (sx + 0.5) * PX, (sy + 0.5) * PX, PX * 1.3);
    ring.scale.y *= 0.6; // 圆环平放在地上
  }
  const nearBirds = tokensOf('dotterel');
  const bird = nearBirds[0];
  if (bird && blue) {
    // 围栏：5 根木桩，蓝绳在桩顶之间微微下垂；镜头倾斜时按桩的新位置重画。
    const posts: Bill[] = [];
    const postH = PX * 1.5;
    for (let k = 0; k < 5; k++) {
      stick(blue[3]!, (bird.x + 4 + k * 2.2) * PX, (bird.y - 3 + k * 1.1) * PX, PX * 0.45);
      posts.push(bills[bills.length - 1]!);
    }
    const rope = new Graphics();
    bill.addChild(rope);
    relayouts.push(() => {
      rope.clear();
      for (let k = 0; k < posts.length - 1; k++) {
        const a = posts[k]!.obj;
        const b = posts[k + 1]!.obj;
        rope.moveTo(a.x, a.y - postH * 0.85).quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - postH * 0.55, b.x, b.y - postH * 0.85);
      }
      rope.stroke({ width: 3, color: 0x2f6fd0 });
      rope.zIndex = posts[2]!.obj.y + 0.1;
    });
  }
  const victim = nearBirds[0];
  if (victim && red && nestTex) {
    // 警报：离焦点最近的鸟群附近，一个被毁的巢。
    const [ax, ay] = landNear(victim.x - 5, victim.y + 6, 1, 0);
    const cx = (ax + 0.5) * PX;
    const cy = (ay + 0.5) * PX;
    const burstBox = new Container();
    const burst = new Sprite(red[0]!);
    burst.anchor.set(0.5);
    burst.width = burst.height = PX * 4.2;
    burst.y = -PX * 0.5;
    burstBox.addChild(burst);
    place(burstBox, cx, cy, -2);
    stick(nestTex[4]!, cx, cy + PX * 0.3, PX * 1.9);
    const bangBox = new Container();
    const bang = new Sprite(red[3]!);
    bang.anchor.set(0.5, 1);
    bang.scale.set((PX * 2.6) / bang.height);
    bang.y = -PX * 2.9;
    bangBox.addChild(bang);
    place(bangBox, cx, cy, 1e6);
  }

  // ---- 整体调子：暗角 ----
  const vig = new Sprite(Texture.from(vignette()));
  vig.blendMode = 'multiply';
  app.stage.addChild(vig);

  // ---- 界面（贴在屏幕边缘的纸签） ----
  const hud = new Container();
  app.stage.addChild(hud);
  const strip = (row: number, col: number, width: number, height: number): Container => {
    const c = new Container();
    const t = P6?.tex[4]?.[col];
    if (t && row === 4) {
      const s = new Sprite(t);
      s.width = width;
      s.height = height;
      c.addChild(s);
    } else c.addChild(new Graphics().rect(0, 0, width, height).fill(0xe9d2a8));
    const sh = new Graphics().rect(6, 8, width, height).fill({ color: 0x000000, alpha: 0.18 });
    c.addChildAt(sh, 0);
    return c;
  };
  const font = { fontFamily: '"Songti SC", "Noto Serif SC", "WenQuanYi Zen Hei", serif', fill: 0x4a3a28 } as const;
  const day = sim.day;
  const dateBox = strip(4, 0, 300, 64);
  const dateText = new Text({ text: `第 ${day + 1} 天 ｜ 春季`, style: { ...font, fontSize: 28 }, resolution: 2 });
  dateText.position.set(26, 14);
  dateBox.addChild(dateText);
  hud.addChild(dateBox);

  const speedBox = strip(4, 2, 300, 64);
  ['Ⅱ', '1×', '2×', '4×'].forEach((label, i) => {
    const x = 42 + i * 66;
    if (i === 1) speedBox.addChild(new Graphics().circle(x, 32, 22).fill(0x2f6fd0));
    else speedBox.addChild(new Graphics().circle(x, 32, 22).stroke({ width: 2, color: 0x8a7458 }));
    const t = new Text({ text: label, style: { ...font, fontSize: 20, fill: i === 1 ? 0xffffff : 0x4a3a28 }, resolution: 2 });
    t.anchor.set(0.5);
    t.position.set(x, 32);
    speedBox.addChild(t);
  });
  hud.addChild(speedBox);

  const tools: [string, Texture | null | undefined][] = [
    ['陷阱', blue?.[0]],
    ['诱饵', blue?.[1]],
    ['采样', blue?.[2]],
    ['围栏', blue?.[3]],
    ['档案', P6?.tex[3]?.[0]],
    ['设计台', P6?.tex[3]?.[2]],
  ];
  const bar = strip(4, 2, tools.length * 96 + 24, 104);
  tools.forEach(([label, tex], i) => {
    const x = 60 + i * 96;
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.scale.set(Math.min(46 / s.width, 46 / s.height));
      s.position.set(x, 40);
      bar.addChild(s);
    }
    const t = new Text({ text: label, style: { ...font, fontSize: 18 }, resolution: 2 });
    t.anchor.set(0.5);
    t.position.set(x, 82);
    bar.addChild(t);
    if (i < tools.length - 1) bar.addChild(new Graphics().rect(x + 47, 18, 1.5, 70).fill(0xb49a74));
  });
  hud.addChild(bar);

  const layoutHud = (): void => {
    const SW = app.screen.width;
    const SH = app.screen.height;
    dateBox.position.set(20, 18);
    speedBox.position.set(SW - 320, 18);
    bar.position.set((SW - bar.width) / 2, SH - 124);
    vig.width = SW;
    vig.height = SH;
  };

  // ---- 镜头：1 全岛、2 区域、3 近景；滚轮缩放（越近越斜）、拖动平移 ----
  const cam: Cam = { s: 1, t: 0, ox: 0, oy: 0 };
  let laidT = -1;
  const layout = (): void => {
    root.position.set(cam.ox, cam.oy);
    ground.scale.set(cam.s, cam.s * Math.cos(cam.t));
    bill.scale.set(cam.s);
    const k = Math.max(1, 0.95 / cam.s);
    for (const u of iconScaled) u.scale.set(k);
    if (cam.t === laidT) return;
    laidT = cam.t;
    const ct = Math.cos(cam.t);
    const sn = Math.sin(cam.t);
    const tn = Math.tan(cam.t);
    // 地面坐标系已经压扁了 cos t，所以抬高 z 在里面要写成往上挪 z·tan t。
    for (const L of levelNodes) {
      L.top.y = L.y - (L.k + 1) * LEVEL_H * tn;
      L.sides.forEach((s, j) => {
        s.visible = cam.t > 0.01;
        s.y = L.y - (L.k + j / SIDE_COPIES) * LEVEL_H * tn;
      });
    }
    for (const s of shads) s.obj.y = s.y - s.z * tn;
    for (const b of bills) {
      const y = b.y * ct - b.z * sn;
      b.obj.position.set(b.x, y);
      b.obj.zIndex = y + b.bias;
    }
    for (const f of relayouts) f();
  };
  const setTilt = (): void => {
    cam.t = TILT ? tiltFor(cam.s) : 0;
  };
  const views = { island: 0, region: 1.45, close: 2.6 } as const;
  const setView = (name: keyof typeof views): void => {
    const SW = app.screen.width;
    const SH = app.screen.height;
    cam.s = views[name] || Math.min(SW / W, SH / H);
    setTilt();
    const fx = name === 'island' ? W / 2 : (focus.x + 0.5) * PX;
    const fy = name === 'island' ? H / 2 : (focus.y + 0.5) * PX;
    anchor(cam, fx, fy, name === 'island' ? 0 : zAt(fx, fy), SW / 2, SH / 2);
    layout();
  };
  const initial = (params.get('view') ?? 'region') as keyof typeof views;
  setView(initial in views ? initial : 'region');
  layoutHud();
  app.renderer.on('resize', layoutHud);
  window.addEventListener('keydown', (e) => {
    if (e.key === '1') setView('island');
    if (e.key === '2') setView('region');
    if (e.key === '3') setView('close');
  });
  app.canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // 鼠标下的那块地面在缩放（和倾斜）前后不动。
      const [gx, gy] = unprojectGround(cam, e.offsetX, e.offsetY);
      cam.s = Math.min(4, Math.max(0.3, cam.s * Math.exp(-e.deltaY * 0.0015)));
      setTilt();
      anchor(cam, gx, gy, 0, e.offsetX, e.offsetY);
      layout();
    },
    { passive: false },
  );
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  app.canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY, ox: cam.ox, oy: cam.oy }));
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.ox = drag.ox + e.clientX - drag.x;
    cam.oy = drag.oy + e.clientY - drag.y;
    layout();
  });

  // 帧间隔：静止画面上量 60 帧（无头浏览器是软件渲染，这个数只在真机上有意义）。
  const frames: number[] = [];
  await new Promise<void>((done) => {
    let last = performance.now();
    const f = (now: number): void => {
      frames.push(now - last);
      last = now;
      if (frames.length < 60) requestAnimationFrame(f);
      else done();
    };
    requestAnimationFrame(f);
  });
  const frameMs = frames.slice(5).reduce((a, b) => a + b, 0) / (frames.length - 5);

  const totals = tokenInfo.map((s) => `${s.id} ${s.tokens.reduce((a, t) => a + t.count, 0)}（${s.tokens.length} 个代表）`).join('，');
  const flags = [kit ? '叶片' : '贴纸', terr ? `台阶 ${LEVELS} 层` : '无台阶', TILT ? '倾斜镜头' : '俯视'].join('、');
  document.getElementById('info')!.textContent =
    `种子 ${SEED}，第 ${day + 1} 天；${flags}；耗时（毫秒）${timing.join('、')}；地形和植被贴图约 ${Math.round(texBytes / 1048576)} MB；` +
    `帧间隔 ${frameMs.toFixed(1)} 毫秒；${totals}。按 1 / 2 / 3 切换全岛 / 区域 / 近景，滚轮缩放（越近越斜），拖动平移。`;
  (window as unknown as { __ready: boolean }).__ready = true;
}

void main();
