// 用外部数据库核对物种数据：抽出 src/data/species 里每个物种在 PanTHERIA、AnAge 中的记录，
// 和我们用的值逐字段对照，写出：
//   docs/data/traits-reference.json   本游戏物种和后续阶段物种的数据库摘录（带出处），进仓库供查阅
//   docs/DATA_CHECK.md                核对表（差得多的标出来）
// 摘录只是参考资料，不是游戏运行时读取的数据。
// 先运行 npm run data:fetch 下载数据库。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');
const dirs = { external: join(root, 'data-external'), raw: join(root, 'data-raw') };
const manifest = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
const srcOf = (id) => manifest.sources.find((s) => s.id === id);

// ---------- 读物种数据
const speciesDir = join(root, 'src', 'data', 'species');
const species = readdirSync(speciesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(speciesDir, f), 'utf8')));

// ---------- 读数据库
function readTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

function loadPantheria() {
  const path = join(dirs[srcOf('pantheria').dir], srcOf('pantheria').file);
  if (!existsSync(path)) return null;
  return readTsv(readFileSync(path, 'latin1'));
}

/**
 * AnAge：优先读仓库里已解压好的 data-external/anage/anage_data.txt（随仓库分发，不需要 unzip）；
 * 没有才从 zip 解压到 data-raw/anage/（scratch，先清空目录，避免读到旧文件）。
 */
function loadAnage() {
  const committed = join(dirs.external, 'anage', 'anage_data.txt');
  if (existsSync(committed)) return readTsv(readFileSync(committed, 'utf8'));
  const outDir = join(dirs.raw, 'anage');
  const txt = join(outDir, 'anage_data.txt');
  if (!existsSync(txt)) {
    const zip = join(dirs[srcOf('anage').dir], srcOf('anage').file);
    if (!existsSync(zip)) return null;
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    try {
      execFileSync('unzip', ['-o', '-q', zip, '-d', outDir]);
    } catch {
      console.error(`解压失败（可能没有 unzip）。请手动把 ${zip} 解压到 ${outDir}，确保里面有 anage_data.txt，再运行一次。`);
      process.exit(1);
    }
    if (!existsSync(txt)) {
      console.error(`压缩包里没有 anage_data.txt，看看 ${outDir} 里实际是什么文件，改名后再运行。`);
      process.exit(1);
    }
  }
  return readTsv(readFileSync(txt, 'utf8'));
}

/** 取某列的数值：按列名里包含的关键字找列；缺失（-999、空）返回 null。 */
function num(row, ...keys) {
  if (!row) return null;
  const col = Object.keys(row).find((h) => keys.every((k) => h.toLowerCase().includes(k.toLowerCase())));
  if (!col) return null;
  const v = Number(row[col]);
  return row[col] === '' || !Number.isFinite(v) || v === -999 ? null : v;
}

const pantheria = loadPantheria();
const anage = loadAnage();
// 两个都要有：缺一个就生成的核对表会悄悄少一列。
if (!pantheria || !anage) {
  console.error(`缺少数据库文件：${[!pantheria && 'PanTHERIA', !anage && 'AnAge'].filter(Boolean).join('、')}。先运行 npm run data:fetch`);
  process.exit(1);
}

const PAN_ACTIVITY = { 1: '夜行', 2: '夜行 / 晨昏 / 全天 / 昼行混合', 3: '昼行' };

// ---------- 抽取：两个数据库各取用得到的字段（不整行复制）
/** 数据库沿用旧分类时的对照名（见 sources.json 的 synonyms）。 */
const synonyms = manifest.synonyms ?? {};

function extract(scientificName) {
  const lookup = typeof synonyms[scientificName] === 'string' ? synonyms[scientificName] : scientificName;
  const [genus, epithet] = lookup.split(' ');
  const p = pantheria.find((r) => r.MSW05_Binomial === lookup) ?? null;
  const a = anage.find((r) => r.Genus === genus && r.Species === epithet) ?? null;
  const homeRangeKm2 = num(p, 'HomeRange_km2');
  return {
    scientificName,
    ...(lookup !== scientificName ? { lookedUpAs: lookup } : {}),
    pantheria: p && {
      adultBodyMassG: num(p, 'AdultBodyMass_g'),
      litterSize: num(p, 'LitterSize'),
      littersPerYear: num(p, 'LittersPerYear'),
      gestationDays: num(p, 'GestationLen_d'),
      interbirthIntervalDays: num(p, 'InterbirthInterval_d'),
      sexualMaturityDays: num(p, 'SexualMaturityAge_d'),
      maxLongevityMonths: num(p, 'MaxLongevity_m'),
      homeRangeKm2,
      populationDensityPerKm2: num(p, 'PopulationDensity_n'),
      activityCycle: num(p, 'ActivityCycle'),
    },
    anage: a && {
      adultWeightG: num(a, 'Adult weight'),
      litterSize: num(a, 'Litter', 'size'),
      littersPerYear: num(a, 'per year'),
      gestationDays: num(a, 'Gestation'),
      interLitterDays: num(a, 'Inter-litter'),
      femaleMaturityDays: num(a, 'Female maturity'),
      maxLongevityYears: num(a, 'Maximum longevity'),
      dataQuality: a['Data quality'] ?? null,
      sampleSize: a['Sample size'] ?? null,
    },
  };
}

const reference = {};
for (const sp of species) reference[sp.id] = extract(sp.scientificName);

// 后续阶段要用的物种：同样只取上面这些字段。
const extra = {};
for (const [group, names] of Object.entries(manifest.extraTaxa ?? {})) {
  if (!Array.isArray(names)) continue;
  for (const name of names) extra[name] = { group, ...extract(name) };
}

const refDir = join(root, 'docs', 'data');
mkdirSync(refDir, { recursive: true });
writeFileSync(
  join(refDir, 'traits-reference.json'),
  `${JSON.stringify(
    {
      说明: '外部数据库里与本游戏物种（及后续阶段物种）对应的记录摘录，由 scripts/data/check-traits.mjs 生成，勿手改。只是参考资料，游戏运行时不读它。',
      sources: manifest.sources.map(({ id, name, citation, license, url, sha256 }) => ({ id, name, citation, license, url, sha256 })),
      species: reference,
      extraTaxa: extra,
    },
    null,
    2,
  )}\n`,
);

// ---------- 核对表
const fmt = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
/** 和数据库值相差超过这个比例就标出来。 */
const WARN = 0.25;
function flag(ours, ...refs) {
  const vals = refs.filter((v) => v !== null && v !== undefined);
  if (vals.length === 0) return '无数据';
  const far = vals.every((v) => Math.abs(ours - v) / Math.max(Math.abs(v), 1e-9) > WARN);
  return far ? '⚠ 偏离' : '✓';
}

const out = [];
out.push('# 物种数据核对表');
out.push('');
out.push('由 `npm run data:check` 生成，勿手改。数据库版本与校验和见 `scripts/data/sources.json`。');
out.push(`和所有数据库值都相差超过 ${WARN * 100}% 的标为"⚠ 偏离"；数据库没有的项（野外存活率、繁殖月份等）不在表里，见 \`docs/MODEL.md\`。`);
out.push('');
for (const sp of species) {
  const r = reference[sp.id];
  const P = r.pantheria ?? {};
  const A = r.anage ?? {};
  const rep = sp.reproduction;
  const homeDiamM = P.homeRangeKm2 != null ? 2 * Math.sqrt((P.homeRangeKm2 * 1e6) / Math.PI) : null;
  out.push(`## ${sp.name}（*${sp.scientificName}*）`);
  out.push('');
  out.push(`${r.lookedUpAs ? `按 *${r.lookedUpAs}* 查。` : ''}PanTHERIA：${r.pantheria ? '有记录' : '**无记录**'}；AnAge：${r.anage ? `有记录（数据质量 ${A.dataQuality ?? '—'}，样本 ${A.sampleSize ?? '—'}）` : '**无记录**'}`);
  out.push('');
  out.push('| 项 | 我们用的 | PanTHERIA | AnAge | 结论 |');
  out.push('| --- | --- | --- | --- | --- |');
  const row = (name, ours, p, a, d = 0) => out.push(`| ${name} | ${fmt(ours, d)} | ${fmt(p, d)} | ${fmt(a, d)} | ${flag(ours, p, a)} |`);
  row('成体体重（克）', sp.bodyMassKg * 1000, P.adultBodyMassG, A.adultWeightG);
  row('每窝只数', rep.litterSize, P.litterSize, A.litterSize, 1);
  row('妊娠期（天）', rep.gestationDays, P.gestationDays, A.gestationDays);
  row('两窝间隔（天）', rep.litterIntervalDays, P.interbirthIntervalDays, A.interLitterDays);
  row('性成熟（天，AnAge 取雌性）', rep.ageAtMaturityDays, P.sexualMaturityDays, A.femaleMaturityDays);
  row('最长寿命（年）', sp.maxLifespanYears, P.maxLongevityMonths === null || P.maxLongevityMonths === undefined ? null : P.maxLongevityMonths / 12, A.maxLongevityYears, 1);
  row('开局密度（只/平方公里）', sp.initialDensityPerHa * 100, P.populationDensityPerKm2, null, 1);
  row('日活动范围直径（米；PanTHERIA 由家域面积折算）', sp.movement.dailyRangeM, homeDiamM, null);
  if (sp.movement.homeRangeKm2 !== undefined) row('家域面积（平方公里）', sp.movement.homeRangeKm2, P.homeRangeKm2, null, 3);
  out.push(`| 活动时段 | ${sp.activity} | ${P.activityCycle != null ? PAN_ACTIVITY[P.activityCycle] ?? P.activityCycle : '—'} | — | 人工比对 |`);
  out.push('');
}
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'DATA_CHECK.md'), `${out.join('\n')}\n`);
console.log('已写出 docs/data/traits-reference.json 和 docs/DATA_CHECK.md');
