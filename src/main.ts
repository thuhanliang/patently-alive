import { grassland, scenarioLibrary, speciesFor, tools as toolData, worldFor, type WorldParams } from './data';
import { FixedStepClock, OpLogSchema, SANDBOX_RULES, Session, type Rules, TICKS_PER_DAY, focusAround, sameFocus, type FocusRect, type Op } from './sim';
import { worldToCell, worldToCorner } from './render/projection';
import { MapView } from './render/view';
import { speciesColor } from './render/palette';
import { bindCameraControls } from './ui/cameraControls';
import { PopulationChart } from './ui/chart';
import { PopulationHistory } from './ui/history';
import { Hud } from './ui/hud';
import { DeathPanel } from './ui/deathPanel';
import { CapturePanel } from './ui/capturePanel';
import { bindFieldTools } from './ui/fieldTools';
import { bindLayerControls } from './ui/layerControls';
import { bindTimeControls } from './ui/timeControls';
import { bindToolControls } from './ui/toolControls';

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

function chosenWorld(): { world: WorldParams; seed: number; rules: Rules; problem: string } {
  const params = new URLSearchParams(location.search);
  if (params.get('world') === 'grassland') return { world: grassland, seed: 1, rules: SANDBOX_RULES, problem: '' };
  const id = params.get('scenario') ?? DEFAULT_SCENARIO;
  const scenario = scenarioLibrary.get(id) ?? scenarioLibrary.get(DEFAULT_SCENARIO)!;
  const known = [...scenarioLibrary.keys()].join('、');
  const problem = scenario.id === id ? '' : `没有情景「${id}」，载入了「${scenario.name}」（现有：${known}）`;
  const rules: Rules =
    params.get('sandbox') === '1'
      ? { ...SANDBOX_RULES, scenario: scenario.id }
      : { scenario: scenario.id, ...scenario.resources, allowRelease: false, sentiment: scenario.sentiment };
  return { world: worldFor(scenario), seed: scenario.seed, rules, problem };
}

async function main(): Promise<void> {
  const { world, seed: defaultSeed, rules, problem } = chosenWorld();
  const species = speciesFor(world);
  const newSession = (seed: number): Session => new Session({ seed, world, species, tools: toolData }, rules);
  let session = newSession(intParam('seed', defaultSeed, 0xffff_ffff));

  // 一帧最多推进两天：推演每天要算整张地图，再多画面就卡了。倍速太高时实际速度会低于设定。
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: TICKS_PER_DAY * 2 });
  const view = await MapView.mount(el('app'), session.sim.state, session.sim.species);
  const hud = new Hud(el('hud'));
  const deaths = new DeathPanel(el('deaths'), session.sim.species.map((s) => s.params.name));
  const captures = new CapturePanel(el('captures'), session.sim.species.map((s) => s.params.name), toolData);
  const status = el('status');
  status.textContent = problem;
  const names = session.sim.species.map((s) => s.params.name);
  const history = new PopulationHistory([...names, '平均植被']);
  const chart = new PopulationChart(
    el<HTMLCanvasElement>('chart'),
    history,
    world.vegetation.maxBiomass,
    session.sim.species.map((s) => speciesColor(s.params.id).chart),
  );
  // 点图切换纵轴：各自比例 ↔ 对数（只是看法，不进操作日志）。
  el<HTMLCanvasElement>('chart').addEventListener('click', () => {
    chart.scale = chart.scale === 'relative' ? 'log' : 'relative';
  });

  /** 所有玩家操作都从这里进统一操作接口；被拒绝时在状态栏说明原因。 */
  const submit = (op: Op): boolean => {
    const r = session.submit(op);
    status.textContent = r.ok ? '' : `操作被拒绝：${r.reason}`;
    return r.ok;
  };

  const restart = (next: Session): void => {
    session = next;
    clock.reset();
    hud.reset();
    deaths.reset();
    captures.reset();
    history.clear();
    history.record(Math.floor(session.sim.tick / TICKS_PER_DAY), session.sim.state);
    view.redraw();
  };
  submit({ type: 'setSpeed', speed: intParam('speed', 1, 1000) });

  const tools = bindToolControls(
    el('tool-bar'),
    session.sim.species.map((s) => ({ id: s.params.id, name: s.params.name })),
    {
      reseed: (seed) => {
        const speed = session.speed;
        restart(newSession(seed));
        submit({ type: 'setSpeed', speed });
      },
      exportLog: () => session.exportLog(),
      importLog: (text) => {
        try {
          const json: unknown = JSON.parse(text);
          const parsed = OpLogSchema.safeParse(json);
          if (!parsed.success) {
            status.textContent = `不是有效的操作日志：${parsed.error.issues[0]?.message ?? ''}`;
            return;
          }
          // 画面、曲线都是按当前世界和物种建的；世界或物种不同的日志暂不支持载入。
          const cur = session.exportLog().config;
          const same =
            JSON.stringify(parsed.data.config.world) === JSON.stringify(cur.world) &&
            JSON.stringify(parsed.data.config.species) === JSON.stringify(cur.species) &&
            JSON.stringify(parsed.data.rules) === JSON.stringify(session.rules) &&
            JSON.stringify(parsed.data.config.tools) === JSON.stringify(cur.tools);
          if (!same) {
            status.textContent = '这份日志的世界、物种、工具数据或开局规则和当前不同，暂不支持载入';
            return;
          }
          const next = Session.replay(parsed.data);
          restart(next);
          status.textContent = `已回放到第 ${next.sim.tick} tick`;
        } catch (e) {
          status.textContent = `日志无法回放：${(e as Error).message}`;
        }
      },
    },
    rules.allowRelease,
    () => field.stop(),
  );
  const field = bindFieldTools(
    el('field-tools'),
    toolData,
    session.sim.species.map((s) => ({ id: s.params.id, name: s.params.name })),
    world.cellSizeM,
    () => tools.stopReleasing(),
  );

  const syncCamera = bindCameraControls(view.canvas, view.camera, el('camera-bar'), (screen) => {
    const pos = view.camera.screenToWorld(screen);
    const cell = worldToCell(pos);
    if (field.isPlacing()) {
      const op = field.click(cell, worldToCorner(pos));
      if (!op) {
        status.textContent = '围栏起点已定，再点终点';
        return;
      }
      if (submit(op)) {
        status.textContent = placedText(op);
        field.stop();
      }
      return;
    }
    if (!tools.isReleasing()) return;
    const { id, count } = tools.releaseChoice();
    if (submit({ type: 'release', species: id, x: cell.x, y: cell.y, count })) {
      status.textContent = `在 (${cell.x}, ${cell.y}) 投放了 ${count} 只`;
      view.redraw();
    }
  });
  bindLayerControls(el('layer-bar'), names, (layer) => view.setLayer(layer));

  const advance = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      session.advance(1);
      if (session.sim.tick % TICKS_PER_DAY === 0) history.record(session.sim.tick / TICKS_PER_DAY, session.sim.state);
    }
  };
  history.record(0, session.sim.state);
  const syncTime = bindTimeControls(
    el('time-bar'),
    () => session.speed,
    (speed) => submit({ type: 'setSpeed', speed }),
    () => advance(TICKS_PER_DAY - (session.sim.tick % TICKS_PER_DAY)),
  );

  // 镜头放大到地块档时，以画面中心为准请求关注区；拉远时全部收拢。
  // 关注区会影响推演结果，所以作为一条操作提交，写进日志。
  const syncFocus = (): void => {
    let want: FocusRect | null = null;
    if (view.closeUp) {
      const v = view.visibleCells();
      want = focusAround(v.cx, v.cy, v.w, v.h, session.sim.state.grid.width, session.sim.state.grid.height);
    }
    if (!sameFocus(want, session.sim.state.requestedFocus)) submit({ type: 'setFocus', focus: want });
  };

  view.ticker.add((ticker) => {
    syncFocus();
    if (clock.speed !== session.speed) {
      // 换速时清掉按旧速度攒下的零头，免得第一帧跳一下。
      clock.reset();
      clock.speed = session.speed;
    }
    advance(clock.advance(ticker.deltaMS));
    view.setFenceStart(field.fenceStart());
    view.draw(session.sim.state);
    hud.update(session);
    deaths.update(session.sim.state);
    captures.update(session.sim.state);
    chart.draw();
    syncCamera();
    syncTime();
  });
}

/** 放置成功后状态栏的说明。 */
function placedText(op: Op): string {
  switch (op.type) {
    case 'trap':
      return `在 (${op.x}, ${op.y}) 布了陷阱，${op.nights} 晚`;
    case 'cull':
      return `今晚在 (${op.x}, ${op.y}) 一带搜捕`;
    case 'necropsy':
      return `今天在 (${op.x}, ${op.y}) 一带找尸体，傍晚带回来`;
    case 'fence':
      return `开始架围栏 (${op.x0}, ${op.y0})–(${op.x1}, ${op.y1})`;
    default:
      return '';
  }
}

void main();
