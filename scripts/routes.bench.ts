import { it } from 'vitest';
import { scenarioLibrary, speciesFor, tools, worldFor } from '../src/data';
import { Session, TICKS_PER_DAY, causeName, recentByCause, scenarioRules, type Op } from '../src/sim';
import { DAYS_PER_YEAR } from '../src/sim/time';

/**
 * 路线推演：用几个"照章办事"的脚本玩家把「野猫与鸟岛」整局玩一遍，看哪些路线走得通。
 * 脚本玩家和真人一样只能通过 Session.submit 下操作（铁律 7），预算、人手、满意度照样算。
 * 用 npm run routes 跑（慢，不跟着 npm test）；SEEDS=1,2 指定种子，ROUTES=none,cats 只跑几条。
 *
 * - none：什么都不做。
 * - cats：只抓猫（每支空闲的队伍都去猫最多的地方下猫笼）。
 * - rats：只控鼠：在鸟最多的地方轮流布鼠笼网，猫不动。
 * - islets-rats：先把离岸小岛上的鼠清干净（小岛上没有猫和兔），再到主岛鸟多的地方布鼠笼网。
 */
type Route = 'none' | 'cats' | 'rats' | 'islets-rats';
const ROUTES: Route[] = ['none', 'cats', 'rats', 'islets-rats'];

function play(route: Route, seed: number): string[] {
  const scenario = scenarioLibrary.get('bird-island')!;
  const world = worldFor(scenario);
  const session = new Session({ seed, world, species: speciesFor(world), tools }, scenarioRules(scenario));
  const ids = session.sim.species.map((s) => s.params.id);
  const names = session.sim.species.map((s) => s.params.name);
  const [bird, rat, cat] = ['dotterel', 'rat', 'cat'].map((id) => ids.indexOf(id)) as [number, number, number];
  const { width: W, height: H } = world;
  const state = () => session.sim.state;
  const count = (s: number, c: number): number => {
    const p = state().populations[s]!;
    let n = p.adults[c]!;
    for (const j of p.juveniles) n += j[c]!;
    return n;
  };
  /** 以 (x, y) 为中心的 (2r+1)² 方块里某物种最多的地方（只看 keep 允许的格子）。 */
  const hotspot = (s: number, r: number, keep: (c: number) => boolean = () => true) => {
    let best = { x: W >> 1, y: H >> 1, n: 0 };
    for (let y = r; y < H - r; y += 2) {
      for (let x = r; x < W - r; x += 2) {
        if (state().grid.terrain[y * W + x] === 0 || !keep(y * W + x)) continue;
        let n = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) n += count(s, (y + dy) * W + x + dx);
        if (n > best.n) best = { x, y, n };
      }
    }
    return best;
  };
  const islet = (c: number) => state().grid.island[c] !== 1;
  // 别把几支队伍派到同一处：已经有陷阱的地方附近不再选。
  const untrapped = (c: number, r: number): boolean => {
    const x = c % W;
    const y = Math.floor(c / W);
    return state().jobs.every((j) => j.kind !== 'trap' || Math.max(Math.abs(j.x - x), Math.abs(j.y - y)) > r);
  };
  const ratNet = (x: number, y: number): Op => ({ type: 'trap', trap: 'rat-cage', x, y, nights: 10, remove: ['rat'] });

  const nextOp = (): Op | null => {
    switch (route) {
      case 'none':
        return null;
      case 'cats': {
        if (session.sim.totals()[cat] === 0) return null;
        const h = hotspot(cat, 6, (c) => untrapped(c, 12));
        return { type: 'trap', trap: 'cat-cage', x: h.x, y: h.y, nights: 15, remove: ['cat'] };
      }
      case 'rats': {
        const h = hotspot(bird, 4, (c) => untrapped(c, 10));
        return ratNet(h.x, h.y);
      }
      case 'islets-rats': {
        const left = hotspot(rat, 2, (c) => islet(c) && untrapped(c, 5));
        const h = left.n > 3 ? left : hotspot(bird, 4, (c) => untrapped(c, 10));
        return ratNet(h.x, h.y);
      }
    }
  };

  const rows: string[] = [];
  for (let d = 1; d <= scenario.goal.years * DAYS_PER_YEAR; d++) {
    for (let k = 0; k < 3 && session.freeStaff() > 0 && !session.ended; k++) {
      const op = nextOp();
      if (!op || !session.submit(op).ok) break;
    }
    session.advance(TICKS_PER_DAY);
    if (d % 90 !== 0) continue;
    const t = session.sim.totals();
    const q = session.quarters.at(-1)!;
    let isletBirds = 0;
    for (let c = 0; c < W * H; c++) if (state().grid.terrain[c] !== 0 && islet(c)) isletBirds += count(bird, c);
    const byCause = recentByCause(state().deaths, bird);
    const all = byCause.reduce((a, b) => a + b, 0) || 1;
    const top = byCause
      .map((n, c) => [n / all, c] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 2)
      .map(([share, c]) => `${causeName(c, names)} ${Math.round(share * 100)}%`)
      .join('，');
    rows.push(
      `第 ${q.index} 季：鸟 ${t[bird]}（小岛 ${isletBirds}） 鼠 ${t[rat]} 兔 ${t[ids.indexOf('rabbit')]} 猫 ${t[cat]}｜` +
        `和第一年同季比 ${q.detail.targetRatio?.toFixed(2) ?? '—'}，恢复分 ${q.scores.recovery ?? '—'}｜` +
        `预算 ${q.budget} 满意度 ${Math.round(q.satisfaction)}｜鸟的近期死因：${top}`,
    );
  }
  const last = session.quarters.at(-1)!;
  rows.push(`最后一季评分 ${JSON.stringify(last.scores)}；人为移除 ${session.removed.map((n, s) => `${names[s]} ${n}`).join('，')}`);
  return rows;
}

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const seeds = (env.SEEDS ?? '1').split(',').map(Number);
const routes = (env.ROUTES?.split(',') as Route[] | undefined) ?? ROUTES;
for (const seed of seeds) {
  for (const route of routes) {
    it(`种子 ${seed} · ${route}`, () => {
      console.info([`== 种子 ${seed} · ${route}`, ...play(route, seed)].join('\n'));
    });
  }
}
