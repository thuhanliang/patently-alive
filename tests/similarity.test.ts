import { describe, expect, it } from 'vitest';
import { speciesLibrary } from '../src/data';
import { SUBSTANTIALLY_SAME, compare, nearest, traitsOf } from '../src/sim/similarity';

const all = [...speciesLibrary.values()];
const sp = (id: string) => speciesLibrary.get(id)!;

describe('性状相似度', () => {
  it('和自己完全一样，相似度为 1，没有差距', () => {
    for (const s of all) {
      const m = compare(traitsOf(s), s.id, s);
      expect(m.similarity).toBeCloseTo(1, 12);
      expect(m.differences.every((d) => d.distance === 0)).toBe(true);
    }
  });

  it('不同的真实物种之间都不算"实质相同"', () => {
    for (const s of all) {
      const [best] = nearest(traitsOf(s), all, 1, [s.id]);
      expect(best!.similarity, `${s.id} ~ ${best!.id}`).toBeLessThan(SUBSTANTIALLY_SAME);
    }
  });

  it('近亲最像：鼠找鼠，鼬找鼬，猫找食肉动物', () => {
    const top = (id: string) => nearest(traitsOf(sp(id)), all, 2, [id]).map((m) => m.id);
    expect(top('rat')).toEqual(expect.arrayContaining(['brownrat']));
    expect(['kiore', 'brownrat', 'mouse']).toContain(top('rat')[1]);
    expect(top('stoat')[0]).toBe('weasel');
    expect(['fox', 'ferret']).toContain(top('cat')[0]);
  });

  it('只给一部分性状时只在这几项上比', () => {
    // 只问"约 150 克、以植物为主"：船鼠应该排在最前面几名。
    const q = { bodyMassKg: 0.15, diet: { plant: 0.7, vertebrate: 0.1, invertebrate: 0.2 } };
    const m = compare(q, 'rat', sp('rat'));
    expect(m.similarity).toBeCloseTo(1, 12);
    expect(m.differences.map((d) => d.key).sort()).toEqual(['bodyMassKg', 'diet']);
    expect(nearest(q, all, 1)[0]!.id).toBe('rat');
  });

  it('一项性状也没给时相似度为 0', () => {
    expect(compare({}, 'rat', sp('rat')).similarity).toBe(0);
  });

  it('差距最大的性状排在 differences 最前面', () => {
    // 一只"会飞的船鼠"：和船鼠只差会不会飞。
    const m = compare({ ...traitsOf(sp('rat')), flies: true }, 'rat', sp('rat'));
    expect(m.differences[0]).toEqual({ key: 'flies', distance: 1 });
    expect(m.similarity).toBeLessThan(1);
    expect(m.similarity).toBeGreaterThan(0.8);
  });

  it('结果确定：顺序与输入顺序无关，相同相似度按 id 排', () => {
    const q = traitsOf(sp('cat'));
    const a = nearest(q, all, all.length);
    const b = nearest(q, [...all].reverse(), all.length);
    expect(b).toEqual(a);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.similarity).toBeGreaterThanOrEqual(a[i]!.similarity);
  });
});
