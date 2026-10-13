import { grassland, grasslandSpecies } from './data';
import { FixedStepClock, OpLogSchema, Session, TICKS_PER_DAY, focusAround, sameFocus, type FocusRect, type Op } from './sim';
import { worldToCell } from './render/projection';
import { GreyboxView } from './render/view';
import { bindCameraControls } from './ui/cameraControls';
import { PopulationChart } from './ui/chart';
import { PopulationHistory } from './ui/history';
import { Hud } from './ui/hud';
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

async function main(): Promise<void> {
  const newSession = (seed: number): Session => new Session({ seed, world: grassland, species: grasslandSpecies });
  let session = newSession(intParam('seed', 1, 0xffff_ffff));

  // 一帧最多推进两天：推演每天要算整张地图，再多画面就卡了。倍速太高时实际速度会低于设定。
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: TICKS_PER_DAY * 2 });
  const view = await GreyboxView.mount(el('app'), session.sim.state, session.sim.species);
  const hud = new Hud(el('hud'));
  const status = el('status');
  const names = session.sim.species.map((s) => s.params.name);
  const history = new PopulationHistory([...names, '平均植被']);
  const chart = new PopulationChart(el<HTMLCanvasElement>('chart'), history, grassland.vegetation.maxBiomass);

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
            JSON.stringify(parsed.data.config.species) === JSON.stringify(cur.species);
          if (!same) {
            status.textContent = '这份日志的世界或物种数据和当前不同，暂不支持载入';
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
  );

  const syncCamera = bindCameraControls(view.canvas, view.camera, el('camera-bar'), (screen) => {
    if (!tools.isReleasing()) return;
    const cell = worldToCell(view.camera.screenToWorld(screen));
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
    view.draw(session.sim.state);
    hud.update(session.sim.state, session.speed, session.entries.length);
    chart.draw();
    syncCamera();
    syncTime();
  });
}

void main();
