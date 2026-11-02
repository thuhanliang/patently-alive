import { Container, Graphics, Text } from 'pixi.js';
import type { GaitRules } from '../../data/schema/gait';
import type { CompiledDesign } from '../../sim';

/**
 * 一天的饭量（设计台第 3 步 c，`docs/feel/desk.md`）：能量收支换成"一天要吃多少克"，按纸偶的比例尺堆在它脚边。
 *
 * - 克数 = 一天的开销 × 这类食物在食谱里的份额 ÷ 消化率 ÷ 每克鲜重的总能（gait.json 的 food）；
 * - 冷热试验里冷得要多产热时，开销按冷热检查的 extraHeat 加上去（发抖要多吃）；
 * - 每类食物堆成一个半球形的小堆，体积 = 克数（按每立方厘米 1 克），和纸偶用同一个比例尺：猫一天一小堆肉，大象一座草山。
 * 只读编译结果，不改推演。
 */

export type FoodKind = 'plant' | 'vertebrate' | 'invertebrate';
export const FOOD_KINDS: readonly FoodKind[] = ['plant', 'vertebrate', 'invertebrate'];
const FOOD_NAMES: Record<FoodKind, string> = { plant: '植物', vertebrate: '肉', invertebrate: '虫' };
/** 田野笔记的平涂色：植物草绿、肉赭红、虫深褐（不用朱红，朱红留给警报）。 */
const FOOD_COLORS: Record<FoodKind, number> = { plant: 0xa9b67a, vertebrate: 0xb9796a, invertebrate: 0x7b6650 };
const INK = 0x5a4632;

export interface DailyFood {
  /** 每类一天要吃多少克（鲜重）。 */
  grams: Record<FoodKind, number>;
  /** 因为冷多吃的比例（0 是不冷）。 */
  cold: number;
}

/** 一天要吃多少：selective 是口器能挑着吃（种子、嫩芽），植物的每克能量按"挑着吃"算。 */
export function dailyFood(c: CompiledDesign, selective: boolean, food: GaitRules['food']): DailyFood {
  const th = c.viability.find((r) => r.id === 'thermal' && !r.skipped);
  const cold = th?.evidence.extraHeat ?? 0;
  const need = (c.energy.needKjPerDay * (1 + cold)) / Math.max(1e-6, c.energy.digestibility);
  const density: Record<FoodKind, number> = { plant: selective ? food.plantSelect.value : food.plantGrass.value, vertebrate: food.vertebrate.value, invertebrate: food.invertebrate.value };
  const grams = {} as Record<FoodKind, number>;
  for (const k of FOOD_KINDS) grams[k] = (need * c.params.diet[k]) / density[k];
  return { grams, cold };
}

/** 克数写成好读的样子。 */
export function gramText(g: number): string {
  if (g >= 1000) return `${(g / 1000).toFixed(g >= 10000 ? 0 : 1)} 千克`;
  if (g >= 10) return `${Math.round(g)} 克`;
  return `${g.toFixed(1)} 克`;
}

/** 半球形一堆的半径（米）：体积 = 克数（立方厘米）。 */
export const heapRadiusM = (g: number): number => Math.cbrt((3 * g) / (2 * Math.PI)) / 100;

export class FoodPile {
  readonly view = new Container();
  private readonly g = new Graphics();
  private readonly label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0x6e5a44, align: 'center' } });

  constructor() {
    this.view.addChild(this.g, this.label);
  }

  /** x：第一堆的左边（屏幕）；gy：地面；z：每米多少像素。份额不到 3% 的不画。 */
  draw(f: DailyFood, x: number, gy: number, z: number): void {
    const g = this.g.clear();
    const parts: string[] = [];
    let cx = x;
    let top = gy;
    for (const k of FOOD_KINDS) {
      const grams = f.grams[k];
      const total = f.grams.plant + f.grams.vertebrate + f.grams.invertebrate;
      if (grams <= 0 || grams < 0.03 * total) continue;
      // 太小的堆至少画 3 像素（老鼠的一口虫子也看得见）。
      const r = Math.max(3, heapRadiusM(grams) * z);
      cx += r;
      g.moveTo(cx - r, gy).arc(cx, gy, r, Math.PI, 2 * Math.PI).closePath();
      g.fill({ color: FOOD_COLORS[k] }).stroke({ color: INK, width: 1.2, alpha: 0.85 });
      // 一点纹样：植物几笔草、肉一道纹、虫几个点（田野笔记的平涂 + 墨线）。
      if (r > 8) {
        if (k === 'plant') for (const t of [-0.45, 0, 0.45]) g.moveTo(cx + t * r, gy - 0.25 * r).lineTo(cx + t * r + 0.12 * r, gy - 0.75 * r);
        else if (k === 'vertebrate') g.moveTo(cx - 0.5 * r, gy - 0.4 * r).quadraticCurveTo(cx, gy - 0.75 * r, cx + 0.5 * r, gy - 0.4 * r);
        else for (const t of [-0.4, 0, 0.4]) g.circle(cx + t * r, gy - 0.4 * r - Math.abs(t) * -0.2 * r, Math.max(1, 0.06 * r));
        g.stroke({ color: INK, width: 1, alpha: 0.55 });
      }
      cx += r + 4;
      top = Math.min(top, gy - r);
      parts.push(`${FOOD_NAMES[k]} ${gramText(grams)}`);
    }
    this.label.text = `一天要吃\n${parts.join(' · ')}${f.cold > 0.005 ? `\n（冷，多吃 ${Math.round(f.cold * 100)}%）` : ''}`;
    this.label.position.set(Math.round((x + cx - 4) / 2 - this.label.width / 2), Math.round(top - this.label.height - 6));
  }
}
