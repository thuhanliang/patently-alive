import { FixedStepClock, Sim } from './sim';
import { GreyboxView } from './render/view';
import { Hud } from './ui/hud';

// 地址栏 ?seed=123 可以换种子；不合法时回到默认种子。
// （正式的"改种子"操作在第 5 步走统一操作接口。）
function seedFromUrl(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff ? n : 1;
}

async function main(): Promise<void> {
  const host = document.getElementById('app');
  const hudEl = document.getElementById('hud');
  if (!host || !hudEl) throw new Error('index.html 缺少 #app 或 #hud');

  const sim = Sim.create({ seed: seedFromUrl() });
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 20 });
  const view = await GreyboxView.mount(host);
  const hud = new Hud(hudEl);

  view.ticker.add((ticker) => {
    sim.stepN(clock.advance(ticker.deltaMS));
    view.draw(sim.state);
    hud.update(sim.state, clock.speed);
  });
}

void main();
