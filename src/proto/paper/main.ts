import { Application, Assets, BlurFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { scenarioLibrary, speciesFor, worldFor } from '../../data';
import { Sim, TICKS_PER_DAY, countAt, herbIndex, woodyIndex } from '../../sim';
import { TERRAIN } from '../../sim/terrain';
import { PITCH_LIMIT, YAW_LIMIT, anchor, rotate, tiltFor, unprojectGround, type Cam } from './camera';
import { LeafKit, applyCarpet, paveGround } from './leaves';
import { fbm, hash2 } from './noise';
import { bakeShrub, bakeTussock } from './plants';
import { PX, SHRUB_EDGE, buildFields, imagePaper, paintTerrain, proceduralPaper, sample, terrainWarp, type Palette, type PaperTex } from './terrain';
import { clusterTokens, drawPuppet, tokenLengthCells, type PuppetKind, type Token } from './tokens';

/**
 * 剪纸风格 demo（M0 · V2 的第一块）：用真实推演出来的鸟岛，按剪纸方式画地形、植被、代表单位、干预标记和界面。
 * 独立页面，只读推演，不接操作。素材来自 Lovart（art/incoming/lovart/paper/），缺的部分用代码画占位。
 * 参数：?seed=1&days=40&view=region|island|close&mode=plants|stickers&tilt=1|0
 * - mode=plants（默认）：草地、灌丛的地面没有白边，铺一层 P8 叶片（leaves.ts）和 P1 草皮；
 *   草丛、灌丛按同一张灌丛场成片摆，植被的轮廓交给立起来的植物；海岸摆成堆的岩石、浅水的石头和海草；
 *   plants=lovart（默认）用 P1 草丛、P2 灌丛，plants=code 用代码画的（plants.ts，细草叶束和分层剪影）；
 *   mode=stickers：草丛、灌丛用 P1、P2 整张贴纸（第一版，留作对照）；
 * - tilt：随缩放变化的倾斜镜头（camera.ts），拉远俯视、拉近斜看，植物、动物、标记始终正对镜头。
 */

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);
const DAYS = Number(params.get('days') ?? 40);
const PLANTS = params.get('mode') !== 'stickers';
const PLANT_ART = params.get('plants') === 'code' ? 'code' : 'lovart';
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
  const kit = PLANTS && P8 ? new LeafKit(P8.tex.map((row) => row.map(imageOf))) : null;

  // ---- 地形：纸层 → 地面铺叶 ----
  status.textContent = '画地形……';
  await tick();
  const fields = buildFields({ width: w, height: h, terrain: grid.terrain, herb, shrub });
  const painted = timed('地形', () => paintTerrain(fields, pal, SEED, { softVegetation: !!kit, sculpt: !!kit }));
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
          const warp = terrainWarp(px, py, SEED);
          if (sample(fields.sd, w, h, u, v) + warp < 0.5) return null;
          const g = sample(fields.grass, w, h, u, v) + warp * 0.12;
          if (g > 0.62) return sample(fields.shrubLand, w, h, u, v) + warp * 0.12 > SHRUB_EDGE ? 'shrub' : 'grass';
          if (g < 0.38) return 'pebble';
          return null;
        },
        SEED + 50,
      ),
    );
    applyCarpet(img, carpet);
  }
  const baseCv = document.createElement('canvas');
  baseCv.width = W;
  baseCv.height = H;
  baseCv.getContext('2d')!.putImageData(img, 0, 0);
  let texBytes = W * H * 4;

  const app = new Application();
  await app.init({ resizeTo: window, background: kit ? 0x143268 : 0x1f5d7a, antialias: true });
  document.body.appendChild(app.canvas);
  status.textContent = '';

  // 场景：root 下面两层。ground 是地面（先在 spin 里转 r，再竖直压扁 cos t），bill 是立起来的纸片（不压扁、不转）。
  const root = new Container();
  app.stage.addChild(root);
  const ground = new Container();
  const spin = new Container();
  ground.addChild(spin);
  const bill = new Container();
  bill.sortableChildren = true;
  root.addChild(ground, bill);
  const baseTex = Texture.from(baseCv);
  spin.addChild(new Sprite(baseTex));

  const shadows = new Container();
  shadows.filters = [new BlurFilter({ strength: 3, quality: 2 })];
  shadows.alpha = 0.32;
  spin.addChild(shadows);

  // 立起来的东西按地面坐标登记，镜头一变就统一重排；地上的投影在地面坐标系里，不用重排。
  type Bill = { obj: Container; x: number; y: number; bias: number };
  const bills: Bill[] = [];
  const relayouts: (() => void)[] = [];
  const place = (obj: Container, x: number, y: number, bias = 0): Bill => {
    const b = { obj, x, y, bias };
    bills.push(b);
    bill.addChild(obj);
    return b;
  };
  const shadowAt = (obj: Container, x: number, y: number): void => {
    obj.position.set(x, y);
    shadows.addChild(obj);
  };
  /** 代表单位和数量签：拉远时反向放大，像地图图标一样保持能看清的大小。 */
  const iconScaled: Container[] = [];

  const rnd = (x: number, y: number, k: number): number => hash2(x * 7 + k, y * 13 - k, SEED + 1000);
  const sdAt = (x: number, y: number): number => fields.sd[y * w + x]!;

  /** 贴一张立起来的纸片：底边中点在 (cx, cy) 像素处，宽 widthPx。投影是同一张图压扁、倒向右下，贴在地上。 */
  const stick = (tex: Texture, cx: number, cy: number, widthPx: number, flip = false, bias = 0, shade = 1): Sprite => {
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    if (shade !== 1) {
      const g = Math.round(Math.min(1, shade) * 255);
      s.tint = (g << 16) | (g << 8) | Math.round(g * 0.97);
    }
    const k = widthPx / tex.width;
    s.scale.set(flip ? -k : k, k);
    place(s, cx, cy, bias);
    // 光从左上来：影子从脚下往右下方倒在地上（同一张图上下翻过来、压扁、往右斜）。
    const sh = new Sprite(tex);
    sh.anchor.set(0.5, 1);
    sh.tint = 0x241a10;
    sh.scale.set(flip ? -k : k, -k * 0.42);
    sh.skew.x = 0.75;
    shadowAt(sh, cx, cy - 1);
    return s;
  };
  const pick = (sheet: Sheet | null | undefined, rows: number[], r: number): Texture | null => {
    if (!sheet) return null;
    const row = rows[Math.floor(r * rows.length) % rows.length]!;
    const list = sheet.tex[row]!;
    return list[Math.floor((r * 997) % 1 * list.length)] ?? list[0]!;
  };

  // ---- 贴纸模式（第一版）：植被和岩石按格子撒，同一个种子位置固定。植物模式在后面另摆。 ----
  if (!kit)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = grid.terrain[i]!;
      const r1 = rnd(x, y, 1);
      const r2 = rnd(x, y, 2);
      const jx = (x + 0.15 + 0.7 * rnd(x, y, 3)) * PX;
      const jy = (y + 0.3 + 0.7 * rnd(x, y, 4)) * PX;
      const flip = rnd(x, y, 5) < 0.5;
      if (t === TERRAIN.shrub) {
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

  /** 从这里开始登记的立牌（代表单位、巢、标记、警报）是游戏信息：后面摆植物时，挡在它们前面的植物不摆。 */
  const firstInfo = bills.length;
  const tagTex = P6?.tex[4]?.[3] ?? null;
  const nestTex = P6?.tex[0] ?? null;
  /** 代表单位里除第一只以外的同伴：拉远成地图图标时藏起来，只留一只。 */
  const companions: Container[] = [];
  /** 一只剪纸动物（P7，缺了用代码画的木偶），脚底中点在原点。 */
  const animal = (k: PuppetKind, len: number, pose: number, flip: boolean): Container => {
    const c = new Container();
    // P7 整只剪纸：每个物种一行五个姿势；同一物种按站姿（第 0 个）统一缩放，换姿势大小不变。
    // 按剪纸面积的平方根缩放，而不是按宽度：长尾巴、长耳朵不会让一个物种显得更小或更大。
    const rowI = P7_ROW[k] ?? -1;
    const row = P7?.tex[rowI];
    if (row) {
      const area = P7!.rows[rowI]![0]![2] ?? (row[0]!.width / 1.65) ** 2;
      const kk = (len * 0.79) / Math.sqrt(area);
      const spr = new Sprite(row[pose]!);
      spr.anchor.set(0.5, 1);
      spr.scale.set(flip ? -kk : kk, kk);
      c.addChild(spr);
    } else {
      const pup = drawPuppet(k, len);
      if (flip) pup.scale.x = -1;
      c.addChild(pup);
    }
    return c;
  };
  /** 一个代表单位放几只：和示意图一样，数量多的一群放三四只（数量签上的数才是真数）。 */
  const groupSize = (count: number): number => (count < 3 ? 1 : count < 40 ? 2 : count < 1000 ? 3 : 4);
  const GROUP_OFFSETS: [number, number][] = [
    [0, 0],
    [-0.95, 0.42],
    [0.85, 0.62],
    [-0.2, -0.6],
  ];
  tokenInfo.forEach(({ id, kind, tokens, len }) => {
    tokens.forEach((tk, j) => {
      const cx = (tk.x + 0.5) * PX;
      const cy = (tk.y + 0.5) * PX;
      const n = groupSize(tk.count);
      for (let m = 0; m < n; m++) {
        const k: PuppetKind = id === 'cat' && (j + m) % 2 === 1 ? 'cat-piebald' : kind;
        const [ox, oy] = GROUP_OFFSETS[m]!;
        const x = cx + ox * len;
        const y = cy + oy * len;
        const flip = (j + m) % 3 === 2 && id !== 'dotterel';
        const poses = P7_POSES[k] ?? [0];
        // 鸟：多数趴在巢里（P7 自带巢），少数站在巢边。
        const pose = id === 'dotterel' ? ((j + m) % 3 === 2 ? 0 : 3) : poses[Math.floor(rnd(j * 7 + m, si(id), 9) * poses.length)]!;
        if (id === 'dotterel' && (pose !== 3 || !P7) && nestTex) stick(nestTex[1 + ((j + m) % 2)]!, x - len * 0.45, y + len * 0.05, len * 0.8, false, -len * 0.05 - 1);
        const unit = animal(k, len, pose, flip);
        place(unit, x, y, 0.5);
        iconScaled.push(unit);
        if (m > 0) companions.push(unit);
        shadowAt(new Graphics().ellipse(0, 0, len * 0.42, len * 0.1).fill(0x241a10), x + len * 0.06, y + 1);
      }
      // 数量签挂在第一只的右上方，和它一起缩放；单独立一块、永远画在最上面，不被别的动物和植物挡住。
      const tagBox = new Container();
      const tag = new Container();
      tagBox.addChild(tag);
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
      tag.position.set(len * 0.45 + (tw * tag.scale.x) / 2, -len * 0.8);
      place(tagBox, cx, cy, 1e5);
      iconScaled.push(tagBox);
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

  // ---- 植物模式：草丛、灌丛、地面贴片、海岸的石头和海草 ----
  if (kit)
    timed('植物', () => {
      // 大小按兔子身长定（量自示意图：一丛草约和兔子一样长、比站着的兔子高一些；一团灌丛约是兔子的 1.2–1.8 倍）。
      const rabbit = sim.species.find((sp) => sp.params.id === 'rabbit');
      const rabbitLen = tokenLengthCells(rabbit?.params.bodyMassKg ?? 1.6) * PX;
      const choose = <T,>(list: T[], r: number): T => list[Math.floor(r * list.length) % list.length]!;
      const fromCanvas = (c: HTMLCanvasElement): Texture => {
        texBytes += c.width * c.height * 4;
        return Texture.from(c);
      };
      // 植物的样子：默认用 Lovart 的 P1 草丛、P2 灌丛（和示意图同一套画）；?plants=code 换成代码画的（plants.ts）。
      const LV = [0.15, 0.4, 0.7, 1];
      const level = (x: number): number => LV.reduce((best, l, i) => (Math.abs(l - x) < Math.abs(LV[best]! - x) ? i : best), 0);
      const lovart = PLANT_ART === 'lovart' && P1 && P2;
      const code = lovart
        ? null
        : {
            tussocks: LV.map((b, bi) => [0, 0.5, 1].map((d, di) => Array.from({ length: 3 }, (_, v) => fromCanvas(bakeTussock(b, d, SEED * 97 + bi * 31 + di * 7 + v, 160))))),
            flowers: Array.from({ length: 3 }, (_, v) => fromCanvas(bakeTussock(0.8, 0, SEED * 71 + v, 160, kit, true))),
            shrubs: LV.map((a, ai) => Array.from({ length: 4 }, (_, v) => fromCanvas(bakeShrub(kit, a, SEED * 89 + ai * 13 + v, 200)))),
          };
      /** 草丛：植被量高用 P1 前两行，中等混进偏黄的几株，低的用被啃过的第 5 行。 */
      const tussockTex = (b: number, dry: number, r: number): Texture =>
        code
          ? choose(code.tussocks[level(b)]![Math.round(dry * 2)]!, r)
          : b > 0.5
            ? choose([...P1!.tex[0]!.slice(0, 5), ...P1!.tex[1]!.slice(0, 4), P1!.tex[1]![5]!], r)
            : b > 0.25
              ? choose([P1!.tex[0]![5]!, P1!.tex[1]![4]!, P1!.tex[0]![3]!, P1!.tex[1]![1]!], r)
              : choose(P1!.tex[4]!, r);
      const flowerTex = (r: number): Texture => (code ? choose(code.flowers, r) : choose(P1!.tex[3]!, r));
      /** 灌丛：茂盛的只用 P2 前三行里圆而密的那些（示意图里是一团团深绿），稀疏的用第 5 行，枯的用第 6 行。 */
      const lushShrubs = P2 ? ([[0, 0], [0, 1], [0, 3], [0, 4], [0, 5], [1, 0], [1, 2], [1, 4], [2, 0], [2, 2], [2, 3], [2, 5]] as const).map(([r, c]) => P2.tex[r]![c]!) : [];
      const shrubTex = (a: number, r: number): Texture =>
        code ? choose(code.shrubs[level(a)]!, r) : a > 0.45 ? choose(lushShrubs, r) : a > 0.2 ? choose(P2!.tex[4]!, r) : choose(P2!.tex[5]!, r);
      const aspect = (t: Texture): number => t.height / t.width;

      // 同一张灌丛场（和地形绘制同样的扭曲）同时决定树冠下的暗地面和灌丛摆在哪：轮廓只有一套。
      const field = (f: Float32Array, px: number, py: number): number =>
        sample(f, w, h, (px + 0.5) / PX - 0.5, (py + 0.5) / PX - 0.5) + terrainWarp(px, py, SEED) * (f === fields.sd ? 1 : 0.12);
      const cellOf = (px: number, py: number): number => Math.min(h - 1, Math.max(0, Math.floor(py / PX))) * w + Math.min(w - 1, Math.max(0, Math.floor(px / PX)));
      // 挡住游戏信息的不摆：植物在立牌前面（脚更靠下），而且从俯视到最斜的任一角度下顶部高过立牌的脚。
      const info = bills.slice(firstInfo).map((b) => {
        const lb = b.obj.getLocalBounds();
        const sx = b.obj.scale.x;
        const xs = [b.x + lb.minX * sx, b.x + lb.maxX * sx];
        return { x0: Math.min(...xs), x1: Math.max(...xs), y: b.y };
      });
      const blocked = (x: number, y: number, pw: number, ph: number): boolean =>
        info.some((r) => x + pw * 0.4 > r.x0 && x - pw * 0.4 < r.x1 && y > r.y && [1, 0.64].some((c) => y * c - ph * 0.9 < r.y * c));
      const rr = (gx: number, gy: number, k: number): number => hash2(gx * 5 + k, gy * 3 - k, SEED + 2000);
      /** 在网格加抖动的点上摆东西：f 返回 null 表示这里不摆。 */
      const scatter = (stepCells: number, k: number, f: (x: number, y: number, gx: number, gy: number) => void): void => {
        const st = PX * stepCells;
        for (let gy = 0; gy * st < H; gy++)
          for (let gx = 0; gx * st < W; gx++) f((gx + rr(gx, gy, k)) * st, (gy + rr(gx, gy, k + 1)) * st, gx, gy);
      };

      // 地面贴片：P1 第 3 行的草皮平铺在草地上、P3 第 3 行的卵石堆铺在海滩上，直接画进地形图（平躺，跟着地面压扁）。
      if (lovart && P3) {
        const g = baseCv.getContext('2d')!;
        scatter(2.2, 40, (x, y, gx, gy) => {
          const sd = field(fields.sd, x, y);
          if (sd < 0.3) return;
          const gr = field(fields.grass, x, y);
          const t = gr > 0.6 ? choose(P1!.tex[2]!, rr(gx, gy, 42)) : gr < 0.4 && rr(gx, gy, 43) < 0.45 ? choose(P3.tex[2]!, rr(gx, gy, 42)) : null;
          if (!t || rr(gx, gy, 44) > (gr > 0.6 ? 0.5 : 1)) return;
          const size = rabbitLen * (gr > 0.6 ? 0.55 + 0.35 * rr(gx, gy, 45) : 0.3 + 0.15 * rr(gx, gy, 45));
          const under = field(fields.shrubLand, x, y) > SHRUB_EDGE;
          g.save();
          g.globalAlpha = 0.75;
          if (under) g.filter = 'brightness(0.72)';
          g.drawImage(imageOf(t), x - size / 2, y - (size * aspect(t)) / 2, size, size * aspect(t));
          g.restore();
        });
        baseTex.source.update();
      }

      // 灌丛：树冠的视觉中心（脚往上约 0.4 个高度）落在灌丛场里才摆，密密地叠成一整片。
      /** 灌丛植被量：取树冠中心附近 3×3 格里灌丛格的最大值（脚可能落在灌丛外的草地格上）。 */
      const shrubAt = (px: number, py: number): number => {
        let m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, shrub[cellOf(px + dx * PX, py + dy * PX)]!);
        return m;
      };
      scatter(lovart ? 1.3 : 1.6, 1, (x, y, gx, gy) => {
        const size = rabbitLen * (lovart ? 1.1 + 0.6 * rr(gx, gy, 3) : 1.3 + 0.7 * rr(gx, gy, 3));
        const yc = y - size * 0.3;
        if (field(fields.shrubLand, x, yc) < SHRUB_EDGE) return;
        const t = shrubTex(shrubAt(x, yc), rr(gx, gy, 4));
        const ph = size * aspect(t);
        if (blocked(x, y, size, ph)) return;
        // Lovart 的灌丛压暗一些，叠成示意图里那种深绿的一团；每丛明暗略有不同。
        stick(t, x, y, size, rr(gx, gy, 5) < 0.5, 0, (lovart ? 0.64 : 0.88) + 0.14 * rr(gx, gy, 6));
      });
      // 草丛：成片长（低频噪声），离灌丛留一点空。
      scatter(2.2, 11, (x, y, gx, gy) => {
        const size = rabbitLen * (0.95 + 0.45 * rr(gx, gy, 13));
        const yc = y - size * 0.45;
        if (field(fields.grass, x, yc) < 0.62 || field(fields.shrubLand, x, yc) > SHRUB_EDGE - 0.12) return;
        const b = herb[cellOf(x, yc)]!;
        const clump = Math.min(1, Math.max(0, (fbm(x / (PX * 7), y / (PX * 7), SEED + 77) - 0.4) / 0.25));
        if (rr(gx, gy, 14) > clump * 0.6 * (0.3 + 0.7 * b)) return;
        const flower = b > 0.5 && rr(gx, gy, 15) < 0.1;
        const t = flower ? flowerTex(rr(gx, gy, 16)) : tussockTex(b, Math.min(1, Math.max(0, (0.65 - b) / 0.5)), rr(gx, gy, 16));
        const sz = flower ? size * 0.75 : size;
        if (blocked(x, y, sz, sz * aspect(t))) return;
        stick(t, x, y, sz, rr(gx, gy, 17) < 0.5, 0, 0.92 + 0.08 * rr(gx, gy, 18));
      });

      // 海岸：岩石成堆地长在水边（低频噪声决定哪里是岩岸），浅水里半没的石头，深一点的水里金色的海草，沙滩上零星的漂木和贝壳。
      if (P3)
        scatter(1.3, 21, (x, y, gx, gy) => {
          const sd = field(fields.sd, x, y);
          const r = rr(gx, gy, 23);
          const outcrop = fbm(x / (PX * 6), y / (PX * 6), SEED + 303);
          let t: Texture | null = null;
          let size = 0;
          let shade = 1;
          if (sd > -0.6 && sd < 1.2 && outcrop > 0.46 && r < 0.75) {
            t = choose(field(fields.grass, x, y) > 0.5 && r < 0.3 ? P3.tex[3]! : [...P3.tex[0]!, ...P3.tex[1]!], rr(gx, gy, 24));
            size = rabbitLen * (0.8 + 0.9 * rr(gx, gy, 25));
          } else if (sd > -8 && sd < -3 && r < 0.02) {
            t = choose([P3.tex[5]![5]!, P3.tex[4]![1]!, P3.tex[4]![4]!], rr(gx, gy, 24));
            size = rabbitLen * (0.7 + 0.5 * rr(gx, gy, 25));
            shade = 0.95;
          } else if (sd > 0.1 && sd < 0.9 && field(fields.grass, x, y) < 0.4 && r < 0.02) {
            t = choose([P3.tex[4]![0]!, P3.tex[4]![2]!, P3.tex[4]![3]!, P3.tex[4]![5]!], rr(gx, gy, 24));
            size = rabbitLen * 0.45;
          }
          if (!t || blocked(x, y, size, size * aspect(t))) return;
          stick(t, x, y, size, rr(gx, gy, 26) < 0.5, 0, shade);
        });
    });

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

  // ---- 镜头：1 全岛、2 区域、3 近景；滚轮缩放（越近越斜）、拖动平移；右侧三个滑块调缩放、俯仰、旋转 ----
  const cam: Cam = { s: 1, t: 0, r: 0, ox: 0, oy: 0 };
  let laidT = -1;
  let laidR = NaN;
  const layout = (): void => {
    root.position.set(cam.ox, cam.oy);
    ground.scale.set(cam.s, cam.s * Math.cos(cam.t));
    spin.rotation = cam.r;
    bill.scale.set(cam.s);
    const k = Math.max(1, 0.95 / cam.s);
    for (const u of iconScaled) u.scale.set(k);
    for (const u of companions) u.visible = k < 1.05;
    // 立起来的东西的位置只和倾斜角、旋转角有关；都没变就不用重排。前后按转过以后的远近排。
    if (cam.t === laidT && cam.r === laidR) return;
    laidT = cam.t;
    laidR = cam.r;
    const ct = Math.cos(cam.t);
    for (const b of bills) {
      const [x, ry] = rotate(cam, b.x, b.y);
      const y = ry * ct;
      b.obj.position.set(x, y);
      b.obj.zIndex = y + b.bias;
    }
    for (const f of relayouts) f();
  };
  /** 手动设的俯仰角；null = 跟着缩放自动倾斜。 */
  let manualPitch: number | null = null;
  const setTilt = (): void => {
    cam.t = manualPitch ?? (TILT ? tiltFor(cam.s) : 0);
  };
  const deg = Math.PI / 180;
  const pitchParam = params.get('pitch');
  const yawParam = params.get('yaw');
  if (pitchParam !== null) manualPitch = Math.min(PITCH_LIMIT, Math.max(0, Number(pitchParam) * deg));
  if (yawParam !== null) cam.r = Math.min(YAW_LIMIT, Math.max(-YAW_LIMIT, Number(yawParam) * deg));
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 4;
  const views = { island: 0, region: 1.45, close: 2.6 } as const;
  const setView = (name: keyof typeof views): void => {
    const SW = app.screen.width;
    const SH = app.screen.height;
    cam.s = views[name] || Math.min(SW / W, SH / H);
    setTilt();
    const fx = name === 'island' ? W / 2 : (focus.x + 0.5) * PX;
    const fy = name === 'island' ? H / 2 : (focus.y + 0.5) * PX;
    anchor(cam, fx, fy, 0, SW / 2, SH / 2);
    layout();
    syncSliders();
  };

  // 滑块：改镜头时，屏幕中心下的那块地面不动。
  const panel = document.getElementById('cam')!;
  const slider = (label: string, min: number, max: number, step: number): { input: HTMLInputElement; out: HTMLSpanElement } => {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const out = document.createElement('span');
    out.className = 'v';
    row.append(name, input, out);
    panel.appendChild(row);
    return { input, out };
  };
  const zoomS = slider('缩放', Math.log(ZOOM_MIN), Math.log(ZOOM_MAX), 0.01);
  const pitchS = slider('俯仰', 0, PITCH_LIMIT / deg, 1);
  const yawS = slider('旋转', -YAW_LIMIT / deg, YAW_LIMIT / deg, 1);
  const reset = document.createElement('button');
  reset.textContent = '俯仰回到自动、旋转归零';
  panel.appendChild(reset);
  function syncSliders(): void {
    zoomS.input.value = String(Math.log(cam.s));
    zoomS.out.textContent = `${cam.s.toFixed(2)}×`;
    pitchS.input.value = String(Math.round(cam.t / deg));
    pitchS.out.textContent = `${Math.round(cam.t / deg)}°${manualPitch === null ? ' 自动' : ''}`;
    yawS.input.value = String(Math.round(cam.r / deg));
    yawS.out.textContent = `${Math.round(cam.r / deg)}°`;
  }
  const aroundCentre = (change: () => void): void => {
    const SW = app.screen.width;
    const SH = app.screen.height;
    const [gx, gy] = unprojectGround(cam, SW / 2, SH / 2);
    change();
    setTilt();
    anchor(cam, gx, gy, 0, SW / 2, SH / 2);
    layout();
    syncSliders();
  };
  zoomS.input.addEventListener('input', () => aroundCentre(() => (cam.s = Math.exp(Number(zoomS.input.value)))));
  pitchS.input.addEventListener('input', () => aroundCentre(() => (manualPitch = Number(pitchS.input.value) * deg)));
  yawS.input.addEventListener('input', () => aroundCentre(() => (cam.r = Number(yawS.input.value) * deg)));
  reset.addEventListener('click', () =>
    aroundCentre(() => {
      manualPitch = null;
      cam.r = 0;
    }),
  );
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
      cam.s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.s * Math.exp(-e.deltaY * 0.0015)));
      setTilt();
      anchor(cam, gx, gy, 0, e.offsetX, e.offsetY);
      layout();
      syncSliders();
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
  const flags = [!kit ? '贴纸模式' : PLANT_ART === 'lovart' && P1 && P2 ? 'P1/P2 植物' : '代码画的植物', TILT ? '倾斜镜头' : '俯视'].join('、');
  document.getElementById('info')!.textContent =
    `种子 ${SEED}，第 ${day + 1} 天；${flags}；耗时（毫秒）${timing.join('、')}；地形和植被贴图约 ${Math.round(texBytes / 1048576)} MB；` +
    `帧间隔 ${frameMs.toFixed(1)} 毫秒；${totals}。按 1 / 2 / 3 切换全岛 / 区域 / 近景，滚轮缩放（越近越斜），拖动平移；右侧滑块调缩放、俯仰（0–60°）、旋转（±45°）。`;
  (window as unknown as { __ready: boolean }).__ready = true;
}

void main();
