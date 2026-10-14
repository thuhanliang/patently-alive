/**
 * 田野笔记的配色表（CLAUDE.md「美术」、GDD「色彩与材质」）。画面、界面、图表都从这里取色，不在别处写死颜色。
 * 只是画法，不进推演。
 */

/** 纸、墨、蓝图蓝（玩家的批注）、朱红（警报、印章）。 */
export const PAPER = 0xf3ede0;
export const INK = 0x1f1d1a;
export const BLUEPRINT = 0x2f5d8a;
export const VERMILION = 0xd2462e;

export const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
/** 带透明度的 CSS 颜色。 */
export const cssAlpha = (c: number, a: number): string => `rgba(${(c >> 16) & 0xff},${(c >> 8) & 0xff},${c & 0xff},${a})`;

/**
 * 物种主色：地图、图标、图表共用。没列出的物种用墨灰。
 * 鸟白身黑帽，图表里用炭黑（白线在纸上看不见）。
 */
const SPECIES_COLORS: Record<string, { body: number; chart: number }> = {
  bird: { body: 0xf7f5f0, chart: 0x3a3a3a },
  dotterel: { body: 0xf7f5f0, chart: 0x3a3a3a },
  rabbit: { body: 0xc9a97a, chart: 0xb08a55 },
  rat: { body: 0x7d8a99, chart: 0x6b7889 },
  vole: { body: 0x8c8270, chart: 0x7a705e },
  cat: { body: 0xd98a3d, chart: 0xd98a3d },
  // 阶段 0 的鼬：CLAUDE.md 没定主色，取两种深浅的栗褐，和猫的橘色分得开。
  weasel: { body: 0xa8714a, chart: 0xa8714a },
  stoat: { body: 0x6e4a33, chart: 0x6e4a33 },
  brownrat: { body: 0x6f665c, chart: 0x6f665c },
  kiore: { body: 0x9c8a72, chart: 0x8a785f },
  mouse: { body: 0x9a968e, chart: 0x86827a },
  mongoose: { body: 0x8a7a4e, chart: 0x8a7a4e },
  ferret: { body: 0xe2d3b0, chart: 0xa89870 },
  fox: { body: 0xc4622d, chart: 0xc4622d },
  possum: { body: 0x8e9196, chart: 0x74777c },
  kiwi: { body: 0x7a5b3a, chart: 0x7a5b3a },
  weka: { body: 0x8b5e34, chart: 0x8b5e34 },
  kakapo: { body: 0x7c9a4a, chart: 0x7c9a4a },
};
const FALLBACK = { body: 0x8a857c, chart: 0x6a655c };

export function speciesColor(id: string): { body: number; chart: number } {
  return SPECIES_COLORS[id] ?? FALLBACK;
}

/** 按物种参数取主色：设计物种用设计时选的颜色，真实物种查上面的表。 */
export function colorOf(p: { id: string; appearance?: { color: string } | undefined }): { body: number; chart: number } {
  if (p.appearance) {
    const c = parseInt(p.appearance.color.slice(1), 16);
    return { body: c, chart: c };
  }
  return speciesColor(p.id);
}

/**
 * 地形的水彩色（低饱和、低对比）。陆地按植被多少在"枯"和"茂"之间插值；水按离岸远近在浅、深之间插值。
 */
export const TERRAIN_COLORS = {
  shallowWater: 0xb9cfcf,
  deepWater: 0x93b1bb,
  coast: 0xe6d6b2,
  grassDry: 0xdccb9c,
  grassLush: 0xa7bb84,
  shrubDry: 0xa9ab84,
  shrubLush: 0x7f9670,
} as const;

export function lerpColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
