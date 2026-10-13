import { defineConfig } from 'vitest/config';

// 批量推演单独一个配置：不跟着 npm test 跑（太慢），用 npm run sweep 手动跑。
export default defineConfig({
  test: {
    include: ['scripts/**/*.bench.ts'],
    testTimeout: 3_600_000,
  },
});
