import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径，方便以后直接部署到 GitHub Pages 的子路径下。
  base: './',
  build: {
    rollupOptions: {
      // 游戏本体，加上 M0 的剪纸风格 demo（独立页面，只读推演）和 M1 的设计台玩具（独立页面）。
      input: { main: 'index.html', paper: 'paper.html', desk: 'desk.html' },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // 有几个测试要跑两年推演，默认 5 秒不够。
    testTimeout: 30_000,
  },
});
