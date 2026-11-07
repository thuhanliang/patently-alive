import { describe, expect, it } from 'vitest';
import { designTemplates, gaitRules, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { compileDesign, makeDesignKit } from '../src/sim';
import { dailyFood } from '../src/proto/desk/food';
import { ReceiptDiff, SETTLE_MS, kjText, receiptRows } from '../src/proto/desk/receipt';

/** 能量小票（设计台第 4 步 a）：只打编译结果里的数，和饭堆对得上。 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const template = (s: string): Design => designTemplates.find((t) => t.species === s)!.design;
const rowsOf = (d: Design, temperatureC?: number) => {
  const c = compileDesign(d, kit, temperatureC === undefined ? undefined : { climate: { temperatureC } });
  const food = dailyFood(c, partLibrary.get(d.parts.mouth)!.selective === true, gaitRules.food);
  return { c, food, rows: receiptRows(c, food) };
};
const val = (rows: ReturnType<typeof receiptRows>, key: string): number => rows.find((r) => r.key === key)!.value;

describe('能量小票', () => {
  it('17 条现有技术：各行加起来就是一天的开销；要吃进去的 = 烧掉的 ÷ 消化率；克数和饭堆一样', () => {
    for (const t of designTemplates) {
      const { c, food, rows } = rowsOf(t.design);
      const items = rows.filter((r) => r.kind === 'item').reduce((s, r) => s + r.value, 0);
      expect(items).toBeCloseTo(c.energy.needKjPerDay, 6);
      expect(val(rows, 'burn')).toBeCloseTo(c.energy.needKjPerDay, 6);
      expect(val(rows, 'intake')).toBeCloseTo(c.energy.needKjPerDay / c.energy.digestibility, 6);
      for (const r of rows.filter((x) => x.kind === 'food')) expect(r.value).toBe(food.grams[r.key.slice(5) as keyof typeof food.grams]);
      expect(rows[0]!.label.startsWith('日常代谢')).toBe(true);
    }
  });

  it('冷的时候多一行"发抖多烧"，合计跟着加上；不试冷热没有这一行', () => {
    const bare = { ...template('cat'), shape: { fur: -1 } };
    expect(rowsOf(bare).rows.some((r) => r.key === 'cold')).toBe(false);
    const { c, food, rows } = rowsOf(bare, 0);
    expect(food.cold).toBeGreaterThan(0);
    expect(val(rows, 'cold')).toBeCloseTo(c.energy.needKjPerDay * food.cold, 6);
    expect(val(rows, 'burn')).toBeCloseTo(c.energy.needKjPerDay * (1 + food.cold), 6);
  });

  it('换尾巴：只有尾巴那几行和合计变；腿长、腿短是同一行', () => {
    const cat = template('cat');
    const a = rowsOf(cat).rows;
    const b = rowsOf({ ...cat, parts: { ...cat.parts, tail: 'bushy_tail' } }).rows;
    expect(b.some((r) => r.key === '蓬松大尾')).toBe(true);
    expect(val(b, '日常代谢（兽）')).toBe(val(a, '日常代谢（兽）'));
    const long = rowsOf({ ...cat, shape: { leg: 0.1 } }).rows.find((r) => r.key === '腿长')!;
    const short = rowsOf({ ...cat, shape: { leg: -0.1 } }).rows.find((r) => r.key === '腿长')!;
    expect(long.label).not.toBe(short.label);
    expect(Math.sign(long.value)).toBe(-Math.sign(short.value));
  });

  it('▲ ▼ 记的是这一下总共变了多少：拖着时起点不动，手停下来一会儿以后以现在为起点', () => {
    const cat = template('cat');
    const d = new ReceiptDiff();
    d.update(rowsOf(cat).rows, 0);
    expect(d.delta('burn')).toBe(0);
    const base = val(rowsOf(cat).rows, 'burn');
    // 拖体重：一帧一帧地变，起点一直是拖之前的。
    d.update(rowsOf({ ...cat, bodyMassKg: 5 }).rows, 100);
    d.update(rowsOf({ ...cat, bodyMassKg: 8 }).rows, 200);
    expect(d.delta('burn')).toBeCloseTo(val(rowsOf({ ...cat, bodyMassKg: 8 }).rows, 'burn') - base, 6);
    expect(d.delta('burn')).toBeGreaterThan(0);
    d.settle(200 + SETTLE_MS - 1);
    expect(d.delta('burn')).not.toBe(0);
    d.settle(200 + SETTLE_MS);
    expect(d.delta('burn')).toBe(0);
    // 新出现的一行（换上蓬松大尾）记成"新"。
    d.update(rowsOf({ ...cat, bodyMassKg: 8, parts: { ...cat.parts, tail: 'bushy_tail' } }).rows, 5000);
    expect(Number.isNaN(d.delta('蓬松大尾'))).toBe(true);
  });

  it('千焦的写法', () => {
    expect(kjText(-55.3, true)).toBe('−55');
    expect(kjText(1843.5, false)).toBe('1844');
    expect(kjText(3.04, true)).toBe('+3.0');
    expect(kjText(123456, false)).toBe('123 千');
  });
});
