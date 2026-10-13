import { grassland, grasslandSpecies } from './data';
import { FixedStepClock, Sim, TICKS_PER_DAY } from './sim';
import { GreyboxView } from './render/view';
import { bindCameraControls } from './ui/cameraControls';
import { PopulationChart } from './ui/chart';
import { PopulationHistory } from './ui/history';
import { Hud } from './ui/hud';
import { bindLayerControls } from './ui/layerControls';
import { bindTimeControls } from './ui/timeControls';

// 地址栏 ?seed=123 可以换种子，?speed=10 可以换开局倍速；不合法时用默认值。
// （正式的"改种子 / 调速"操作在第 5 步走统一操作接口。）
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

async function main(): Promise<void> {
  const sim = Sim.create({ seed: intParam('seed', 1, 0xffff_ffff), world: grassland, species: grasslandSpecies });
  // 一帧最多推进两天：推演每天要算整张地图，再多画面就卡了。倍速太高时实际速度会低于设定。
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: TICKS_PER_DAY * 2 });
  clock.speed = intParam('speed', 1, 1000);

  const view = await GreyboxView.mount(el('app'), sim.state);
  const hud = new Hud(el('hud'));
  const names = sim.species.map((s) => s.params.name);
  const history = new PopulationHistory([...names, '平均植被']);
  const chart = new PopulationChart(el<HTMLCanvasElement>('chart'), history, grassland.vegetation.maxBiomass);

  const syncCamera = bindCameraControls(view.canvas, view.camera, el('camera-bar'));
  bindLayerControls(el('layer-bar'), names, (layer) => view.setLayer(layer));

  const advance = (ticks: number): void => {
    for (let i = 0; i < ticks; i++) {
      sim.step();
      if (sim.tick % TICKS_PER_DAY === 0) history.record(sim.tick / TICKS_PER_DAY, sim.state);
    }
  };
  history.record(0, sim.state);
  const syncTime = bindTimeControls(el('time-bar'), clock, () => advance(TICKS_PER_DAY - (sim.tick % TICKS_PER_DAY)));

  view.ticker.add((ticker) => {
    advance(clock.advance(ticker.deltaMS));
    view.draw(sim.state);
    hud.update(sim.state, clock.speed);
    chart.draw();
    syncCamera();
    syncTime();
  });
}

void main();
