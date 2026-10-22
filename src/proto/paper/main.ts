import { Application, Assets, BlurFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { scenarioLibrary, speciesFor, worldFor } from '../../data';
import { Sim, TICKS_PER_DAY, countAt, herbIndex, woodyIndex } from '../../sim';
import { TERRAIN } from '../../sim/terrain';
import { hash2 } from './noise';
import { PX, buildFields, imagePaper, paintTerrain, proceduralPaper, type Palette, type PaperTex } from './terrain';
import { clusterTokens, drawPuppet, tokenLengthCells, type PuppetKind, type Token } from './tokens';

/**
 * 剪纸风格 demo（M0 · V2 的第一块）：用真实推演出来的鸟岛，按剪纸方式画地形、植被、代表单位、干预标记和界面。
 * 独立页面，只读推演，不接操作。素材来自 Lovart（art/incoming/lovart/paper/），缺的部分用代码画占位。
 * 参数：?seed=1&days=40&view=region|island|close
 */

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 1);
const DAYS = Number(params.get('days') ?? 40);

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
    ctx.drawImage(t.source.resource as CanvasImageSource, inset, inset, t.width - 2 * inset, t.height - 2 * inset, 0, 0, size, size);
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

async function main(): Promise<void> {
  const status = document.getElementById('status')!;
  status.textContent = `推演 ${DAYS} 天……`;
  await new Promise((r) => setTimeout(r, 0));

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

  // ---- 地形 ----
  status.textContent = '画地形……';
  await new Promise((r) => setTimeout(r, 0));
  const t0 = performance.now();
  const fields = buildFields({ width: w, height: h, terrain: grid.terrain, herb, shrub });
  const pal = await loadPalette();
  const painted = paintTerrain(fields, pal, SEED);
  const cv = document.createElement('canvas');
  cv.width = painted.width;
  cv.height = painted.height;
  cv.getContext('2d')!.putImageData(new ImageData(painted.data, painted.width, painted.height), 0, 0);
  const paintMs = Math.round(performance.now() - t0);

  const [P1, P2, P3, P5, P6, P7] = await Promise.all(['P1', 'P2', 'P3', 'P5', 'P6', 'P7'].map(loadSheet));
  void P5;

  const app = new Application();
  await app.init({ resizeTo: window, background: 0x1f5d7a, antialias: true });
  document.body.appendChild(app.canvas);
  status.textContent = '';

  const worldLayer = new Container();
  app.stage.addChild(worldLayer);
  worldLayer.addChild(new Sprite(Texture.from(cv)));
  const shadows = new Container();
  shadows.filters = [new BlurFilter({ strength: 3, quality: 2 })];
  shadows.alpha = 0.32;
  const props = new Container();
  props.sortableChildren = true;
  worldLayer.addChild(shadows, props);
  /** 代表单位和数量签：拉远时反向放大，像地图图标一样保持能看清的大小。 */
  const iconScaled: Container[] = [];

  const rnd = (x: number, y: number, k: number): number => hash2(x * 7 + k, y * 13 - k, SEED + 1000);
  const sdAt = (x: number, y: number): number => fields.sd[y * w + x]!;

  /** 贴一张贴纸：底边中点在 (cx, cy) 像素处，宽 widthPx。阴影是同一张图压扁、往右下偏。 */
  const stick = (tex: Texture, cx: number, cy: number, widthPx: number, flip = false, z = cy): Sprite => {
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    const k = widthPx / tex.width;
    s.scale.set(flip ? -k : k, k);
    s.position.set(cx, cy);
    s.zIndex = z;
    props.addChild(s);
    const sh = new Sprite(tex);
    sh.anchor.set(0.5, 1);
    sh.tint = 0x241a10;
    sh.scale.set(flip ? -k : k, k * 0.55);
    sh.skew.x = -0.6;
    sh.position.set(cx + widthPx * 0.08, cy + 2);
    shadows.addChild(sh);
    return s;
  };
  const pick = (sheet: Sheet | null | undefined, rows: number[], r: number): Texture | null => {
    if (!sheet) return null;
    const row = rows[Math.floor(r * rows.length) % rows.length]!;
    const list = sheet.tex[row]!;
    return list[Math.floor((r * 997) % 1 * list.length)] ?? list[0]!;
  };

  // ---- 植被和岩石贴纸（按格子撒，同一个种子位置固定） ----
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
  sim.species.forEach((sp, si) => {
    const pop = st.populations[si]!;
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
      unit.position.set(cx, cy);
      unit.zIndex = cy + 0.5;
      const flip = j % 3 === 2 && id !== 'dotterel';
      // P7 整只剪纸：每个物种一行五个姿势；同一物种按站姿（第 0 个）统一缩放，换姿势大小不变。
      // 按剪纸面积的平方根缩放，而不是按宽度：长尾巴、长耳朵不会让一个物种显得更小或更大。
      const rowI = P7_ROW[k] ?? -1;
      const row = P7?.tex[rowI];
      if (row) {
        const poses = P7_POSES[k]!;
        // 鸟：偶数个代表趴在巢里（P7 自带巢），其余站在巢边。
        const pose = id === 'dotterel' ? (j % 2 === 0 ? 3 : 0) : poses[Math.floor(rnd(j, si(id), 9) * poses.length)]!;
        if (id === 'dotterel' && pose !== 3 && nestTex) stick(nestTex[1 + (j % 3 === 1 ? 1 : 0)]!, cx - len * 0.45, cy + len * 0.05, len * 0.8, false, cy - 1);
        const area = P7!.rows[rowI]![0]![2] ?? (row[0]!.width / 1.65) ** 2;
        const kk = (len * 0.79) / Math.sqrt(area);
        const spr = new Sprite(row[pose]!);
        spr.anchor.set(0.5, 1);
        spr.scale.set(flip ? -kk : kk, kk);
        unit.addChild(spr);
      } else {
        if (id === 'dotterel' && nestTex) stick(nestTex[1 + (j % 2)]!, cx - len * 0.05, cy + len * 0.15, len * 0.95, false, cy - 1);
        const pup = drawPuppet(k, len);
        if (flip) pup.scale.x = -1;
        unit.addChild(pup);
      }
      props.addChild(unit);
      iconScaled.push(unit);
      const sh = new Graphics().ellipse(cx + len * 0.06, cy + 1, len * 0.42, len * 0.1).fill(0x241a10);
      shadows.addChild(sh);
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
    // 围栏：5 根木桩，蓝绳在桩顶之间微微下垂。
    const posts: [number, number][] = [];
    for (let k = 0; k < 5; k++) posts.push([(bird.x + 4 + k * 2.2) * PX, (bird.y - 3 + k * 1.1) * PX]);
    const postH = PX * 1.5;
    const rope = new Graphics();
    for (let k = 0; k < posts.length - 1; k++) {
      const [x1, y1] = posts[k]!;
      const [x2, y2] = posts[k + 1]!;
      rope.moveTo(x1, y1 - postH * 0.85).quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 - postH * 0.55, x2, y2 - postH * 0.85);
    }
    rope.stroke({ width: 3, color: 0x2f6fd0 });
    rope.zIndex = (bird.y - 3 + 4.4) * PX;
    props.addChild(rope);
    for (const [px2, py2] of posts) stick(blue[3]!, px2, py2, PX * 0.45);
  }
  const victim = nearBirds[0];
  if (victim && red && nestTex) {
    // 警报：离焦点最近的鸟群附近，一个被毁的巢。
    const [ax, ay] = landNear(victim.x - 5, victim.y + 6, 1, 0);
    const cx = (ax + 0.5) * PX;
    const cy = (ay + 0.5) * PX;
    const burst = new Sprite(red[0]!);
    burst.anchor.set(0.5);
    burst.width = burst.height = PX * 4.2;
    burst.position.set(cx, cy - PX * 0.5);
    burst.zIndex = cy - 2;
    props.addChild(burst);
    stick(nestTex[4]!, cx, cy + PX * 0.3, PX * 1.9);
    const bang = new Sprite(red[3]!);
    bang.anchor.set(0.5, 1);
    bang.scale.set((PX * 2.6) / bang.height);
    bang.position.set(cx, cy - PX * 2.9);
    bang.zIndex = 1e6 + 1;
    props.addChild(bang);
  }

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
    const W = app.screen.width;
    const H = app.screen.height;
    dateBox.position.set(20, 18);
    speedBox.position.set(W - 320, 18);
    bar.position.set((W - bar.width) / 2, H - 124);
  };

  // ---- 镜头：1 全岛、2 区域、3 近景；滚轮缩放、拖动平移 ----
  const views = { island: 0, region: 1.45, close: 2.6 } as const;
  let scale = 1;
  const rescaleIcons = (): void => {
    const k = Math.max(1, 0.95 / scale);
    for (const u of iconScaled) u.scale.set(k);
  };
  const setView = (name: keyof typeof views): void => {
    const W = app.screen.width;
    const H = app.screen.height;
    scale = views[name] || Math.min(W / (w * PX), H / (h * PX));
    const cx = name === 'island' ? (w * PX) / 2 : (focus.x + 0.5) * PX;
    const cy = name === 'island' ? (h * PX) / 2 : (focus.y + 0.5) * PX;
    worldLayer.scale.set(scale);
    worldLayer.position.set(W / 2 - cx * scale, H / 2 - cy * scale);
    rescaleIcons();
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
      const k = Math.exp(-e.deltaY * 0.0015);
      const mx = e.offsetX;
      const my = e.offsetY;
      const wx = (mx - worldLayer.x) / scale;
      const wy = (my - worldLayer.y) / scale;
      scale = Math.min(4, Math.max(0.3, scale * k));
      worldLayer.scale.set(scale);
      worldLayer.position.set(mx - wx * scale, my - wy * scale);
      rescaleIcons();
    },
    { passive: false },
  );
  let drag: { x: number; y: number } | null = null;
  app.canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX - worldLayer.x, y: e.clientY - worldLayer.y }));
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener('pointermove', (e) => {
    if (drag) worldLayer.position.set(e.clientX - drag.x, e.clientY - drag.y);
  });

  const totals = tokenInfo.map((s) => `${s.id} ${s.tokens.reduce((a, t) => a + t.count, 0)}（${s.tokens.length} 个代表）`).join('，');
  document.getElementById('info')!.textContent = `种子 ${SEED}，第 ${day + 1} 天；地形绘制 ${paintMs} 毫秒；${totals}。按 1 / 2 / 3 切换全岛 / 区域 / 近景，滚轮缩放，拖动平移。`;
  (window as unknown as { __ready: boolean }).__ready = true;
}

void main();
