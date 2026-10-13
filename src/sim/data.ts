/**
 * 推演状态的数据工具：深拷贝、序列化、校验和。
 *
 * 推演状态只允许这些"纯数据"：数字、字符串、布尔、null、数组、普通对象，
 * 以及 Float64Array / Int32Array / Uint8Array（格子数据用它们，省内存也快）。
 * 不用 structuredClone：它是宿主环境的 API，模拟内核不依赖宿主环境。
 */

type TypedArray = Float64Array | Int32Array | Uint8Array;

const TYPED_TAGS = {
  f64: Float64Array,
  i32: Int32Array,
  u8: Uint8Array,
} as const;
type TypedTag = keyof typeof TYPED_TAGS;

function typedTag(value: unknown): TypedTag | null {
  if (value instanceof Float64Array) return 'f64';
  if (value instanceof Int32Array) return 'i32';
  if (value instanceof Uint8Array) return 'u8';
  return null;
}

function assertFinite(n: number): void {
  if (!Number.isFinite(n)) throw new RangeError(`状态里出现了非有限数：${n}`);
}

/** 纯数据的深拷贝，类型化数组也照原类型拷贝。 */
export function cloneData<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (typedTag(value)) return (value as unknown as TypedArray).slice() as T;
  if (Array.isArray(value)) return value.map(cloneData) as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value)) out[k] = cloneData((value as Record<string, unknown>)[k]);
  return out as T;
}

/**
 * 把状态转成可以 JSON.stringify 的形式：类型化数组写成 {"$f64": [...]}。
 * 对象按键名排序，和插入顺序无关。
 */
export function encodeData(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') assertFinite(value);
    return value;
  }
  const tag = typedTag(value);
  if (tag) {
    const arr = Array.from(value as unknown as TypedArray);
    for (const n of arr) assertFinite(n);
    return { [`$${tag}`]: arr };
  }
  if (Array.isArray(value)) return value.map(encodeData);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) out[k] = encodeData((value as Record<string, unknown>)[k]);
  return out;
}

/** encodeData 的逆运算。 */
export function decodeData<T>(value: unknown): T {
  if (value === null || typeof value !== 'object') return value as T;
  if (Array.isArray(value)) return value.map((v) => decodeData(v)) as T;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0]!.startsWith('$')) {
    const tag = keys[0]!.slice(1);
    if (Object.hasOwn(TYPED_TAGS, tag)) {
      return TYPED_TAGS[tag as TypedTag].from((value as Record<string, number[]>)[keys[0]!]!) as T;
    }
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = decodeData((value as Record<string, unknown>)[k]);
  return out as T;
}

export function serialize(value: unknown): string {
  return JSON.stringify(encodeData(value));
}

export function deserialize<T>(text: string): T {
  return decodeData<T>(JSON.parse(text));
}

/**
 * 状态校验和（FNV-1a，32 位）：逐个喂入数字的 64 位 IEEE 表示，所以是逐位比较，不经过字符串。
 * 对象按键名排序。用来快速比对两次推演是否逐位相同，以后也用于回放校验。
 */
export function checksum(value: unknown): number {
  const h = new Hasher();
  h.value(value);
  return h.digest();
}

class Hasher {
  private h = 0x811c9dc5;
  // 用 DataView 固定按小端取字，校验和与宿主的字节序无关。
  private readonly view = new DataView(new ArrayBuffer(8));

  digest(): number {
    return this.h >>> 0;
  }

  private u32word(x: number): void {
    for (let s = 0; s < 32; s += 8) {
      this.h ^= (x >>> s) & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
    }
  }

  private num(n: number): void {
    assertFinite(n);
    this.view.setFloat64(0, n === 0 ? 0 : n, true); // -0 和 0 视为相同
    this.u32word(this.view.getUint32(0, true));
    this.u32word(this.view.getUint32(4, true));
  }

  private str(s: string): void {
    this.u32word(s.length);
    for (let i = 0; i < s.length; i++) this.u32word(s.charCodeAt(i));
  }

  value(v: unknown): void {
    if (v === null) return this.u32word(0);
    switch (typeof v) {
      case 'boolean': return this.u32word(v ? 2 : 1);
      case 'number': this.u32word(3); return this.num(v);
      case 'string': this.u32word(4); return this.str(v);
      case 'object': break;
      default: throw new TypeError(`状态里出现了不支持的类型：${typeof v}`);
    }
    const tag = typedTag(v);
    if (tag) {
      const arr = v as TypedArray;
      this.u32word(5);
      this.str(tag);
      this.u32word(arr.length);
      for (let i = 0; i < arr.length; i++) this.num(arr[i]!);
      return;
    }
    if (Array.isArray(v)) {
      this.u32word(6);
      this.u32word(v.length);
      for (const x of v) this.value(x);
      return;
    }
    const keys = Object.keys(v).sort();
    this.u32word(7);
    this.u32word(keys.length);
    for (const k of keys) {
      this.str(k);
      this.value((v as Record<string, unknown>)[k]);
    }
  }
}
