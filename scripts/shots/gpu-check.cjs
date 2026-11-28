// 检查无头浏览器的 WebGL 用的是真显卡还是软件渲染（SwiftShader / llvmpipe 就是软件的，会很慢）。
// 用法：node scripts/shots/gpu-check.cjs
const { chromium } = require('playwright');
(async () => {
  const args = ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl-egl', '--enable-unsafe-webgpu'];
  const b = await chromium.launch({ args });
  const p = await b.newPage();
  const info = await p.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '没有 WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  console.log('WebGL renderer:', info);
  console.log(/swiftshader|llvmpipe|software/i.test(String(info)) ? '→ 软件渲染（慢）：检查显卡驱动和 /dev/dri 权限' : '→ 用的是显卡');
  await b.close();
})();
