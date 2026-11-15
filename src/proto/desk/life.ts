import type { CompiledDesign } from '../../sim';
import { deriveSpecies } from '../../sim/physiology';

/**
 * 生养的账（2026-11-15）：这副身体自己的生死底子——一年生几窝、每窝几只、十只成体一年后剩几只，
 * 合起来在"吃得饱、不挤、没有天敌"的时候一年多出（或少掉）多少。
 *
 * 为什么放在设计台上：试玩反馈"调身体没有反馈"。体型、腿、育幼方式一变，推演里的寿命和生养节奏就跟着变，
 * 可是这些只在岛上过了几年才看得出来，死因还都写着"老死病死"。这张账让它当场看得见。
 * 只把编译结果里已经有的数（成体年存活率、窝仔数、一年几窝、性成熟）乘起来，不发明新的算法；
 * 岛上够不够吃、挤不挤、有没有谁来吃它，仍然是世界说了算。
 */
export interface LifeTally {
  littersPerYear: number;
  litterSize: number;
  /** 十只成体一年后还剩几只。 */
  adultsLeftOf10: number;
  /** 生下来的幼崽里能长到成年的比例。 */
  juvenileSurvival: number;
  /** 一年下来，一只成体平均变成几只（1 是不多不少）。 */
  yearly: number;
}

export function lifeTally(c: CompiledDesign): LifeTally {
  const p = c.params;
  const d = deriveSpecies(p, 50);
  const juvenileSurvival = Math.pow(1 - d.juvenileDailyMortality, p.reproduction.ageAtMaturityDays);
  const s = p.survival.adultAnnual;
  // 一半是母的；每只母的一年生 littersPerYear 窝。
  const recruits = 0.5 * c.littersPerYear * p.reproduction.litterSize * juvenileSurvival;
  return { littersPerYear: c.littersPerYear, litterSize: p.reproduction.litterSize, adultsLeftOf10: s * 10, juvenileSurvival, yearly: s + recruits };
}

/** 账上的两句话。 */
export function lifeLines(t: LifeTally): [string, string] {
  const litters = t.littersPerYear >= 0.95 ? `一年生 ${Number(t.littersPerYear.toFixed(1))} 窝` : `${Number((1 / t.littersPerYear).toFixed(1))} 年生一窝`;
  const change = t.yearly - 1;
  const trend = Math.abs(change) < 0.03 ? '不多不少' : change > 0 ? (t.yearly >= 2 ? `翻 ${Number(t.yearly.toFixed(1))} 倍` : `多 ${Math.round(change * 100)}%`) : `少 ${Math.round(-change * 100)}%`;
  return [`${litters}，每窝 ${Number(t.litterSize.toFixed(1))} 只；十只成体一年后剩 ${Math.round(t.adultsLeftOf10)} 只`, `吃得饱、没天敌的时候，一年${trend}`];
}
