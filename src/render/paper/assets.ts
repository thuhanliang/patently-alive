import { Assets, Texture, type Spritesheet } from 'pixi.js';
import { imagePaper, proceduralPaper, type Palette, type PaperTex } from './terrain';
import type { PuppetKind } from './tokens';

/** 剪纸素材的载入（Lovart 的 P1–P8 素材表，见 art/incoming/lovart/paper/）。 */

export type Sheet = { rows: number[][][]; tex: Texture[][] };

/** 一张素材表打成一张图集（scripts/art/pack_atlas.py）：一个请求，同一图集里的素材能合批绘制。 */
export async function loadSheet(name: string): Promise<Sheet | null> {
  try {
    const sheet = await Assets.load<Spritesheet>(`proto/paper/${name}.json`);
    const rows = (sheet.data.meta as unknown as { rows: number[][][] }).rows;
    const tex = rows.map((row, r) => row.map((_, c) => sheet.textures[`${r}_${c}`]!));
    return { rows, tex };
  } catch {
    return null;
  }
}

type Img = CanvasImageSource & { width: number; height: number };
const cropped = new WeakMap<Texture, HTMLCanvasElement>();
/** 图集里的一帧单独画到一张画布上（画到 2D 画布、读像素时用）；按贴图缓存。 */
export const imageOf = (t: Texture): Img => {
  let c = cropped.get(t);
  if (c) return c;
  const f = t.frame;
  c = document.createElement('canvas');
  c.width = f.width;
  c.height = f.height;
  c.getContext('2d')!.drawImage(t.source.resource as Img, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
  cropped.set(t, c);
  return c;
};

/** P4 纸纹（3×3）：有就用真图，没有就用代码生成的纸。顺序见提示词：深海、中海、浅海、浪花、卵石滩、沙、草地、灌丛、牛皮纸。 */
export async function loadPalette(): Promise<Palette> {
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
export const P7_ROW: Partial<Record<PuppetKind, number>> = { 'cat-orange': 0, 'cat-piebald': 1, bird: 2, rabbit: 3, rat: 4 };
export const P7_POSES: Partial<Record<PuppetKind, number[]>> = {
  'cat-orange': [0, 1, 2, 3, 4],
  'cat-piebald': [0, 1, 2, 3, 4],
  bird: [0, 3],
  rabbit: [0, 1, 2, 3, 4],
  rat: [0, 1, 2, 3, 4],
};
