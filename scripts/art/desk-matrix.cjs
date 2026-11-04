// handoff/008 的现状图：设计台在一组参数下的截图（先 npx vite --port 5179）。用法：node scripts/art/desk-matrix.cjs <输出目录> desk|phone
const { chromium, devices } = require('playwright');
(async () => {
  const [out, kind] = process.argv.slice(2);
  const phone = kind === 'phone';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext(phone ? { ...devices['iPhone 13'], deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('http://localhost:5179/desk.html?mode=stand&manual=1&cut=P11-cat');
  await p.waitForFunction(() => window.desk, null, { timeout: 30000 });
  const BASE = { template: 'cat', mass: 3.3, leg: 0, tail: 0, fur: 0, climate: null, xray: false, mode: 'stand', allocation: { skeleton: 1, muscle: 1, gut: 1, heart: 1, fat: 1 }, appearance: { earLen: 1, earWide: 1, earStiff: 1, earPos: 0 } };
  const shots = phone
    ? [
        ['P01-cat-handles', {}, 'handles'],
        ['P02-cat-xray', { xray: true }],
        ['P03-1000kg-longfur', { mass: 1000, fur: 0.6, leg: 0.2 }, 'handles'],
        ['P04-cold-shiver', { climate: -20 }],
      ]
    : [
        ['A01-cat-stand', {}],
        ['A02-cat-handles', {}, 'handles'],
        ['A03-cat-dragging-mass', {}, 'drag'],
        ['A04-cat-walk', { mode: 'walk' }],
        ['E01-mass-0.01kg', { mass: 0.01 }],
        ['E02-mass-1000kg', { mass: 1000 }],
        ['E03-legs-long', { leg: 0.2 }],
        ['E04-legs-short', { leg: -0.2 }],
        ['E05-tail-long', { tail: 0.3, parts: { tail: 'balance_tail' } }],
        ['E06-fur-max', { fur: 0.6 }],
        ['E07-fur-bare', { fur: -1 }],
        ['E08-ears-huge-floppy', { appearance: { earLen: 3, earWide: 2, earStiff: 0, earPos: 1 } }],
        ['E09-fat-max', { allocation: { fat: 4 } }],
        ['E10-combo-giant', { mass: 1000, leg: 0.2, tail: 0.3, fur: 0.6, appearance: { earLen: 2.5, earWide: 1.6 } }],
        ['E11-combo-tiny-odd', { mass: 0.01, leg: -0.2, fur: -1, parts: { mouth: 'hooked_beak', limbs: 'digging_claws', tail: 'bushy_tail' } }],
        ['E12-combo-odd-run', { parts: { mouth: 'probe_bill', limbs: 'running_legs', tail: 'fat_tail' }, leg: 0.2, mode: 'run' }],
        ['X01-xray-cat', { xray: true }],
        ['X02-xray-bone-heavy', { xray: true, allocation: { skeleton: 2.5, muscle: 0.6 } }],
        ['X03-xray-muscle-heavy', { xray: true, allocation: { skeleton: 0.7, muscle: 2.5 } }],
        ['X04-xray-walk', { xray: true, mode: 'walk' }],
        ['X05-xray-1000kg', { xray: true, mass: 1000 }],
        ['S01-cold-shiver', { climate: -20 }],
        ['S02-hot-pant', { climate: 40, fur: 0.6 }],
        ['S03-fatal-weight', { mass: 1000, leg: 0.2, allocation: { skeleton: 0.4 } }],
      ];
  for (const [name, s, how] of shots) {
    await p.evaluate(([B, s]) => { window.desk.set({ ...B, ...s, allocation: { ...B.allocation, ...(s.allocation || {}) }, appearance: { ...B.appearance, ...(s.appearance || {}) }, parts: { mouth: 'carnassials', limbs: 'climbing_claws', tail: 'balance_tail', ...(s.parts || {}) } }); for (let i = 0; i < 150; i++) window.desk.step(1 / 30); }, [BASE, s]);
    if (!how && !phone) { await p.mouse.move(100, 100); await p.evaluate(() => { for (let i = 0; i < 60; i++) window.desk.step(1 / 30); }); }
    if (how === 'handles' || how === 'drag') {
      const hs = await p.evaluate(() => window.desk.handles().map((h) => ({ id: h.id, x: h.at.x, y: h.at.y })));
      const bk = hs.find((h) => h.id === 'back') || hs[0];
      if (phone) {
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bk.x, y: bk.y + 15, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await p.mouse.move(bk.x, bk.y + 20);
        await p.mouse.move(bk.x + 1, bk.y + 20);
        if (how === 'drag') {
          await p.mouse.move(bk.x, bk.y);
          await p.mouse.down();
          for (let i = 1; i <= 6; i++) { await p.mouse.move(bk.x, bk.y - 12 * i); await p.evaluate(() => window.desk.step(1 / 30)); }
        }
      }
      await p.evaluate(() => { for (let i = 0; i < 4; i++) window.desk.step(1 / 30); });
    }
    await p.screenshot({ path: `${out}/${name}.png` });
    if (how === 'drag') await p.mouse.up();
    console.log(name);
  }
  await b.close();
})();
