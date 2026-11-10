import { it } from 'vitest';
import { type Design, designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, scenarioLibrary, speciesFor, tools, viabilityRules, worldFor } from '../src/data';
import { Session, TICKS_PER_DAY, QUARTER_DAYS, cellIndex, compileDesign, designDataOf, makeDesignKit, scenarioRules, withRelativeLitter } from '../src/sim';
import { mainCause, causeText, deadOf, replyKeyOf } from '../src/ui/verdict';

/**
 * 花园岛的验收实验：每个兽类模板（和几种改过的）各放 20 只，什么别的都不做，看三年后委托人回哪封信。
 * 用来检查第一份委托"做得成、也做得败，而且说得出为什么"。npx vitest run --config vitest.sweep.config.ts scripts/garden.bench.ts
 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const scenario = scenarioLibrary.get('garden-island')!;
const world = worldFor(scenario);
const base = (id: string): Design => withRelativeLitter(designTemplates.find((t) => t.species === id)!.design, kit);
const CASES: Array<[string, Design]> = [
  ...designTemplates.filter((t) => t.design.parts.coat !== 'feathers').map((t) => [t.design.name, base(t.species)] as [string, Design]),
  ['猫 + 研磨臼齿 + 后肠发酵', { ...base('cat'), parts: { ...base('cat').parts, mouth: 'grinding_molars', digestion: 'hindgut_fermenter' } }],
  ['猫 + 杂食齿 + 单胃', { ...base('cat'), parts: { ...base('cat').parts, mouth: 'mixed_teeth', digestion: 'simple_stomach' } }],
  ['30 千克的兔', { ...base('rabbit'), bodyMassKg: 30 }],
  ['300 千克的兔', { ...base('rabbit'), bodyMassKg: 300 }],
  ['20 克的兔', { ...base('rabbit'), bodyMassKg: 0.02 }],
];
it('花园岛验收', () => {
  for (const [label, d] of CASES) {
    const s = new Session({ seed: scenario.seed, world, species: speciesFor(world), tools, design: designDataOf(kit) }, scenarioRules(scenario));
    const { grid } = s.sim.state;
    let at = { x: grid.width >> 1, y: grid.height >> 1 };
    for (let r = 0; grid.terrain[cellIndex(grid, at.x, at.y)] === 0; r++) at = { x: (grid.width >> 1) + (r % 12), y: (grid.height >> 1) - Math.floor(r / 12) };
    const design = { ...d, id: 'd_x', name: '设计' };
    const r = s.submit({ type: 'introduce', species: compileDesign(design, kit).params, design, ...at, count: 20 });
    if (!r.ok) { console.log(`${label}: 放不了 ${r.reason}`); continue; }
    s.advance(TICKS_PER_DAY * QUARTER_DAYS * 12);
    const names = s.sim.species.map((x) => x.params.name);
    const mine = s.quarters.flatMap((q) => q.species!.filter((x) => x.id === 'd_x'));
    const all = { id: 'd_x', start: 0, end: 0, births: mine.reduce((a, x) => a + x.births, 0), released: 20, removed: 0, deaths: [] as Array<[number, number]> };
    for (const x of mine) for (const [c, n] of x.deaths) { const e = all.deaths.find((y) => y[0] === c); if (e) e[1] += n; else all.deaths.push([c, n]); }
    const cause = mainCause(all);
    const last = s.quarters.at(-1)!;
    console.log(`${label.padEnd(14, '　')} ${replyKeyOf(last, scenario.goal).padEnd(8)} 年末 ${s.quarters.filter((q) => q.index % 4 === 0).map((q) => q.targetCount).join(' → ')}  生 ${all.births} 死 ${deadOf(all)}（${cause === null ? '' : causeText(cause, names)}）  鸟 ${last.species![0]!.end}  灌丛 ${Math.round(last.detail.habitat * 100)}%`);
  }
});
