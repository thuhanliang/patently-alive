// 给游戏页面截一张图。
// 用法：node scripts/shots/shot.cjs "<网址>" out.png [宽 高 等待毫秒]
// 例：node scripts/shots/shot.cjs "http://127.0.0.1:6173/index.html?scenario=garden-island&demo=rabbit" a.png 1280 800 15000
// 游戏里的开发参数：?scenario=… ?all=1（委托全部打开）?demo=<现有技术>（直接放 20 只）?fps=n（限帧）?map=paper（旧的剪纸地图）
const { chromium } = require('playwright');
(async () => {
  const [, , url, out, w, h, wait] = process.argv;
  const b = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl-egl'] });
  const p = await b.newPage({ viewport: { width: +w || 1280, height: +h || 800 }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('页面错误', e.message));
  await p.goto(url, { timeout: 120000 });
  await p.waitForTimeout(+wait || 10000);
  await p.screenshot({ path: out, timeout: 120000 });
  await b.close();
})();
