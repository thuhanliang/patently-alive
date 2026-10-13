import { describe, expect, it } from 'vitest';

/**
 * 铁律 1：模拟内核不依赖渲染、DOM 或系统时钟。
 * tsconfig.sim.json 已经在类型层面挡住了 DOM；这里再挡住语言本身就有的不确定来源。
 */
const sources = import.meta.glob('../src/sim/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Math 里只允许结果由 IEEE 754 精确规定的函数。
// sin、exp、log、pow 等在不同引擎上可能差最后一位，需要时在内核里自己实现。
const ALLOWED_MATH = new Set([
  'abs', 'ceil', 'floor', 'round', 'trunc', 'sign', 'min', 'max',
  'sqrt', 'imul', 'fround', 'clz32',
]);

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\bDate\b/, '系统时钟 Date'],
  [/\bperformance\b/, '系统时钟 performance'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\b/, '宿主定时器'],
  [/\bstructuredClone\b/, '宿主 API structuredClone'],
  [/from\s+['"]pixi\.js['"]/, '渲染库 pixi.js'],
  [/from\s+['"]\.\.\/(render|ui)\b/, 'src/render 或 src/ui'],
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('模拟内核的纯净性', () => {
  it('找到了内核源码', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
  });

  for (const [file, raw] of Object.entries(sources)) {
    it(file, () => {
      const code = stripComments(raw);
      for (const [re, what] of FORBIDDEN) {
        expect(re.test(code), `${file} 用到了 ${what}`).toBe(false);
      }
      for (const m of code.matchAll(/\bMath\.(\w+)/g)) {
        expect(ALLOWED_MATH.has(m[1]!), `${file} 用到了 Math.${m[1]}，结果不保证跨引擎一致`).toBe(true);
      }
    });
  }
});
