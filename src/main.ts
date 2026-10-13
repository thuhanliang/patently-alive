import { grassland } from './data';
import { FixedStepClock, Sim } from './sim';
import { GreyboxView } from './render/view';
import { bindCameraControls } from './ui/cameraControls';
import { Hud } from './ui/hud';

// 地址栏 ?seed=123 可以换种子，?speed=10 可以换倍速；不合法时用默认值。
// （正式的"改种子 / 调速"操作在第 5 步走统一操作接口。）
function intParam(name: string, fallback: number, max: number): number {
  const raw = new URLSearchParams(location.search).get(name);
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

async function main(): Promise<void> {
  const host = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  const toolbar = document.getElementById('toolbar');
  if (!host || !hudEl || !toolbar) throw new Error('index.html 缺少 #app、#hud 或 #toolbar');

  const sim = Sim.create({ seed: intParam('seed', 1, 0xffff_ffff), world: grassland });
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 2000 });
  clock.speed = intParam('speed', 1, 1000);
  const view = await GreyboxView.mount(host, sim.state);
  const hud = new Hud(hudEl);
  const syncToolbar = bindCameraControls(view.canvas, view.camera, toolbar);

  view.ticker.add((ticker) => {
    sim.stepN(clock.advance(ticker.deltaMS));
    view.draw(sim.state);
    hud.update(sim.state, clock.speed);
    syncToolbar();
  });
}

void main();
