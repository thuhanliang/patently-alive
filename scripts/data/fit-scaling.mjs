// 从 PanTHERIA（哺乳动物）和 AnAge（鸟）拟合体重缩放公式，写出 src/data/scaling/laws.json。
// 设计编译器（阶段 3）按这些公式从"原因"（体重、窝仔数、食性、会不会飞）推导物种参数。
// 只在开发时运行（npm run data:fit）；游戏运行时只读 laws.json，不读数据库（铁律 6）。
// 结果是确定的：同样的数据库文件 → 同样的 laws.json（tests/scaling.test.ts 会重算核对）。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readTsv } from './tsv.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', '..');

const manifest = JSON.parse(readFileSync(join(here, 'sources.json'), 'utf8'));
/** 数据库文件的位置按 sources.json 来（和 check-traits 一致）。AnAge 用仓库里解压好的那份。 */
const pantheriaPath = join(root, 'data-external', manifest.sources.find((x) => x.id === 'pantheria').file);
const anagePath = join(root, 'data-external', 'anage', 'anage_data.txt');

/** 数据库里的正数；缺失（PanTHERIA 的 -999、AnAge 的空格）返回 null。 */
function pos(v) {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n > 0 ? n : null;
}

/** 最小二乘：y ≈ b0 + b1·x1 + …；返回系数、样本数、R²、残差标准差。 */
function ols(rows) {
  const k = rows[0].x.length + 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (const { x, y } of rows) {
    const v = [1, ...x];
    for (let i = 0; i < k; i++) {
      b[i] += v[i] * y;
      for (let j = 0; j < k; j++) A[i][j] += v[i] * v[j];
    }
  }
  // 高斯消元（k 很小）。
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  const coef = b.map((v, i) => v / A[i][i]);
  const mean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  let ssr = 0;
  let sst = 0;
  for (const { x, y } of rows) {
    const f = coef[0] + x.reduce((s, xi, i) => s + coef[i + 1] * xi, 0);
    ssr += (y - f) ** 2;
    sst += (y - mean) ** 2;
  }
  return { coef, n: rows.length, r2: 1 - ssr / sst, sd: Math.sqrt(ssr / (rows.length - k)) };
}

const round = (x, d = 4) => Number(x.toFixed(d));
/** 一条公式：log10(y) = intercept + Σ slope·log10(x)（或直接的 x，见 terms）。 */
function law(name, unit, terms, fit, source, note) {
  return {
    name,
    unit,
    intercept: round(fit.coef[0]),
    terms: Object.fromEntries(terms.map((t, i) => [t, round(fit.coef[i + 1])])),
    n: fit.n,
    r2: round(fit.r2, 3),
    /** 残差的标准差（log10）：10^sd 就是"典型差几倍"。 */
    residualSdLog10: round(fit.sd, 3),
    source,
    ...(note ? { note } : {}),
  };
}

/** 拟合全部公式（读数据库，不写文件）。 */
export function fitLaws() {
  const lg = Math.log10;

  // ---------- 哺乳动物：PanTHERIA
  const pan = readTsv(readFileSync(pantheriaPath, 'latin1'));
  // 游戏只模拟陆生走兽：去掉翼手目、鲸目、海牛目和鳍足类（按目和科排除，不看 Terrestriality 一栏，那一栏缺得多）。
  const SKIP_ORDERS = new Set(['Chiroptera', 'Cetacea', 'Sirenia']);
  const SKIP_FAMILIES = new Set(['Phocidae', 'Otariidae', 'Odobenidae']);
  const mammals = pan
    .filter((r) => !SKIP_ORDERS.has(r.MSW05_Order) && !SKIP_FAMILIES.has(r.MSW05_Family))
    .map((r) => ({
      binomial: r.MSW05_Binomial,
      order: r.MSW05_Order,
      family: r.MSW05_Family,
      genus: r.MSW05_Genus,
      massG: pos(r['5-1_AdultBodyMass_g']),
      neonateG: pos(r['5-3_NeonateBodyMass_g']),
      litter: pos(r['15-1_LitterSize']),
      gestation: pos(r['9-1_GestationLen_d']),
      maturity: pos(r['23-1_SexualMaturityAge_d']),
      lifespanY: pos(r['17-1_MaxLongevity_m']) && pos(r['17-1_MaxLongevity_m']) / 12,
      interbirth: pos(r['14-1_InterbirthInterval_d']),
      weaning: pos(r['25-1_WeaningAge_d']),
      weaningMassG: pos(r['5-4_WeaningBodyMass_g']),
      homeRange: pos(r['22-2_HomeRange_Indiv_km2']),
      trophic: pos(r['6-2_TrophicLevel']),
      bmrW: pos(r['18-1_BasalMetRate_mLO2hr']) && (pos(r['18-1_BasalMetRate_mLO2hr']) * 20.1) / 3600,
      bmrMassG: pos(r['5-2_BasalMetRateMass_g']),
    }))
    .filter((r) => r.massG);

  /** 用体重和窝仔数拟合某项生活史量（哺乳动物和鸟同一个形式）。 */
  function lifeHistory(rows, key, scale = 1) {
    return ols(rows.filter((r) => r[key] && r.litter).map((r) => ({ x: [lg(r.massG), lg(r.litter)], y: lg(r[key] * scale) })));
  }

  const PAN = 'PanTHERIA 1.0（Jones et al. 2009），陆生哺乳动物（不含翼手目、鲸目、海牛目、鳍足类）';
  const mammalLaws = {
    gestationDays: law('妊娠期', '天', ['log10MassG', 'log10Litter'], lifeHistory(mammals, 'gestation'), PAN),
    ageAtMaturityDays: law('性成熟', '天', ['log10MassG', 'log10Litter'], lifeHistory(mammals, 'maturity'), PAN),
    maxLifespanYears: law('最长寿命', '年', ['log10MassG', 'log10Litter'], lifeHistory(mammals, 'lifespanY'), PAN, '数据库的最长寿命多来自圈养记录，比野外长'),
    litterIntervalDays: law('两窝间隔', '天', ['log10MassG', 'log10Litter'], lifeHistory(mammals, 'interbirth'), PAN, '数据库的胎间隔；推导时不短于妊娠期'),
      weaningDays: law('断奶', '天', ['log10MassG', 'log10Litter'], lifeHistory(mammals, 'weaning'), PAN, '设计编译器用作窝里的天数（晚成）'),
      weaningMassG: law('断奶体重', '克', ['log10MassG', 'log10Litter'], lifeHistory(mammals, 'weaningMassG'), PAN, '设计编译器估算育幼的能量'),
    homeRangeKm2: law(
      '家域面积',
      '平方公里',
      ['log10MassG', 'trophicLevel'],
      ols(mammals.filter((r) => r.homeRange && r.trophic).map((r) => ({ x: [lg(r.massG), r.trophic], y: lg(r.homeRange) }))),
      PAN,
      '营养级 1 = 食草，2 = 杂食，3 = 吃动物（含食虫）；设计里按动物性食物比例 a 取 1 + 2a',
    ),
    basalMetabolismW: law(
      '基础代谢率',
      '瓦',
      ['log10MassG'],
      ols(mammals.filter((r) => r.bmrW && r.bmrMassG).map((r) => ({ x: [lg(r.bmrMassG)], y: lg(r.bmrW) }))),
      PAN,
      '耗氧量按 1 毫升氧 ≈ 20.1 焦换算',
    ),
  };

  // ---------- 繁殖（阶段 3.5 第 4 步）：一窝的总重由母亲的体重定，玩家只选"生几个"（Smith & Fretwell 1974 的取舍）。
  // 有袋类和单孔类不算：它们的投入主要在出生以后（育儿袋里的泌乳），新生儿小得不可比。
  const MARSUPIAL_ORDERS = new Set(['Didelphimorphia', 'Paucituberculata', 'Microbiotheria', 'Dasyuromorphia', 'Peramelemorphia', 'Notoryctemorphia', 'Diprotodontia', 'Monotremata']);
  // 早成：数据库没有这一栏，按类群标（偶蹄、奇蹄、长鼻、蹄兔目，豪猪亚目里生下来就能跑的几科，野兔属）。
  const PRECOCIAL_ORDERS = new Set(['Artiodactyla', 'Cetartiodactyla', 'Perissodactyla', 'Proboscidea', 'Hyracoidea']);
  const PRECOCIAL_FAMILIES = new Set(['Caviidae', 'Hydrochaeridae', 'Dasyproctidae', 'Cuniculidae', 'Erethizontidae', 'Chinchillidae', 'Octodontidae', 'Echimyidae', 'Myocastoridae', 'Capromyidae', 'Dinomyidae']);
  const isPrecocial = (r) => PRECOCIAL_ORDERS.has(r.order) || PRECOCIAL_FAMILIES.has(r.family) || (r.family === 'Leporidae' && r.genus === 'Lepus');
  const breedersAll = mammals.filter((r) => r.litter && !MARSUPIAL_ORDERS.has(r.order));
  const breeders = breedersAll.filter((r) => r.neonateG);
  const litterMassFit = ols(breeders.map((r) => ({ x: [lg(r.massG), isPrecocial(r) ? 1 : 0], y: lg(r.neonateG * r.litter) })));
  const neonateFit = ols(breeders.map((r) => ({ x: [lg(r.massG), isPrecocial(r) ? 1 : 0], y: lg(r.neonateG) })));
  // 同体重、同育幼方式的新生儿大小的真实范围：残差的 1% 和 99% 分位（比这还小的养不活，比这还大的生不下来）。
  const neonateResiduals = breeders
    .map((r) => lg(r.neonateG) - (neonateFit.coef[0] + neonateFit.coef[1] * lg(r.massG) + neonateFit.coef[2] * (isPrecocial(r) ? 1 : 0)))
    .sort((a, b) => a - b);
  const quantile = (xs, q) => xs[Math.floor(q * (xs.length - 1))];
  const PAN_BREED = `${PAN}，不含有袋类和单孔类，要有新生体重和每窝仔数`;
  const reproductionMammal = {
    litterMassG: law(
      '一窝总重',
      '克',
      ['log10MassG', 'precocial'],
      litterMassFit,
      PAN_BREED,
      '一窝总重 = 新生体重 × 每窝仔数；precocial 是早成（1）或晚成（0），早成的按类群标（偶蹄、奇蹄、长鼻、蹄兔目，豚鼠、刺豚鼠等几科，野兔属）',
    ),
    neonateMassG: {
      ...law('新生体重', '克', ['log10MassG', 'precocial'], neonateFit, PAN_BREED, '早成的新生儿大一些；envelope 是真实物种残差的 1% 和 99% 分位'),
      envelope: { low: round(quantile(neonateResiduals, 0.01), 3), high: round(quantile(neonateResiduals, 0.99), 3) },
    },
  };

  // ---------- 繁殖节奏（阶段 3.5）：同体型一般一窝几个（设计台的"自动"），大型动物几年才生一窝。
  const pace = {
    typicalLitter: law(
      '同体型一般一窝几个',
      '个',
      ['log10MassG', 'trophicLevel'],
      ols(breedersAll.filter((r) => r.trophic).map((r) => ({ x: [lg(r.massG), r.trophic], y: lg(r.litter) }))),
      `${PAN}，不含有袋类和单孔类`,
      '设计台"自动"仔数取它（四舍五入，至少 1）；只是同体型的典型值，玩家可以改',
    ),
    interbirthDays: law(
      '胎间隔（只看体重）',
      '天',
      ['log10MassG'],
      ols(mammals.filter((r) => r.interbirth && r.litter).map((r) => ({ x: [lg(r.massG)], y: lg(r.interbirth) }))),
      PAN,
      '全年平均的胎间隔；超过一年时设计编译器用它作"几年一窝"（狮虎约两年，象四五年），一年以内仍按繁殖季里的间隔算',
    ),
  };

  // ---------- 鸟：AnAge
  const anage = readTsv(readFileSync(anagePath, 'utf8'));
  const birdRows = anage.filter((r) => r.Class === 'Aves');
  const birds = birdRows
    .map((r) => ({
      order: r.Order,
      binomial: `${r.Genus} ${r.Species}`,
      massG: pos(r['Adult weight (g)']),
      litter: pos(r['Litter/Clutch size']),
      gestation: pos(r['Gestation/Incubation (days)']),
      maturity: pos(r['Female maturity (days)']),
      lifespanY: pos(r['Maximum longevity (yrs)']),
      clutchesPerYear: pos(r['Litters/Clutches per year']),
    }))
    .filter((r) => r.massG);
  const ANAGE = 'AnAge（Tacutu et al. 2018），鸟纲';
  const birdLaws = {
    gestationDays: law('孵化期', '天', ['log10MassG', 'log10Litter'], lifeHistory(birds, 'gestation'), ANAGE),
    ageAtMaturityDays: law('性成熟', '天', ['log10MassG', 'log10Litter'], lifeHistory(birds, 'maturity'), ANAGE),
    maxLifespanYears: law('最长寿命', '年', ['log10MassG', 'log10Litter'], lifeHistory(birds, 'lifespanY'), ANAGE, '数据库的最长寿命多来自环志和圈养记录'),
    clutchesPerYear: law('每年窝数', '窝/年', ['log10MassG', 'log10Litter'], lifeHistory(birds, 'clutchesPerYear'), ANAGE, 'AnAge 没有鸟的窝间隔；推导时两窝间隔取 365 / 每年窝数，不短于孵化期'),
  };
  // 鸟的蛋重只随体重（Rahn 等 1975：蛋 ∝ M^0.77），玩家选的是每窝蛋数；比同体重的真实鸟多太多，孵不过来、喂不过来。
  // 一只角百灵（Eremophila alpestris）记着 43 个，明显是录入错误，分位数不受它影响。
  const clutchRows = birds.filter((r) => r.litter);
  const clutchFit = ols(clutchRows.map((r) => ({ x: [lg(r.massG)], y: lg(r.litter) })));
  const clutchResiduals = clutchRows.map((r) => lg(r.litter) - (clutchFit.coef[0] + clutchFit.coef[1] * lg(r.massG))).sort((a, b) => a - b);
  const reproductionBird = {
    clutchSize: {
      ...law('每窝蛋数', '个', ['log10MassG'], clutchFit, ANAGE, 'envelope 是真实物种残差的 1% 和 99% 分位'),
      envelope: { low: round(quantile(clutchResiduals, 0.01), 3), high: round(quantile(clutchResiduals, 0.99), 3) },
    },
  };

  // ---------- 飞行的体重上限：AnAge 里会飞的鸟最重的那种（不会飞的目和种排除）。
  const FLIGHTLESS_ORDERS = new Set(['Struthioniformes', 'Rheiformes', 'Casuariiformes', 'Apterygiformes', 'Sphenisciformes', 'Dinornithiformes']);
  const FLIGHTLESS_SPECIES = new Set(['Strigops habroptila', 'Gallirallus australis', 'Porphyrio hochstetteri', 'Raphus cucullatus', 'Phalacrocorax harrisi', 'Nannopterum harrisi']);
  const flyers = birds.filter((r) => !FLIGHTLESS_ORDERS.has(r.order) && !FLIGHTLESS_SPECIES.has(r.binomial)).sort((a, b) => b.massG - a.massG);
  const heaviest = flyers[0];
  const heaviestOf = (rows) => rows.reduce((a, b) => (b.massG > a.massG ? b : a));
  const heaviestMammal = heaviestOf(mammals);
  const heaviestBird = heaviestOf(birds);

  // ---------- 用现有技术条目校准的两项（数据库里没有）
  // 只用写成了设计模板的条目（设计编译器的回归基准，src/data/design/templates.json）：
  // 后来进档案馆、没有模板的物种（如水獭，2026-10-22）不改校准，已有的设计也就不变。
  const speciesDir = join(root, 'src', 'data', 'species');
  const templated = new Set(JSON.parse(readFileSync(join(root, 'src', 'data', 'design', 'templates.json'), 'utf8')).templates.map((t) => t.species));
  const archive = readdirSync(speciesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(speciesDir, f), 'utf8')))
    .filter((s) => templated.has(s.id));
  const birdIds = new Set(
    readdirSync(join(root, 'src', 'data', 'archive'))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(root, 'src', 'data', 'archive', f), 'utf8')))
      .filter((e) => e.taxonomy.class === '鸟纲')
      .map((e) => e.species),
  );
  /** 几何平均。 */
  const geoMean = (xs) => 10 ** (xs.reduce((s, x) => s + lg(x), 0) / xs.length);
  const geoSd = (xs) => {
    const m = xs.reduce((s, x) => s + lg(x), 0) / xs.length;
    return Math.sqrt(xs.reduce((s, x) => s + (lg(x) - m) ** 2, 0) / (xs.length - 1));
  };
  // 成体年存活率 s = exp(−k / 最长寿命)：k 越大，野外死得越早（最长寿命是极端值，野外平均远不到）。
  const kOf = (sp) => -Math.log(sp.survival.adultAnnual) * sp.maxLifespanYears;
  const kMammal = archive.filter((s) => !birdIds.has(s.id)).map(kOf);
  const kBird = archive.filter((s) => birdIds.has(s.id)).map(kOf);
  // 每天活动范围 ≈ c · √家域面积。
  const withHr = archive.filter((s) => s.movement.homeRangeKm2);
  const cRange = withHr.map((s) => s.movement.dailyRangeM / Math.sqrt(s.movement.homeRangeKm2 * 1e6));
  const ARCHIVE = '现有技术条目（src/data/species，各条出处见 docs/DATA_CHECK.md）';

  return {
    说明:
      '体重缩放公式，由 scripts/data/fit-scaling.mjs 从数据库拟合（npm run data:fit），不要手改。' +
      '公式形如 log10(y) = intercept + Σ 系数 · 自变量；log10MassG 是体重（克）的常用对数，log10Litter 是每窝仔数（鸟是每窝蛋数）的常用对数。' +
      'residualSdLog10 是拟合误差：真实物种通常落在预测值的 10^±sd 倍以内。',
    mammal: mammalLaws,
    bird: birdLaws,
    reproduction: { mammal: reproductionMammal, bird: reproductionBird },
    pace: pace,
    survival: {
      name: '成体年存活率',
      formula: 's = exp(−k / 最长寿命（年）)',
      kMammal: round(geoMean(kMammal), 3),
      kBird: round(geoMean(kBird), 3),
      n: { mammal: kMammal.length, bird: kBird.length },
      residualSdLog10: { mammal: round(geoSd(kMammal), 3), bird: round(geoSd(kBird), 3) },
      source: ARCHIVE,
      note: '数据库没有野外存活率，按现有技术条目校准；k 取几何平均',
    },
    dailyRange: {
      name: '每天活动范围',
      formula: 'dailyRangeM = c · √(家域面积（平方米）)',
      c: round(geoMean(cRange), 3),
      n: cRange.length,
      residualSdLog10: round(geoSd(cRange), 3),
      source: ARCHIVE,
      note: '数据库没有每天的活动距离，按现有技术条目校准；c 取几何平均',
    },
    // 拟合用到的数据里最重的物种：设计比它还重，公式就是外推（设计台提醒）。
    dataRange: {
      mammal: { maxMassKg: round(heaviestMammal.massG / 1000, 1), species: heaviestMammal.binomial },
      bird: { maxMassKg: round(heaviestBird.massG / 1000, 1), species: heaviestBird.binomial },
    },
    flight: {
      maxMassKg: round(heaviest.massG / 1000, 2),
      heaviestFlyer: heaviest.binomial,
      source: `${ANAGE}，排除不会飞的目（鸵鸟、美洲鸵、鹤鸵、几维、企鹅、恐鸟）和不会飞的种`,
    },
    /** 野外代谢率（千焦/天）= coef · 体重克^exp。文献值，不是拟合的：两个数据库都没有野外代谢率。 */
    fieldMetabolism: {
      mammal: { coef: 4.82, exp: 0.734 },
      bird: { coef: 10.5, exp: 0.681 },
      source: 'Nagy, Girard & Brown (1999) Annu. Rev. Nutr. 19:247，全体哺乳动物、全体鸟类的野外代谢率回归',
    },
  };
}

// 直接运行时写文件；被测试 import 时只导出 fitLaws。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(root, 'src', 'data', 'scaling', 'laws.json');
  const text = `${JSON.stringify(fitLaws(), null, 2)}\n`;
  if (process.argv.includes('--print')) process.stdout.write(text);
  else {
    writeFileSync(out, text);
    console.log(`写出 ${out}`);
  }
}
