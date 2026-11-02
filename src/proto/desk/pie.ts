import { Container, Graphics, Text } from 'pixi.js';
import { BODY_SYSTEMS, type BodySystem } from '../../data/schema/viability';
import type { BodyAllocation } from '../../sim';
import { BLUEPRINT } from '../../render/palette';

/**
 * 体重分配纸饼（设计台第 2 步 b，`docs/feel/desk.md`）。
 *
 * 五瓣等角的"花瓣"，每瓣的面积 ∝ 这个系统的实际倍数（allocateBody 的 relative）：默认是一圈一样大的瓣，
 * 虚线圈是"×1"。按住一瓣往外拖就是多给它，总量不变，别的瓣按比例一起缩——缩多少看它占体重多少：
 * 多给心脏（默认不到体重的 1%）别的几乎不缩，多给肌肉（近一半）别的都缩一圈。
 *
 * 不用"拖瓣与瓣之间的边界"的普通饼图：心血管只占体重的 0.5% 左右，在饼上是一条 2° 的细缝，手指按不住。
 */

/** 每个系统的颜色（纸色系，和以后的 X 光层一致；不用朱红，朱红留给警报）。 */
export const SYSTEM_COLORS: Record<BodySystem, number> = {
  skeleton: 0xe9e1cd,
  muscle: 0xc8907e,
  gut: 0xc9a76c,
  heart: 0xa8736b,
  fat: 0xeccf92,
};
const INK = 0x5a4632;
const GAP = 0.07;

/**
 * 想让系统 s 的实际倍数变成 target，它要的倍数（design.allocation[s]）该是多少：其他系统要的倍数不变。
 * 实际倍数 = 要的倍数 × 总量 ÷ Σ(默认份额 × 要的倍数)（allocateBody），解出来是 target · 其余 ÷ (总量 − target · 默认份额)。
 * 结果夹在 [lo, hi]（viability.json 的可调范围）。
 */
export function requestFor(s: BodySystem, target: number, base: Readonly<Record<BodySystem, number>>, req: Readonly<Record<BodySystem, number>>, lo: number, hi: number): number {
  let total = 0;
  let others = 0;
  for (const k of BODY_SYSTEMS) {
    total += base[k];
    if (k !== s) others += base[k] * req[k];
  }
  const den = total - target * base[s];
  const r = den <= 0 ? hi : (target * others) / den;
  return Math.min(hi, Math.max(lo, r));
}

export class AllocPie {
  readonly view = new Container();
  private readonly g = new Graphics();
  private readonly labels = new Map<BodySystem, Text>();
  private readonly value = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: BLUEPRINT, fontWeight: '600' } });
  private readonly title = new Text({ text: '体重分配', style: { fontFamily: 'system-ui, sans-serif', fontSize: 12, fill: 0x8a7458, fontWeight: '600' } });
  /** 中心（屏幕）和"×1"的半径。 */
  cx = 0;
  cy = 0;
  r0 = 50;

  constructor(private readonly names: Record<BodySystem, string>) {
    this.view.addChild(this.g, this.title, this.value);
    for (const s of BODY_SYSTEMS) {
      const t = new Text({ text: names[s], style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0x6e5a44 } });
      this.labels.set(s, t);
      this.view.addChild(t);
    }
  }

  /** 第 i 瓣的中线角（从正上方顺时针）。 */
  private mid(i: number): number {
    return -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / BODY_SYSTEMS.length;
  }

  /** 点 (x, y) 落在哪一瓣（整个圆按角度分，缩得很小的瓣也按得住）；不在饼上返回 null。 */
  hit(x: number, y: number): BodySystem | null {
    const dx = x - this.cx;
    const dy = y - this.cy;
    if (Math.hypot(dx, dy) > this.r0 * 1.5 + 8) return null;
    let a = Math.atan2(dy, dx) + Math.PI / 2;
    a = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return BODY_SYSTEMS[Math.min(BODY_SYSTEMS.length - 1, Math.floor((a / (2 * Math.PI)) * BODY_SYSTEMS.length))]!;
  }

  /** 手指离中心多远 → 想要的实际倍数（面积 ∝ 倍数，所以是距离的平方）。 */
  targetAt(x: number, y: number): number {
    const d = Math.hypot(x - this.cx, y - this.cy) / this.r0;
    return Math.min(4, Math.max(0.2, d * d));
  }

  /** 画：active 是正在拖（或指着）的那一瓣，写出它的倍数和重量。 */
  draw(alloc: BodyAllocation, massKg: number, active: BodySystem | null, kgText: (kg: number) => string): void {
    const g = this.g.clear();
    const n = BODY_SYSTEMS.length;
    const span = (2 * Math.PI) / n;
    // 纸垫。
    const rMax = this.r0 * Math.SQRT2;
    g.circle(this.cx, this.cy, rMax + 6).fill({ color: 0xf6eedc, alpha: 0.85 }).stroke({ color: 0xcdbb9a, width: 1 });
    BODY_SYSTEMS.forEach((s, i) => {
      const rel = alloc.relative[s];
      const r = Math.min(rMax + 4, this.r0 * Math.sqrt(rel));
      const a0 = this.mid(i) - span / 2 + GAP / 2;
      const a1 = this.mid(i) + span / 2 - GAP / 2;
      g.moveTo(this.cx, this.cy).arc(this.cx, this.cy, r, a0, a1).closePath();
      g.fill({ color: SYSTEM_COLORS[s] }).stroke({ color: INK, width: s === active ? 2 : 1.2, alpha: 0.85 });
      const t = this.labels.get(s)!;
      const lr = rMax + 14;
      t.position.set(Math.round(this.cx + Math.cos(this.mid(i)) * lr - t.width / 2), Math.round(this.cy + Math.sin(this.mid(i)) * lr - t.height / 2));
      t.style.fontWeight = s === active ? '700' : '400';
    });
    // "×1"的虚线圈（蓝图蓝的墨线：默认是多大）。
    const dash = 28;
    for (let k = 0; k < dash; k += 2) g.arc(this.cx, this.cy, this.r0, (k / dash) * 2 * Math.PI, ((k + 1) / dash) * 2 * Math.PI).stroke({ color: BLUEPRINT, width: 1, alpha: 0.55 });
    this.title.position.set(Math.round(this.cx - this.title.width / 2), Math.round(this.cy - rMax - 34));
    this.value.visible = active !== null;
    if (active) {
      this.value.text = `${this.names[active]} ×${alloc.relative[active].toFixed(2)} · ${kgText(alloc.share[active] * massKg)}`;
      this.value.position.set(Math.round(this.cx - this.value.width / 2), Math.round(this.cy + rMax + 28));
    }
  }
}
