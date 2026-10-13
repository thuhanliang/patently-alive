import type { NecropsyTemplates } from '../data';
import { GOOD_BCS, THIN_BCS, type Carcass, type DerivedSpecies, type NecropsyFindings } from '../sim';

/**
 * 按模板（src/data/reports/necropsy.json）把尸检所见拼成临床口吻的报告。只管措辞，证据由引擎给出。
 *
 * 能用的占位符：{species} {subject} {x} {y} {days} {n} {bcs} {size} {remains} {teeth} {size_match} {matches}。
 * 蛋壳还是幼崽残骸按会不会飞粗分（数据里还没有"卵生"这个性状）。
 */
export const PLACEHOLDERS = ['species', 'subject', 'x', 'y', 'days', 'n', 'bcs', 'size', 'remains', 'teeth', 'size_match', 'matches'] as const;

type Vars = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;

export function fill(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (vars as Record<string, string | undefined>)[key] ?? whole);
}

export interface ReportSection {
  heading: string;
  text: string;
}

export function necropsyReport(
  t: NecropsyTemplates,
  carcass: Carcass,
  f: NecropsyFindings,
  species: readonly DerivedSpecies[],
): ReportSection[] {
  const sp = species[f.species]!;
  const egg = sp.params.movement.flies === true;
  const vars: Vars = {
    species: sp.params.name,
    x: String(carcass.x),
    y: String(carcass.y),
    days: carcass.daysDead === 0 ? t.days.today : fill(t.days.ago, { n: String(carcass.daysDead) }),
    bcs: f.bcs.toFixed(1),
  };
  vars.subject = fill(f.kind === 'nest' ? (egg ? t.subject.nestEgg : t.subject.nestYoung) : t.subject.carcass, vars);
  if (f.bite) {
    vars.size = f.bite.sizeMm.toFixed(1);
    vars.remains = egg ? t.remains.egg : t.remains.young;
    vars.teeth = t.teeth[f.bite.teeth];
    vars.matches = f.bite.matches.map((i) => species[i]!.params.name).join(t.listSeparator);
    vars.size_match = f.bite.matches.length > 0 ? fill(t.sizeMatch, vars) : t.sizeMatchNone;
  }
  // 蛋壳和残巢没有体况可评。
  const condition =
    f.kind === 'nest' ? '' : f.bcs <= THIN_BCS ? t.condition.thin : f.bcs <= GOOD_BCS ? t.condition.normal : t.condition.good;
  const decomposition = (f.kind === 'nest' ? t.decompositionNest : t.decomposition)[f.decomposition];
  const findings =
    f.kind === 'starvation' || f.kind === 'other' ? t.findings[f.kind] : t.findings[`${f.kind}_${f.bite!.teeth}` as const];
  const h = t.headings;
  return [
    { heading: h.intro, text: fill(t.intro, vars) },
    { heading: h.appearance, text: `${decomposition}${fill(condition, vars)}` },
    { heading: h.findings, text: fill(findings, vars) },
    { heading: h.conclusion, text: fill(t.conclusion[f.kind], vars) },
  ];
}
