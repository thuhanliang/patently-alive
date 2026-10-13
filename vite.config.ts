import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相对路径，方便以后直接部署到 GitHub Pages 的子路径下。
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
