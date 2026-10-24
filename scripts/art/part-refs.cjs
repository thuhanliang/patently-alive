// 零件参考图（handoff/007）：打开 partsheet.html 的每一张表，截成 2048×2048 的 PNG。
// 用法：先 `npx vite --port 5181`，再 `node scripts/art/part-refs.cjs [http://localhost:5181]`。
// 产出：art/incoming/refs/007/<表>.png（发给 Lovart）和 <表>-labeled.png（带零件名和转轴蓝圈，给人看）。
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const base = process.argv[2] ?? 'http://localhost:5181';
const out = path.join(__dirname, '../../art/incoming/refs/007');
const SHEETS = ['B0', 'B1', 'B2', 'B3', 'B4', 'B4P', 'B5', 'B5P', 'B6'];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 2048, height: 2048 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('页面出错：', e.message));
  for (const s of SHEETS) {
    for (const labels of s === 'B0' ? [false] : [false, true]) {
      await page.goto(`${base}/partsheet.html?sheet=${s}${labels ? '&labels=1' : ''}`);
      await page.waitForSelector('body[data-ready="1"]');
      await page.waitForTimeout(300);
      const file = path.join(out, `${s}${labels ? '-labeled' : ''}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 2048, height: 2048 } });
      console.log(file);
    }
  }
  await browser.close();
})();
