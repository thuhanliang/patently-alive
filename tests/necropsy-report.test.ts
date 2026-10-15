import { describe, expect, it } from 'vitest';
import { grassland, necropsyTemplates, scenarioLibrary, speciesFor, worldFor } from '../src/data';
import { CAUSE, type Carcass } from '../src/sim';
import { biteSizeMm, necropsyFindings } from '../src/sim/necropsy';
import { deriveAll } from '../src/sim/physiology';
import { PLACEHOLDERS, necropsyReport } from '../src/ui/necropsyReport';

const island = worldFor(scenarioLibrary.get('bird-island')!);
const islandSpecies = deriveAll(speciesFor(island), island.cellSizeM).derived;
const grassSpecies = deriveAll(speciesFor(grassland), grassland.cellSizeM).derived;
const idx = (list: typeof islandSpecies, id: string) => list.findIndex((s) => s.params.id === id);

const carcass = (species: number, cause: number, extra: Partial<Carcass> = {}): Carcass => ({
  species,
  cause,
  x: 10,
  y: 12,
  daysDead: 0,
  bcs: 3,
  ...extra,
});

describe('尸检所见由性状推出', () => {
  const cat = idx(islandSpecies, 'cat');
  const rat = idx(islandSpecies, 'rat');
  const bird = idx(islandSpecies, 'dotterel');

  it('被猫吃：犬齿穿刺，齿距约 20 毫米，岛上相符的只有猫', () => {
    const f = necropsyFindings(carcass(bird, CAUSE.predation(cat)), islandSpecies);
    expect(f.kind).toBe('predation');
    expect(f.predator).toBe(cat);
    expect(f.bite!.teeth).toBe('canine');
    expect(f.bite!.sizeMm).toBeGreaterThan(15);
    expect(f.bite!.sizeMm).toBeLessThan(25);
    expect(f.bite!.matches).toEqual([cat]);
  });

  it('巢被鼠吃：细小切齿痕，相符的只有鼠', () => {
    const f = necropsyFindings(carcass(bird, CAUSE.nest(rat)), islandSpecies);
    expect(f.kind).toBe('nest');
    expect(f.bite!.teeth).toBe('incisor');
    expect(f.bite!.sizeMm).toBeLessThan(4);
    expect(f.bite!.matches).toEqual([rat]);
  });

  it('饿死、其他：没有咬痕', () => {
    expect(necropsyFindings(carcass(rat, CAUSE.starvation), islandSpecies).bite).toBeNull();
    expect(necropsyFindings(carcass(rat, CAUSE.other), islandSpecies).kind).toBe('other');
  });

  it('白鼬和伶鼬的齿距分得开', () => {
    const stoat = grassSpecies[idx(grassSpecies, 'stoat')]!;
    const weasel = grassSpecies[idx(grassSpecies, 'weasel')]!;
    expect(biteSizeMm(stoat)).toBeGreaterThan(biteSizeMm(weasel) * 1.3);
  });

  it('腐败程度按死了几天', () => {
    expect(necropsyFindings(carcass(rat, CAUSE.other, { daysDead: 0 }), islandSpecies).decomposition).toBe('fresh');
    expect(necropsyFindings(carcass(rat, CAUSE.other, { daysDead: 1 }), islandSpecies).decomposition).toBe('early');
    expect(necropsyFindings(carcass(rat, CAUSE.other, { daysDead: 2 }), islandSpecies).decomposition).toBe('early');
    expect(necropsyFindings(carcass(rat, CAUSE.other, { daysDead: 3 }), islandSpecies).decomposition).toBe('advanced');
  });
});

describe('尸检报告的模板', () => {
  it('模板里只用到已知的占位符', () => {
    const all: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') all.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(necropsyTemplates);
    for (const text of all) {
      for (const m of text.matchAll(/\{(\w+)\}/g)) expect(PLACEHOLDERS as readonly string[]).toContain(m[1]);
    }
  });

  it('每种死因、每个物种都拼得出完整的报告，没有剩下的占位符', () => {
    for (const species of [islandSpecies, grassSpecies]) {
      const causes: number[] = [CAUSE.starvation, CAUSE.other, CAUSE.malnutrition, CAUSE.fracture, CAUSE.dystocia];
      species.forEach((sp, p) => {
        if (sp.params.diet.vertebrate > 0) causes.push(CAUSE.predation(p), CAUSE.nest(p));
      });
      species.forEach((_, s) => {
        for (const cause of causes) {
          for (const bcs of [1, 3, 4.5]) {
            const c = carcass(s, cause, { bcs, daysDead: 1 });
            const report = necropsyReport(necropsyTemplates, c, necropsyFindings(c, species), species);
            expect(report).toHaveLength(4);
            for (const sec of report) {
              expect(sec.text.length).toBeGreaterThan(5);
              expect(sec.text).not.toMatch(/\{\w+\}/);
            }
          }
        }
      });
    }
  });

  it('所见只描述证据、不点名；结论按齿距列出体型相符的吃肉物种', () => {
    const cat = idx(islandSpecies, 'cat');
    const bird = idx(islandSpecies, 'dotterel');
    const c = carcass(bird, CAUSE.predation(cat));
    const report = necropsyReport(necropsyTemplates, c, necropsyFindings(c, islandSpecies), islandSpecies);
    const findings = report.find((r) => r.heading === '所见')!.text;
    expect(findings).not.toContain('野猫');
    expect(report.find((r) => r.heading === '结论')!.text).toContain('野猫相符');
  });

  it('当天死的写"当天"，蛋壳和残巢不用尸体的腐败描述、也不评体况', () => {
    const rat = idx(islandSpecies, 'rat');
    const bird = idx(islandSpecies, 'dotterel');
    const c = carcass(bird, CAUSE.nest(rat), { daysDead: 0 });
    const report = necropsyReport(necropsyTemplates, c, necropsyFindings(c, islandSpecies), islandSpecies);
    expect(report[0]!.text).toContain(necropsyTemplates.days.today);
    expect(report[1]!.text).toBe(necropsyTemplates.decompositionNest.fresh);
  });
});
