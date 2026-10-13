import { ageClass, EMPTY_STOMACH, GOOD_BCS, THIN_BCS, type AgeClass, type DerivedSpecies, type Exam } from '../sim';

/**
 * 检查卡上的措辞：把引擎量出来的数（src/sim/exam.ts）写成兽医的说法。只管措辞，不算任何指标。
 */

const AGE_WORDS: Record<AgeClass, string> = {
  juvenile: '未成年',
  young: '青年',
  prime: '壮年',
  old: '老年',
};

export function massText(kg: number): string {
  return kg < 1 ? `${Math.round(kg * 1000)} 克` : `${kg.toFixed(2)} 千克`;
}

export function bcsText(bcs: number): string {
  // 偏瘦的界线用引擎的 THIN_BCS（抽样推断按它数"偏瘦"）；其余几档只是措辞。
  const word = bcs <= THIN_BCS - 0.5 ? '极瘦' : bcs <= THIN_BCS ? '偏瘦' : bcs <= GOOD_BCS ? '正常' : bcs <= 4 ? '偏胖' : '肥胖';
  return `${bcs.toFixed(1)} / 5（${word}）`;
}

export function ageText(sp: DerivedSpecies, exam: Exam): string {
  const cls = ageClass(sp, exam.ageDays, exam.juvenile);
  // 估年龄的办法：鸟看羽色和喙，哺乳动物看牙齿磨损。
  const how = sp.params.movement.flies ? '按羽色估计' : '按牙齿磨损估计';
  return `${AGE_WORDS[cls]}（${how}）`;
}

/** 胃内容物的一句话描述。species 用来写残骸是谁的。 */
export function stomachText(exam: Exam, species: readonly DerivedSpecies[]): string {
  const st = exam.stomach;
  if (st.fullness < EMPTY_STOMACH) return '胃基本是空的';
  const fullness = st.fullness < 0.4 ? '少量' : st.fullness < 0.75 ? '半满' : '饱满';
  const parts: { share: number; text: string }[] = [];
  if (st.plant > 0.05) parts.push({ share: st.plant, text: '植物碎屑（草叶、种子）' });
  if (st.invertebrate > 0.05) parts.push({ share: st.invertebrate, text: '昆虫等无脊椎动物残片' });
  if (st.prey >= 0 && st.vertebrate > 0) {
    const prey = species[st.prey]!;
    const name = prey.params.name;
    const remains = st.preyNest
      ? prey.params.movement.flies
        ? `${name}的蛋壳或雏鸟残骸`
        : `${name}的幼崽残骸`
      : prey.params.movement.flies
        ? `${name}的羽毛和骨骼`
        : `${name}的毛发和骨骼`;
    parts.push({ share: st.vertebrate, text: remains });
  }
  if (st.prey < 0 && st.vertebrate > 0) parts.push({ share: st.vertebrate, text: '认不出是谁的肉和骨渣' });
  parts.sort((a, b) => b.share - a.share);
  const list = parts.map((p) => `${p.text} 约 ${Math.round(p.share * 10) * 10}%`).join('，');
  return `${fullness}：${list}`;
}
