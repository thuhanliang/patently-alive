import { Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import { INK } from './palette';

/**
 * 动物的占位形状（田野笔记画法，正式精灵到了再换）：白底圆点 + 墨线轮廓，按物种主色着色
 * （着色只乘在白底上，墨线还是墨色）。鸟加一顶黑帽。
 * 所有形状画在同一张贴图上：粒子容器里的粒子要共用一张底图。
 */
const FRAME = 64;
const SHAPES = ['dot', 'capped'] as const;
export type ShapeName = (typeof SHAPES)[number];

/** 哪些物种画成什么形状（只是画法）。 */
const SHAPE_OF: Record<string, ShapeName> = { dotterel: 'capped', bird: 'capped' };

export function shapeOf(speciesId: string): ShapeName {
  return SHAPE_OF[speciesId] ?? 'dot';
}

export function buildShapeTextures(renderer: Renderer): Record<ShapeName, Texture> {
  const g = new Graphics();
  SHAPES.forEach((name, k) => {
    const cx = k * FRAME + FRAME / 2;
    const cy = FRAME / 2;
    g.circle(cx, cy, 26).fill(0xffffff);
    if (name === 'capped') g.ellipse(cx, cy - 13, 19, 12).fill(INK);
    g.circle(cx, cy, 26).stroke({ width: 7, color: INK });
  });
  const atlas = renderer.generateTexture({
    target: g,
    resolution: 1,
    antialias: true,
    frame: new Rectangle(0, 0, FRAME * SHAPES.length, FRAME),
  });
  const out = {} as Record<ShapeName, Texture>;
  SHAPES.forEach((name, k) => {
    out[name] = new Texture({ source: atlas.source, frame: new Rectangle(k * FRAME, 0, FRAME, FRAME) });
  });
  return out;
}
