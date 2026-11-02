import { describe, expect, it } from 'vitest';
import { DesignSchema, designTemplates, morphLibrary, type Design } from '../src/data';
import { EAR_TIP_CAT } from '../src/render/puppet/plan';
import { appearanceFor, isMorph } from '../src/proto/desk/tray';

// 部件托盘（设计台第 2 步 c）：形状卡是参数空间里的点，扣上去就是整组参数；设计的写法不变。
const cat = designTemplates.find((t) => t.species === 'cat')!.design;
const withCard = (d: Design, id: string): Design => {
  const a = appearanceFor(morphLibrary.find((m) => m.id === id)!, EAR_TIP_CAT);
  const out: Design = { ...d };
  if (a) out.appearance = a;
  else delete out.appearance;
  return out;
};

describe('形状卡', () => {
  it('有耳卡，id 不重复，两两不同', () => {
    const ears = morphLibrary.filter((m) => m.region === 'ear');
    expect(ears.length).toBeGreaterThanOrEqual(8);
    const keys = ears.map((m) => JSON.stringify(m.appearance));
    expect(new Set(keys).size).toBe(ears.length);
  });

  it('扣上任何一张，设计照样过 schema，而且就是这张卡', () => {
    for (const m of morphLibrary) {
      const d = withCard(cat, m.id);
      expect(() => DesignSchema.parse(d), m.id).not.toThrow();
      expect(isMorph(d, m, EAR_TIP_CAT), m.id).toBe(true);
      for (const o of morphLibrary) if (o !== m) expect(isMorph(d, o, EAR_TIP_CAT), `${m.id} 不是 ${o.id}`).toBe(false);
    }
  });

  it('整组替换：前一张卡留下的值不会混进来', () => {
    const a = withCard(withCard(cat, 'ear_side'), 'ear_drop');
    const b = withCard(cat, 'ear_drop');
    expect(a.appearance).toEqual(b.appearance);
  });

  it('猫扣上"小三角立耳"和没动过的猫写法一样（不写 appearance）', () => {
    const d = withCard(withCard(cat, 'ear_drop'), 'ear_small_pointed');
    expect(d.appearance).toBeUndefined();
    expect(d).toEqual(cat);
  });
});
