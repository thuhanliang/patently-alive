const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 400, height: 300 } });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('http://localhost:5179/lab.html?manual=1&ref=0&part=van&model=mass&card=1&' + (process.argv[3] || 'open=1'));
  await p.waitForFunction(() => !!window.lab, null, { timeout: 600000 });
  const b64 = await p.evaluate(() => window.lab.exportGLB());
  fs.writeFileSync(process.argv[2], Buffer.from(b64, 'base64'));
  console.log('wrote', process.argv[2], fs.statSync(process.argv[2]).size);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
