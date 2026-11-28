import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径，方便以后直接部署到 GitHub Pages 的子路径下。
  base: './',
  // 开发服务器用 6173（5173 在用户的机器上被占用了）；npm run dev:lan 再加上 --host 0.0.0.0 给局域网访问。
  server: { port: 6173, strictPort: true },
  build: {
    rollupOptions: {
      // 游戏本体，加上 M0 的剪纸风格 demo（独立页面，只读推演）和 M1 的设计台玩具（独立页面）。
      input: { main: 'index.html', paper: 'paper.html', desk: 'desk.html', diorama: 'diorama.html', island3d: 'island3d.html', studio: 'studio.html', van: 'van.html', lab: 'lab.html', flora: 'flora.html', atlas: 'atlas.html', parts: 'parts.html' },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // 有几个测试要跑两年推演，默认 5 秒不够。
    testTimeout: 30_000,
  },
});
