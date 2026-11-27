import { Container, Graphics } from 'pixi.js';
import type { PlantCut } from './shapes';

/**
 * 把一株剪纸植物画成 PixiJS 的一组纸片（剧场、地图用）：每一层纸先画投影，再画一圈奶油色的白边和纸本身。
 * 原点在植物的脚，pxPerM 是这一排每米多少像素。
 */
export function plantView(cut: PlantCut, pxPerM: number, shade = 1, shadow = 6): Container {
  const c = new Container();
  const sh = new Graphics();
  const body = new Graphics();
  c.addChild(sh, body);
  const k = pxPerM;
  const rim = Math.max(1, Math.min(3, k * 0.012));
  for (const s of cut.sheets) {
    const color = darken(parseInt(s.color.slice(1), 16), shade);
    for (const p of s.polys) {
      const pts = p.map((v, i) => (i % 2 === 0 ? v * k : -v * k));
      sh.poly(pts.map((v, i) => v + (i % 2 === 0 ? shadow * 0.8 : shadow))).fill({ color: 0x0d0a14, alpha: 0.28 });
      body.poly(pts).fill(color).stroke({ width: rim, color: darken(0xfbf6ea, shade), join: 'round' });
    }
  }
  return c;
}

function darken(c: number, k: number): number {
  if (k === 1) return c;
  return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
}
