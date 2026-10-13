/**
 * 浏览器里的快速存档位（IndexedDB，一个情景一个位）。存档有好几 MB，localStorage 放不下。
 * 只在本机、本浏览器里；清掉网站数据、隐私窗口里会丢，要长期保存请"导出存档"。
 */
const DB = 'patently-alive';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打不开浏览器存储'));
  });
}

async function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = body(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('浏览器存储出错'));
      tx.onabort = () => reject(tx.error ?? new Error('浏览器存储被中止（可能是空间不够）'));
    });
  } finally {
    db.close();
  }
}

export async function writeSlot(key: string, text: string): Promise<void> {
  await run('readwrite', (s) => s.put({ text, savedAt: new Date().toISOString() }, key));
}

export async function readSlot(key: string): Promise<{ text: string; savedAt: string } | null> {
  const v = await run('readonly', (s) => s.get(key) as IDBRequest<{ text: string; savedAt: string } | undefined>);
  return v ?? null;
}
