import type { Alert } from '../sim';

/** 警报的一句话说明。规则和轻重由引擎定（src/sim/alerts.ts），这里只管措辞。 */
export function alertText(a: Alert, names: readonly string[]): string {
  const name = names[a.species] ?? '';
  switch (a.kind) {
    case 'nearExtinct':
      return `${name}只剩 ${Math.round(a.value)} 只，不到开局的一成`;
    case 'decline':
      return `${name}比去年同期少了 ${Math.round(a.value * 100)}%`;
    case 'famine':
      return `${name}近期的死亡里，${Math.round(a.value * 100)}% 是饿死的`;
    case 'lowSatisfaction':
      return `业主满意度只有 ${Math.round(a.value)}`;
    case 'lowBudget':
      return `预算只剩 ${Math.round(a.value)}，连最便宜的工具都用不起了`;
  }
}

/** 同一条警报（种类 + 物种）算不算"换了"：数值每天在变，只有这两样变了才记一行日志。 */
export function alertKey(a: Alert | undefined): string {
  return a ? `${a.kind}:${a.species}` : '';
}
