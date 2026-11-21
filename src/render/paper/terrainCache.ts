/**
 * 画好的剪纸地形存在浏览器里（IndexedDB，2026-11-22）：同一座岛、同一个种子、同样的植被，第二次打开直接拿出来，不用再画。
 * 读不到、存不下都当没有（隐私模式、空间满了），照常现画。只是画面的缓存，和推演无关。
 */
const DB = 'patently-alive-terrain';
const STORE = 'tiles';
/** 画法改了就改这个版本号，旧的缓存自动作废。 */
const VERSION = 1;
/** 同一座岛最多留几张（植被变了会有新的）。 */
const KEEP = 4;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** 缓存的键：世界、种子、细分、植被（量化以后的指纹）。 */
export function terrainKey(world: string, seed: number, detail: number, herb: Float32Array, shrub: Float32Array): string {
  let h = 2166136261 >>> 0;
  const mix = (v: number): void => {
    h ^= v;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (let i = 0; i < herb.length; i++) {
    mix(Math.round(herb[i]! * 12));
    mix(Math.round(shrub[i]! * 12));
  }
  return `v${VERSION}|${world}|${seed}|d${detail}|${h.toString(36)}`;
}

export async function readTerrain(key: string): Promise<ImageBitmap | null> {
  const db = await open();
  if (!db) return null;
  try {
    const blob = await new Promise<Blob | undefined>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => resolve(undefined);
    });
    return blob ? await createImageBitmap(blob) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function writeTerrain(key: string, canvas: HTMLCanvasElement): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
  if (!blob) return;
  const db = await open();
  if (!db) return;
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    store.put(blob, key);
    // 同一座岛（键的前三段一样）只留最近的几张。
    const prefix = key.split('|').slice(0, 4).join('|');
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
    const same = keys.filter((k) => typeof k === 'string' && k.startsWith(prefix) && k !== key);
    for (const k of same.slice(0, Math.max(0, same.length - (KEEP - 1)))) store.delete(k);
  } catch {
    // 存不下就算了。
  } finally {
    db.close();
  }
}
