import { type Design, type SpeciesParams, archiveLibrary, designSlots, designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, grassland, necropsyTemplates, speciesLibrary, scenarioLibrary, speciesFor, tools as toolData, worldFor, type Scenario, type WorldParams } from './data';
import { RECENT_HALF_LIFE_DAYS, costOf, herbIndex, designDataOf, makeDesignKit, scenarioRules, SANDBOX_RULES, type Rules, focusAround, sameFocus, type FocusRect, type Op } from './sim';
import { RemoteSession } from './runtime/remote';
import type { DayRecord } from './runtime/host';
import { CELL_PX, worldToCell, worldToCorner } from './render/projection';
import { MapView, type GameView } from './render/view';
import { colorOf } from './render/palette';
import { AlertBanner } from './ui/alertBanner';
import { ArchivePanel } from './ui/archive';
import { DesignDesk } from './ui/designDesk';
import { bindCameraControls } from './ui/cameraControls';
import { CommissionCards } from './ui/commission';
import { PopulationChart } from './ui/chart';
import { PopulationHistory } from './ui/history';
import { Hud } from './ui/hud';
import { DeathPanel } from './ui/deathPanel';
import { FieldLog } from './ui/fieldLog';
import { bindFieldTools } from './ui/fieldTools';
import { bindLayerControls } from './ui/layerControls';
import { readSlot, writeSlot } from './ui/saveSlot';
import { bindTimeControls } from './ui/timeControls';
import { bindToolControls } from './ui/toolControls';
import { bindDock } from './ui/dock';
import { bindNotebook } from './ui/notebook';
import { bindViewCard } from './ui/viewCard';

// 地址栏 ?seed=123 指定开局种子，?speed=10 指定开局倍速（开局倍速也作为一条操作记进日志）。
function intParam(name: string, fallback: number, max: number): number {
  const raw = new URLSearchParams(location.search).get(name);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`index.html 缺少 #${id}`);
  return e as T;
}

// 点过的按钮不保留焦点：否则按空格暂停时，浏览器还会再"按"一次这个按钮。
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLButtonElement) e.target.blur();
});

/**
 * 默认情景：野猫与鸟岛。地址栏 ?scenario=… 换情景，?world=grassland 打开阶段 0 的草原（沙盒），
 * ?sandbox=1 把情景的世界当沙盒玩（资源不限、可以投放），做实验用。
 */
const DEFAULT_SCENARIO = 'bird-island';

function chosenWorld(): { world: WorldParams; seed: number; rules: Rules; problem: string; scenario: Scenario | null } {
  const params = new URLSearchParams(location.search);
  if (params.get('world') === 'grassland') return { world: grassland, seed: 1, rules: SANDBOX_RULES, problem: '', scenario: null };
  const id = params.get('scenario') ?? DEFAULT_SCENARIO;
  const scenario = scenarioLibrary.get(id) ?? scenarioLibrary.get(DEFAULT_SCENARIO)!;
  const known = [...scenarioLibrary.keys()].join('、');
  const problem = scenario.id === id ? '' : `没有情景「${id}」，载入了「${scenario.name}」（现有：${known}）`;
  const rules: Rules =
    params.get('sandbox') === '1'
      ? { ...SANDBOX_RULES, scenario: scenario.id }
      : scenarioRules(scenario);
  // 沙盒没有委托（rules.goal 为 null），不显示历史卡和结算。
  return { world: worldFor(scenario), seed: scenario.seed, rules, problem, scenario: rules.goal ? scenario : null };
}

async function main(): Promise<void> {
  const { world, seed: defaultSeed, rules, problem, scenario } = chosenWorld();
  const species = speciesFor(world);
  // 设计编译的数据：设计台用它，也放进配置，让操作接口能重新编译、核对投放的设计物种（存档、日志自带一份）。
  const kit = makeDesignKit(
    partLibrary,
    scalingLaws,
    hintTemplates,
    viabilityRules,
    [...plantLibrary.values()],
    designTemplates.map((t) => t.design),
  );
  // 档案馆的条目也进配置：不附设计的引种必须和其中一条一模一样。
  const config = {
    seed: intParam('seed', defaultSeed, 0xffff_ffff),
    world,
    species,
    tools: toolData,
    design: designDataOf(kit),
    catalog: [...speciesLibrary.values()],
  };

  // 推演在 Web Worker 里跑（src/runtime/simWorker.ts），主线程只渲染、收输入。
  // 有委托时开局先停着，等玩家读完历史卡。
  const worker = new Worker(new URL('./runtime/simWorker.ts', import.meta.url), { type: 'module' });
  const session = new RemoteSession(worker, config, rules, intParam('speed', 1, 1000), scenario !== null);
  const status = el('status');
  status.textContent = problem;
  // 第一份视图到了才能建画面；它带着开局那天的曲线数据，先留着。
  const firstDays: DayRecord[] = [];
  await new Promise<void>((resolve, reject) => {
    session.onView = (days) => {
      firstDays.push(...days);
      resolve();
    };
    session.onError = (message) => reject(new Error(message));
  }).catch((e: Error) => {
    status.textContent = `推演启动失败：${e.message}`;
    throw e;
  });
  session.onError = (message) => (status.textContent = `推演出错：${message}`);

  // 剪纸画面（2026-10-22 定下的美术方向）；?art=notes 是田野笔记的旧画面，界面统一成剪纸之前留作对比。
  const paper = new URLSearchParams(location.search).get('art') !== 'notes';
  if (paper) status.textContent = '画剪纸地图……';
  const view: GameView = paper
    ? await (await import('./render/paper/view')).PaperView.mount(el('app'), session.sim.state, session.species)
    : await MapView.mount(el('app'), session.sim.state, session.species);
  if (paper) status.textContent = problem;
  /** 这一局现在的物种（id 和名字），按物种下标排。 */
  const speciesList = (): { id: string; name: string }[] => session.species.map((s) => ({ id: s.params.id, name: s.params.name }));
  /** 物种名，按物种下标排。引进了新物种时换成新的（见 syncSpecies）。 */
  let names = session.species.map((s) => s.params.name);
  const hud = new Hud(el('ribbon'), el('hud'));
  const deaths = new DeathPanel(el('deaths'), names);
  const captures = new FieldLog(el('captures'), el('exam-card'), session.species, toolData, necropsyTemplates);
  const alertBanner = new AlertBanner(el('alert'), names, (at) =>
    view.camera.preset('region', { x: (at.x + 0.5) * CELL_PX, y: (at.y + 0.5) * CELL_PX }),
  );
  // 委托的卡片：开局读历史卡，每季结算单，结束时总结。卡片开着时推演停着（Worker 结算后也会自己停下等）。
  const cards = scenario ? new CommissionCards(el('modal'), scenario, session.species.map((s) => s.params.id)) : null;
  let shownQuarters = 0;
  // 自然档案馆：翻看现有技术；情景允许引种时，条目上有"引进到这里"。开着时推演暂停。
  /** 选好了要引进的物种（档案馆的真实物种，或设计台的设计）和数量、等着在地图上点地点；null 表示没在引进。 */
  let introducing: { species: SpeciesParams; design?: Design; count: number } | null = null;
  const startIntroducing = (choice: NonNullable<typeof introducing>): void => {
    tools.stopReleasing();
    field.stop();
    introducing = choice;
    status.textContent = modeHint();
  };
  const intro = toolData.introduction;
  const archive = new ArchivePanel(
    el('archive'),
    archiveLibrary,
    speciesLibrary,
    rules.introduction.allowed && intro
      ? {
          maxAnimals: intro.maxAnimals,
          quote: (id, count) => {
            const p = speciesLibrary.get(id)!;
            if (rules.introduction.banned.includes(id)) return { text: `业主明令禁止引进${p.name}`, allowed: false };
            const c = costOf({ type: 'introduce', species: p, x: 0, y: 0, count }, toolData, world.cellSizeM);
            return { text: `${c.budget.toLocaleString('zh-CN')} 元（购买、运输、检疫），${c.staff} 支队伍 ${c.days} 天；引进后收不回来`, allowed: true };
          },
          start: (id, count) => startIntroducing({ species: speciesLibrary.get(id)!, count }),
        }
      : undefined,
  );
  /** 正在等着点地图的模式的提示（状态栏清空时还原它，免得模式开着却看不出来）。 */
  const modeHint = (): string =>
    introducing ? `在地图上点一下投放 ${introducing.count} 只${introducing.species.name}（按 Esc 取消）` : '';
  // Esc：先关开着的档案馆或设计台，再取消引进模式。
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 正在输入框里打字（比如设计的名字）：Esc 只退出输入框，不关面板。
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
      t.blur();
      return;
    }
    if (archive.isOpen || desk.isOpen) {
      archive.close();
      desk.close();
    } else if (dock.kind) {
      dock.close();
    } else if (introducing) {
      introducing = null;
      status.textContent = '取消了引进';
    }
  });
  // 设计台：拼部件、看推导和能量收支；情景允许时可以把设计投放到地图上。开着时推演暂停。
  const desk = new DesignDesk(
    el('design'),
    kit,
    designSlots,
    designTemplates,
    speciesLibrary,
    rules.introduction.designs && intro
      ? {
          maxAnimals: intro.maxAnimals,
          quote: (species, count) => {
            const c = costOf({ type: 'introduce', species, x: 0, y: 0, count }, toolData, world.cellSizeM);
            return `${c.budget.toLocaleString('zh-CN')} 元（繁育、运输），${c.staff} 支队伍 ${c.days} 天；投放后收不回来`;
          },
          start: (design, species, count) => startIntroducing({ species, design, count }),
        }
      : undefined,
  );
  cards?.briefing(names);
  const history = new PopulationHistory([...names, '平均植被']);
  const chart = new PopulationChart(
    el<HTMLCanvasElement>('chart'),
    history,
    world.plants[herbIndex(world)]!.maxBiomass,
    session.species.map((s) => colorOf(s.params).chart),
  );
  // 点图切换纵轴：各自比例 ↔ 对数（只是看法，不进操作日志）。
  el<HTMLCanvasElement>('chart').addEventListener('click', () => {
    chart.scale = chart.scale === 'relative' ? 'log' : 'relative';
  });

  /** 所有玩家操作都从这里进统一操作接口（在 Worker 里的 Session.submit）；被拒绝时在状态栏说明原因。 */
  const submit = async (op: Op): Promise<boolean> => {
    const r = await session.submit(op);
    status.textContent = r.ok ? modeHint() : `操作被拒绝：${r.reason}`;
    return r.ok;
  };

  // 换了一局（换种子、读档）：清掉按局缓存的界面。读进来的局已经结算过的季度不再弹出。
  const restart = (): void => {
    hud.reset();
    deaths.reset();
    captures.reset();
    alertBanner.reset();
    shownQuarters = session.quarters.length;
    introducing = null;
    cards?.close();
    history.clear();
    view.redraw();
  };
  // 物种列表变了（引进了新物种，或读档后物种不同）：各处按物种下标排的名字、颜色、选项跟着换。
  let speciesVersion = session.speciesVersion;
  const syncSpecies = (): void => {
    if (session.speciesVersion === speciesVersion) return;
    speciesVersion = session.speciesVersion;
    const list = speciesList();
    names = list.map((s) => s.name);
    view.setSpecies(session.species);
    deaths.names = names;
    deaths.reset();
    alertBanner.names = names;
    captures.setSpecies(session.species);
    if (cards) cards.speciesIds = list.map((s) => s.id);
    history.setSpecies(names);
    chart.colors = session.species.map((s) => colorOf(s.params).chart);
    tools.setSpecies(list);
    field.setSpecies(list);
    layers.setSpecies(names);
  };
  session.onView = (days, regenerated) => {
    if (regenerated) restart();
    syncSpecies();
    for (const d of days) history.recordValues(d.day, d.totals, d.veg);
  };
  for (const d of firstDays) history.recordValues(d.day, d.totals, d.veg);

  // 这一局的标签：存档文件名和浏览器存档位都用它（情景、情景当沙盒、草原各不相同）。
  const label = `${rules.scenario ?? 'grassland'}${rules.goal ? '' : '-sandbox'}`;
  const fileName = (day: number, suffix = ''): string => `patently-alive-${label}-seed${session.sim.state.config.seed}-day${day}${suffix}.json`;

  /** 载入存档文件或操作日志（解析、核对、恢复都在 Worker 里做）。 */
  const loadText = (text: string): void => {
    status.textContent = '载入中……';
    void session.load(text).then((r) => (status.textContent = r.message));
  };

  const tools = bindToolControls(
    el('tool-bar'),
    speciesList(),
    {
      reseed: (seed) => session.reseed(seed),
      exportFile: () => session.saveText().then(({ text, day }) => ({ name: fileName(day), text })),
      exportLog: () => session.logText().then(({ text, day }) => ({ name: fileName(day, '-log'), text })),
      importFile: (text) => loadText(text),
      quickSave: () => {
        void session
          .saveText()
          .then(({ text, day }) => writeSlot(label, text).then(() => day))
          .then(
            (day) => (status.textContent = `已存档（第 ${day} 天）`),
            (e: Error) => (status.textContent = `存档失败：${e.message}`),
          );
      },
      quickLoad: () => {
        readSlot(label).then(
          (v) => {
            if (!v) status.textContent = '这个情景还没有存档';
            else loadText(v.text);
          },
          (e: Error) => (status.textContent = `读档失败：${e.message}`),
        );
      },
    },
    rules.allowRelease,
    () => {
      field.stop();
      introducing = null;
    },
  );
  const field = bindFieldTools(
    el('field-tools'),
    toolData,
    speciesList(),
    world.cellSizeM,
    () => {
      tools.stopReleasing();
      introducing = null;
    },
  );

  // 下方工具栏：兽医箱的五类工具、档案馆、设计台。
  const dock = bindDock(el('dock'), el('tool-pop'), {
    choose: (kind) => field.choose(kind),
    stop: () => field.stop(),
    archive: () => {
      desk.close();
      archive.toggle();
    },
    desk: () => {
      archive.close();
      desk.toggle();
    },
  });
  // 左边的笔记本：记录、死因、曲线、文件（种子、存档、校验和）。
  bindNotebook(el('nb-tabs'), el('nb-page'), [
    ['记录', el('nb-log')],
    ['死因', el('nb-deaths')],
    ['曲线', el('nb-chart')],
    ['文件', el('nb-file')],
  ]);
  const viewCard = bindViewCard(el('view-card'), view.camera, view.angles);
  const syncCamera = bindCameraControls(view.canvas, view.camera, viewCard.presets, (screen) => {
    const pos = view.camera.screenToWorld(screen);
    const cell = worldToCell(pos);
    if (introducing) {
      // 先退出引进模式再提交：引进不可撤销，提交还没回音时再点一下不能再引一批。被拒绝了再回到模式里重选地点。
      const chosen = introducing;
      introducing = null;
      const { species, design, count } = chosen;
      void submit({ type: 'introduce', species, x: cell.x, y: cell.y, count, ...(design ? { design } : {}) }).then((ok) => {
        if (!ok) {
          introducing = chosen;
          return;
        }
        status.textContent = `在 (${cell.x}, ${cell.y}) 放出了${design ? '设计的' : '引进的'} ${count} 只${species.name}`;
      });
      return;
    }
    if (field.isPlacing()) {
      const op = field.click(cell, worldToCorner(pos));
      if (!op) {
        status.textContent = '围栏起点已定，再点终点';
        return;
      }
      void submit(op).then((ok) => {
        if (!ok) return;
        status.textContent = placedText(op, (id) => session.species.find((x) => x.params.id === id)?.params.name ?? id);
        field.stop();
      });
      return;
    }
    if (!tools.isReleasing()) return;
    const { id, count } = tools.releaseChoice();
    void submit({ type: 'release', species: id, x: cell.x, y: cell.y, count }).then((ok) => {
      if (ok) status.textContent = `在 (${cell.x}, ${cell.y}) 投放了 ${count} 只`;
    });
  });
  const layers = bindLayerControls(el('layer-bar'), names, (layer) => view.setLayer(layer));

  const syncTime = bindTimeControls(
    el('time-bar'),
    () => session.speed,
    (speed) => void submit({ type: 'setSpeed', speed }),
    () => {
      if (!cards?.isOpen && !archive.isOpen && !desk.isOpen) session.stepDay();
    },
  );

  // 镜头放大到地块档时，以画面中心为准请求关注区；拉远时全部收拢。
  // 关注区会影响推演结果，所以作为一条操作提交，写进日志。等上一次请求有了回音再发下一次，免得重复记进日志。
  let focusInFlight = false;
  const syncFocus = (): void => {
    if (focusInFlight) return;
    let want: FocusRect | null = null;
    const { grid } = session.sim.state;
    if (view.closeUp) {
      const v = view.visibleCells();
      want = focusAround(v.cx, v.cy, v.w, v.h, grid.width, grid.height);
    }
    if (sameFocus(want, session.sim.state.requestedFocus)) return;
    focusInFlight = true;
    void submit({ type: 'setFocus', focus: want }).then(() => {
      // 回音到了；下一份视图一定带着提交之后的状态，到时再比较。
      session.afterNextView(() => (focusInFlight = false));
    });
  };

  // ?perf=1：在状态栏显示主线程每帧花在脚本上的时间（不含 GPU），检查性能用。
  const perf = new URLSearchParams(location.search).get('perf') === '1' ? { sum: 0, worst: 0, n: 0, since: performance.now() } : null;

  view.ticker.add(() => {
    const frameStart = perf ? performance.now() : 0;
    const state = session.sim.state;
    syncFocus();
    // 新的季度结算：弹出结算单（Worker 结算后已经停下等着）。
    if (cards && session.quarters.length > shownQuarters) {
      shownQuarters = session.quarters.length;
      cards.quarter(session.quarters.at(-1)!, session, names);
    }
    session.hold((cards?.isOpen ?? false) || archive.isOpen || desk.isOpen);
    view.setFenceStart(field.fenceStart());
    alertBanner.update(session.sim.day, session.alerts);
    view.setAlertAt(session.alerts[0]?.at ?? null);
    view.draw(state);
    layers.legend(`最深处 ≈ ${view.deathLegendMax.toFixed(1)} 只（近期死亡，${RECENT_HALF_LIFE_DAYS} 天半衰期）`);
    hud.update(session);
    deaths.update(state);
    captures.update(state);
    chart.draw();
    syncCamera();
    viewCard.sync();
    dock.sync(archive.isOpen, desk.isOpen);
    syncTime();
    session.requestFrame();
    if (perf) {
      const ms = performance.now() - frameStart;
      perf.sum += ms;
      perf.worst = Math.max(perf.worst, ms);
      perf.n += 1;
      if (frameStart - perf.since > 2000) {
        status.textContent = `主线程每帧 ${(perf.sum / perf.n).toFixed(1)} ms（最慢 ${perf.worst.toFixed(1)} ms），第 ${session.sim.day} 天`;
        Object.assign(perf, { sum: 0, worst: 0, n: 0, since: frameStart });
      }
    }
  });
}

/** 放置成功后状态栏的说明。 */
function placedText(op: Op, nameOf: (id: string) => string): string {
  switch (op.type) {
    case 'trap':
      return `在 (${op.x}, ${op.y}) 布了陷阱，${op.nights} 晚`;
    case 'cull':
      return `今晚在 (${op.x}, ${op.y}) 一带搜捕`;
    case 'sample':
      return `今天在 (${op.x}, ${op.y}) 一带抓${nameOf(op.species)}做体检，傍晚有结果`;
    case 'necropsy':
      return `今天在 (${op.x}, ${op.y}) 一带找尸体，傍晚带回来`;
    case 'fence':
      return `开始架围栏 (${op.x0}, ${op.y0})–(${op.x1}, ${op.y1})`;
    default:
      return '';
  }
}

void main();
