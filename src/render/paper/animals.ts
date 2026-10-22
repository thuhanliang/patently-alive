import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { P7_ROW, type Sheet } from './assets';
import { PX } from './terrain';
import { clusterTokens, drawPuppet, tokenLengthCells, type PuppetKind, type Token } from './tokens';

/** 剪纸动物（P7 整只剪纸）、代表单位和数量签：demo 和游戏画面共用。 */

/** 物种对应哪种剪纸木偶；没有素材的物种（引进的、设计的）用代码画的通用木偶。 */
export function puppetKindOf(id: string): PuppetKind {
  return id === 'cat' ? 'cat-orange' : id === 'dotterel' ? 'bird' : id === 'rabbit' ? 'rabbit' : id === 'rat' ? 'rat' : 'generic';
}

export interface SpeciesTokens {
  id: string;
  kind: PuppetKind;
  tokens: Token[];
  /** 剪纸的身长（剪纸像素）。 */
  len: number;
}

/** 每个物种按格子数量聚成几个代表单位；不同物种的代表挨得太近时往外推一点，免得叠在一起。 */
export function speciesTokens(
  species: readonly { id: string; bodyMassKg: number; counts: ArrayLike<number> }[],
  w: number,
  h: number,
  isLand: (i: number) => boolean,
): SpeciesTokens[] {
  const info = species.map((sp) => ({
    id: sp.id,
    kind: puppetKindOf(sp.id),
    tokens: clusterTokens(sp.counts, w, h, isLand),
    len: tokenLengthCells(sp.bodyMassKg) * PX,
  }));
  const all = info.flatMap((s) => s.tokens);
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
  return info;
}

/** 一只剪纸动物（P7，缺了用代码画的木偶），脚底中点在原点。 */
export function makeAnimal(P7: Sheet | null, k: PuppetKind, len: number, pose: number, flip: boolean): Container {
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
}

/** 一个代表单位放几只：和示意图一样，数量多的一群放三四只（数量签上的数才是真数）。 */
export const groupSize = (count: number): number => (count < 3 ? 1 : count < 40 ? 2 : count < 1000 ? 3 : 4);
export const GROUP_OFFSETS: [number, number][] = [
  [0, 0],
  [-0.95, 0.42],
  [0.85, 0.62],
  [-0.2, -0.6],
];

/** 数量签：挂在代表单位第一只的右上方（原点是第一只的脚底），和它一起缩放。 */
export function makeCountTag(P6: Sheet | null, count: number, len: number): Container {
  const tagTex = P6?.tex[4]?.[3] ?? null;
  const tagBox = new Container();
  const tag = new Container();
  tagBox.addChild(tag);
  const label = new Text({
    text: `×${count.toLocaleString('zh-CN')}`,
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
  return tagBox;
}
