/**
 * 批量推演：同一套参数跑多个种子，打印每个物种的起伏和报警。
 *   npm run sweep                      # 默认 8 个种子、10 年、64×64
 *   SEEDS=20 YEARS=15 SIZE=96 npm run sweep
 *   SEED0=5 SEEDS=1 npm run sweep      # 只跑第 5 个种子（并行跑几份时用）
 * 用来调参数：看起伏够不够、有没有哪个种子过早灭绝或爆炸。
 */
import { it } from 'vitest';
import { grassland, speciesFor } from '../src/data';
import { DAYS_PER_YEAR } from '../src/sim';
import { balanceCheck } from '../src/sim/balance';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** 读正整数环境变量；写错了直接报错，免得什么都没跑却显示"0 条报警"。 */
function intEnv(name: string, fallback: number, min: number): number {
  const raw = env[name];
  const v = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(v) || v < min) throw new Error(`${name} 要是不小于 ${min} 的整数，现在是 ${raw}`);
  return v;
}
const SEEDS = intEnv('SEEDS', 8, 1);
const YEARS = intEnv('YEARS', 10, 1);
const SIZE = intEnv('SIZE', 64, 8);
const SEED0 = intEnv('SEED0', 1, 0);

it(`sweep ${SEEDS} seeds × ${YEARS} years @ ${SIZE}²`, () => {
  const world = { ...grassland, width: SIZE, height: SIZE };
  const lines: string[] = [];
  let alarms = 0;
  for (let seed = SEED0; seed < SEED0 + SEEDS; seed++) {
    const r = balanceCheck({ seed, world, species: speciesFor(world) }, YEARS);
    alarms += r.alarms.length;
    const cols = r.species.map((s) => {
      const yearlyMeans = s.yearlyMeans.map(Math.round);
      const ext = s.extinctDay === null ? '' : ` 灭绝@${(s.extinctDay / DAYS_PER_YEAR).toFixed(1)}y`;
      return `${s.id}: cv=${s.yearlyCv.toFixed(2)} dd=${s.maxDrawdown.toFixed(2)}${ext} [${yearlyMeans.join(' ')}]`;
    });
    lines.push(`seed ${seed}\n  ${cols.join('\n  ')}${r.alarms.length ? `\n  报警：${r.alarms.join('；')}` : ''}`);
  }
  console.log(`${lines.join('\n')}\n共 ${alarms} 条报警`);
}, 3_600_000);
