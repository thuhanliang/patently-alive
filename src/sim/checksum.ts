/**
 * 状态校验和：对规范化的 JSON 做 FNV-1a（32 位）。
 * 用来快速比对两次推演是否逐位相同，以后也用于回放校验。
 * 只对纯数据（数字、字符串、布尔、数组、普通对象）有效；对象按键名排序，和插入顺序无关。
 */
export function checksum(value: unknown): number {
  const text = canonicalJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new RangeError(`状态里出现了非有限数：${value}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * 纯数据的深拷贝。不用 structuredClone：它是宿主环境的 API，不属于语言本身，
 * 模拟内核不依赖宿主环境。
 */
export function cloneData<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
