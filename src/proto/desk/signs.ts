import { GRADES, type CheckId, type CheckResult, type Grade } from '../../sim';

/**
 * 体征（设计台第 3 步 a，`docs/feel/desk.md`）：可行性检查的结果长在纸偶身上，不改推演，只读 compiled.viability。
 *
 * - 骨骼吃力 → 跑起来跛；撑不住 → 走路也跛；致命 → 站不起来，只能趴着；
 * - 消化不够 → 瘦（躯干的纸片变薄、肚子收进去）；
 * - 繁殖吃力 → 带崽的母亲也瘦一点；
 * - 冷热（只在冷热试验里，给了气温才有）→ 冷了发抖、热了张嘴喘。
 *
 * 每个体征在身上挂一张小纸签；同一时间只有最重的那张是朱红（CLAUDE.md"同一时间只有一处最响的警报"），其余是墨色。
 */

export const CHECK_NAMES: Record<CheckId, string> = { skeleton: '骨骼', digestion: '消化', reproduction: '繁殖', thermal: '冷热' };
export const GRADE_NAMES: Record<Grade, string> = { ok: '没问题', strained: '吃力', failing: '撑不住', fatal: '致命' };

/** 纸签上写什么（按检查和等级；冷热还要看是哪一头，见 labelOf）。 */
const LABELS: Record<Exclude<CheckId, 'thermal'>, Record<Exclude<Grade, 'ok'>, string>> = {
  skeleton: { strained: '跑起来跛', failing: '跛', fatal: '站不起来' },
  digestion: { strained: '偏瘦', failing: '瘦', fatal: '皮包骨' },
  reproduction: { strained: '生养吃力', failing: '生养困难', fatal: '生养不成' },
};
const COLD: Record<Exclude<Grade, 'ok'>, string> = { strained: '发抖', failing: '冻得受不了', fatal: '会冻死' };
const HOT: Record<Exclude<Grade, 'ok'>, string> = { strained: '喘', failing: '热得受不了', fatal: '会中暑' };

const labelOf = (c: CheckResult, g: Exclude<Grade, 'ok'>): string => (c.id === 'thermal' ? (c.evidence.cold ? COLD : HOT)[g] : LABELS[c.id][g]);

export interface Sign {
  id: CheckId;
  grade: Exclude<Grade, 'ok'>;
  label: string;
  /** 最重的那一个（朱红）。 */
  loudest: boolean;
  margin: number;
  hintIds: string[];
}

const rank = (g: Grade): number => GRADES.indexOf(g);

/** 没问题的检查不挂签；等级一样重时按检查的顺序（骨骼 → 消化 → 繁殖）取第一个当最响的。 */
export function signsOf(checks: readonly CheckResult[]): Sign[] {
  const out: Sign[] = [];
  for (const c of checks) {
    if (c.grade === 'ok' || c.skipped) continue;
    out.push({ id: c.id, grade: c.grade, label: labelOf(c, c.grade), loudest: false, margin: c.margin, hintIds: c.hints.map((h) => h.id) });
  }
  let top: Sign | null = null;
  for (const s of out) if (!top || rank(s.grade) > rank(top.grade)) top = s;
  if (top) top.loudest = true;
  return out;
}

const gradeOf = (checks: readonly CheckResult[], id: CheckId): Grade => checks.find((c) => c.id === id && !c.skipped)?.grade ?? 'ok';

/** 躯干变薄多少（1 = 不变）：消化不够最明显，带崽吃力的母亲轻一点；两样都有取更瘦的。 */
export function thinOf(checks: readonly CheckResult[]): number {
  const gut: Record<Grade, number> = { ok: 1, strained: 0.9, failing: 0.8, fatal: 0.7 };
  const rep: Record<Grade, number> = { ok: 1, strained: 0.95, failing: 0.9, fatal: 0.85 };
  return Math.min(gut[gradeOf(checks, 'digestion')], rep[gradeOf(checks, 'reproduction')]);
}

/** 跛得多厉害（0 不跛）：骨骼吃力只在跑、跳时跛，撑不住时走路也跛、跑起来更厉害。 */
export function limpOf(checks: readonly CheckResult[], fast: boolean, moving: boolean): number {
  if (!moving) return 0;
  const g = gradeOf(checks, 'skeleton');
  if (g === 'strained') return fast ? 0.6 : 0;
  if (g === 'failing' || g === 'fatal') return fast ? 1 : 0.7;
  return 0;
}

/**
 * 冷热的样子（0 没有）：发抖的幅度、喘的程度。吃力 0.5、撑不住 0.8、致命 1；只在给了气温（冷热试验）时才有。
 */
export function thermalOf(checks: readonly CheckResult[]): { shiver: number; pant: number } {
  const c = checks.find((x) => x.id === 'thermal' && !x.skipped);
  if (!c || c.grade === 'ok') return { shiver: 0, pant: 0 };
  const k = c.grade === 'strained' ? 0.5 : c.grade === 'failing' ? 0.8 : 1;
  return c.evidence.cold ? { shiver: k, pant: 0 } : { shiver: 0, pant: k };
}

/** 站不起来：只能趴着。 */
export const cannotStand = (checks: readonly CheckResult[]): boolean => gradeOf(checks, 'skeleton') === 'fatal';
