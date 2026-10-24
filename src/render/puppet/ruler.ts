import { Container, Graphics, Text } from 'pixi.js';
import type { ReferenceAnimal } from '../../data/schema/gait';

/**
 * 体型标尺（M1-1）：纸偶身后叠两张同体重上下的真实动物剪影（浅色的影子纸），
 * 拖体重时一眼看出"现在像猫那么大，还是像狼那么大"。
 * 剪影只按 gait.json 的几个尺寸画（头体长、肩高、尾、耳、颈），不是精确的轮廓。
 * 内部单位是毫米，view 的缩放由调用的人按每米多少像素设。
 */

/** 比 massKg 小的最近一种、大的最近一种（体重刚好落在两头之外时只有一种）。 */
export function bracket(refs: readonly ReferenceAnimal[], massKg: number): ReferenceAnimal[] {
  const sorted = [...refs].sort((a, b) => a.massKg - b.massKg);
  let lo: ReferenceAnimal | undefined;
  let hi: ReferenceAnimal | undefined;
  for (const r of sorted) {
    if (r.massKg <= massKg) lo = r;
    else if (!hi) hi = r;
  }
  return [lo, hi].filter((r): r is ReferenceAnimal => r !== undefined);
}

const MM = 1000;

/** 一张剪影：朝右，原点在身体中点正下方的地面。 */
export function drawReference(ref: ReferenceAnimal, color: number, alpha: number): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);
  const B = ref.bodyLengthM * MM;
  const S = ref.shoulderM * MM;
  const bodyH = Math.max(B * 0.16, S * 0.32);
  const legTop = S - bodyH * 0.5;
  const fill = { color, alpha };
  // 四条腿（两两并在一起）。
  const legW = B * 0.07;
  for (const x of [-0.36 * B, -0.28 * B, 0.24 * B, 0.32 * B]) g.roundRect(x - legW / 2, -legTop - 2, legW, legTop + 2, legW / 2);
  g.fill(fill);
  // 身体、尾、颈、头、耳。
  g.ellipse(-0.02 * B, -S, 0.48 * B, bodyH).fill(fill);
  if (ref.tail > 0) {
    const tl = ref.tail * B;
    g.poly([-0.46 * B, -S - bodyH * 0.3, -0.46 * B - tl, -S + bodyH * 0.6 + tl * 0.25, -0.46 * B - tl * 0.95, -S + bodyH * 0.75 + tl * 0.25, -0.44 * B, -S + bodyH * 0.2]).fill(fill);
  }
  const head = referenceHead(ref);
  const hx = head.x * MM;
  const hy = -head.y * MM;
  const hr = head.r * MM;
  g.poly([0.3 * B, -S - bodyH * 0.7, hx - hr * 0.2, hy - hr * 0.5, hx + hr * 0.2, hy + hr * 0.6, 0.42 * B, -S + bodyH * 0.5]).fill(fill);
  g.ellipse(hx + hr * 0.4, hy, hr * 1.3, hr * 0.75).fill(fill);
  const eh = ref.ears * B;
  if (eh > 0) g.poly([hx - hr * 0.2, hy - hr * 0.4, hx, hy - hr * 0.4 - eh, hx + hr * 0.3, hy - hr * 0.5]).fill(fill);
  return c;
}

/** 剪影上方的名字签。字号按像素给，所以由调用的人每帧摆位置（不跟着剪影缩放）。 */
export function referenceLabel(ref: ReferenceAnimal, color: number): Text {
  const kg = ref.massKg < 1 ? `${Math.round(ref.massKg * 1000)} 克` : `${ref.massKg} 千克`;
  return new Text({ text: `${ref.name} · ${kg}`, style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fill: color } });
}

/** 剪影的头在哪（米，y 朝上）和头的大小：脖子往前上方斜伸出去。 */
export function referenceHead(ref: ReferenceAnimal): { x: number; y: number; r: number } {
  const B = ref.bodyLengthM;
  const bodyH = Math.max(B * 0.16, ref.shoulderM * 0.32);
  const n = ref.neck * B;
  return { x: 0.42 * B + n * 0.7, y: ref.shoulderM + bodyH * 0.4 + n * 0.75, r: Math.max(B * 0.1, bodyH * 0.5) };
}

/** 剪影的高度（米）：放名字签、算镜头用。 */
export function referenceHeightM(ref: ReferenceAnimal): number {
  const h = referenceHead(ref);
  return h.y + h.r * 0.75 + ref.ears * ref.bodyLengthM;
}
