import type { Goal } from '../data';
import type { ScoreDetail, ScoreKey, Scores } from '../sim';

/** 五项评分的名字和一句话说明。公式在引擎（src/sim/score.ts），这里只管措辞。 */
export const SCORE_LABELS: Record<ScoreKey, string> = {
  recovery: '恢复',
  stability: '稳定度',
  diversity: '多样性',
  cost: '花费',
  welfare: '福利',
};

const pct = (x: number): string => `${Math.round(x * 100)}%`;

export function scoreNote(key: ScoreKey, d: ScoreDetail, goal: Goal, names: readonly string[], targetName: string): string {
  switch (key) {
    case 'recovery':
      return d.targetRatio === null
        ? `第一年：记下${targetName}各季的数量作基准，第二年起评`
        : `${targetName}是第一年同季的 ${d.targetRatio.toFixed(2)} 倍（目标 ${goal.recovery} 倍）`;
    case 'stability':
      return d.boom === null
        ? '第一年不评：开局数量离平衡远，第二年起和去年同期比'
        : d.boom.ratio <= 1
          ? '外来物种都没有比去年同期多'
          : `外来物种里${names[d.boom.species]}涨得最多：去年同期的 ${d.boom.ratio.toFixed(2)} 倍`;
    case 'diversity': {
      const low = d.nativesLow.map((s) => names[s]).join('、');
      return `${low ? `${low}不到开局的一半` : '本地物种都还在'}；灌丛是开局的 ${pct(d.habitat)}`;
    }
    case 'cost':
      return `花掉了拿到的经费的 ${pct(d.spentShare)}`;
    case 'welfare':
      return `近期的死亡里，饿死和被处死的占 ${pct(d.sufferingShare)}（各物种平均）`;
  }
}

/** 一行评分：名字、分数条、说明。 */
export function scoreRows(scores: Scores, detail: ScoreDetail, goal: Goal, names: readonly string[], targetName: string): HTMLElement {
  const table = document.createElement('div');
  table.className = 'score-table';
  for (const key of Object.keys(SCORE_LABELS) as ScoreKey[]) {
    const v = scores[key];
    const label = document.createElement('span');
    label.textContent = SCORE_LABELS[key];
    const bar = document.createElement('span');
    bar.className = 'score-bar';
    const fill = document.createElement('span');
    fill.style.width = `${v ?? 0}%`;
    bar.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'score-value';
    value.textContent = v === null ? '—' : String(v);
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = scoreNote(key, detail, goal, names, targetName);
    table.append(label, bar, value, note);
  }
  return table;
}
