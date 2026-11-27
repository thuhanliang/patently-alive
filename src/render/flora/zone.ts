import type { FloraSpecies } from '../../data/schema/flora';

/**
 * 一处地方长什么植物（纯函数，只决定画面，docs/research/flora.md 第四节）。
 * 推演说"有多少、被啃了多少"（草本、灌丛的生物量），这里说"是哪几种"：
 * - 地带由非生物因素定（U4 5.13）：地形、离水多远、湿度（谷底和湿地用种子定的噪声，不进推演）；
 * - 演替由灌丛有多满定（U4 5.15）：灌丛少是蕨、牧草、银丛草；中等是麦卢卡、荆豆；满了是卡努卡、谷底的阔叶林；
 * - 被啃：草本少（被吃了）时，适口的种（金沙莎、镜叶木、朱蕉、高丛草……）变少、变矮。
 */
export interface FloraSite {
  terrain: 'coast' | 'grass' | 'shrub';
  /** 离水几格（海岸格是 0 或 1）。 */
  coastDist: number;
  /** 灌丛、草本占上限的比例（0–1）。 */
  woody: number;
  herb: number;
  /** 湿度（0–1，按种子定）。 */
  wet: number;
  /** 亚南极的岛（麦夸里）。 */
  subantarctic?: boolean;
  seed: number;
}

/** 剧场的三排：远（树）、中（灌木、丛）、近（草、莎草）。 */
export type Row = 'far' | 'mid' | 'near';
export interface FloraPick {
  id: string;
  row: Row;
  /** 0–1：在这一排里放多少份。 */
  weight: number;
  /** 被啃矮了多少（1 不矮）。 */
  height: number;
}

/** 适口：兔子、山羊爱吃（出处见 flora.json 的 source）。 */
const PALATABLE = new Set(['pingao', 'taupata', 'tikouka', 'poafoliosa', 'stilbocarpa', 'pleurophyllum', 'pasture', 'poa']);

export function floraFor(site: FloraSite): FloraPick[] {
  const out: FloraPick[] = [];
  const add = (id: string, row: Row, weight: number): void => {
    if (weight <= 0.02) return;
    // 被啃：适口的种按草本剩多少打折，矮也矮一截。
    // 林下草本少是被遮荫，不是被啃：按扣掉遮荫后的潜在值算（审核 r2）。
    const eaten = Math.min(1, site.herb / Math.max(0.2, 1 - 0.7 * site.woody));
    const graze = PALATABLE.has(id) ? 0.25 + 0.75 * eaten : 1;
    out.push({ id, row, weight: weight * graze, height: PALATABLE.has(id) ? 0.45 + 0.55 * eaten : 1 });
  };
  const { woody, wet } = site;
  if (site.subantarctic) {
    add('poafoliosa', 'near', 1);
    add('stilbocarpa', 'mid', 0.8);
    add('pleurophyllum', 'near', 0.6);
    return out;
  }
  if (site.terrain === 'coast') {
    // 海岸：一半是沙岸（前沙丘的鬣刺、金沙莎），一半是岩岸（海滨莎、镜叶木、崖上的新西兰圣诞树），按种子定。
    const sandy = (site.seed % 100) / 100 < 0.5;
    if (sandy) {
      add('spinifex', 'near', 1);
      add('pingao', 'near', 0.8);
      add('pohuehue', 'mid', 0.5);
      add('taupata', 'mid', 0.3);
    } else {
      add('wiwi', 'near', 1);
      add('taupata', 'mid', 0.8);
      add('pohuehue', 'mid', 0.4);
      add('pohutukawa', 'far', 1);
    }
    return out;
  }
  // 内陆。
  const nearCoast = site.coastDist <= 4;
  if (wet > 0.7) {
    // 湿地、谷底。
    add('raupo', 'near', 0.6);
    add('harakeke', 'mid', 1);
    add('tikouka', 'far', 0.7);
    if (woody > 0.6) {
      add('ponga', 'far', 0.8);
      add('nikau', 'far', 0.5);
      add('kawakawa', 'mid', 0.6);
    }
  }
  // 草地层：放牧留下的牧草、银丛草；灌丛满了草就少。蕨和荆豆不长在积水的地方（审核 r2）。
  const dry = wet < 0.6 ? 1 : 0;
  add('pasture', 'near', (1 - woody) * 1.0);
  add('poa', 'near', (1 - woody) * 0.6);
  // 被啃的地方，不适口的"增加者"（蕨、麦卢卡）份量上升（啃食改变群落组成）。
  add('rarauhe', 'mid', dry * (woody < 0.5 ? 0.6 : 0.2) * (1.6 - site.herb));
  // 演替：灌丛越满，越往后面的阶段走。
  add('gorse', 'mid', dry * (woody > 0.15 && woody < 0.6 ? 0.5 : 0));
  add('manuka', 'mid', woody > 0.2 ? 0.9 * (1 - Math.max(0, woody - 0.75) * 2) : 0);
  add('kanuka', 'far', woody > 0.5 ? woody : 0);
  if (woody > 0.8) {
    add('karaka', 'far', 0.5);
    add('kawakawa', 'mid', 0.4);
  }
  if (nearCoast) {
    // 开阔的牧场里不会冒出大树：要有一点灌丛（或者以后的"种植"事件）。
    add('pohutukawa', 'far', woody > 0.3 ? 0.6 : 0);
    add('taupata', 'mid', 0.4);
    add('harakeke', 'mid', 0.3);
  }
  return out;
}

/** 按份量挑 n 株（确定：同一处每次一样）。 */
export function pickPlants(picks: readonly FloraPick[], row: Row, n: number, seed: number): FloraPick[] {
  const pool = picks.filter((p) => p.row === row);
  const total = pool.reduce((a, p) => a + p.weight, 0);
  if (total <= 0) return [];
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
  const out: FloraPick[] = [];
  for (let i = 0; i < n; i++) {
    let r = rnd() * total;
    for (const p of pool) {
      r -= p.weight;
      if (r <= 0) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

export type { FloraSpecies };
