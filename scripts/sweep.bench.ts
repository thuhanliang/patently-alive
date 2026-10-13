/**
 * 批量推演：同一套参数跑多个种子，打印每个物种的起伏和报警。
 *   npm run sweep                      # 默认 8 个种子、10 年、64×64
 *   SEEDS=20 YEARS=15 SIZE=96 npm run sweep
 * 用来调参数：看起伏够不够、有没有哪个种子过早灭绝或爆炸。
 */
import { it } from 'vitest';
import { grassland, speciesFor } from '../src/data';
import { DAYS_PER_YEAR } from '../src/sim';
import { balanceCheck } from '../src/sim/balance';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(env.SEEDS ?? 8);
const YEARS = Number(env.YEARS ?? 10);
const SIZE = Number(env.SIZE ?? 64);

it(`sweep ${SEEDS} seeds × ${YEARS} years @ ${SIZE}²`, () => {
  const world = { ...grassland, width: SIZE, height: SIZE };
  const lines: string[] = [];
  let alarms = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = balanceCheck({ seed, world, species: speciesFor(world) }, YEARS);
    alarms += r.alarms.length;
    const cols = r.species.map((s) => {
      const yearlyMeans = Array.from({ length: YEARS }, (_, y) => {
        const slice = s.daily.slice(y * DAYS_PER_YEAR, (y + 1) * DAYS_PER_YEAR);
        return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
      });
      const ext = s.extinctDay === null ? '' : ` 灭绝@${(s.extinctDay / DAYS_PER_YEAR).toFixed(1)}y`;
      return `${s.id}: cv=${s.yearlyCv.toFixed(2)} dd=${s.maxDrawdown.toFixed(2)}${ext} [${yearlyMeans.join(' ')}]`;
    });
    lines.push(`seed ${seed}\n  ${cols.join('\n  ')}${r.alarms.length ? `\n  报警：${r.alarms.join('；')}` : ''}`);
  }
  console.log(`${lines.join('\n')}\n共 ${alarms} 条报警`);
}, 3_600_000);
