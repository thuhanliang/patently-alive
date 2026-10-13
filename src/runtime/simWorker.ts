import { SimHost, type FromHost, type ToHost } from './host';

/**
 * Web Worker 入口：推演在这里跑，主线程只渲染。
 * 循环：按真实时间推进（每轮最多算 RUN_BUDGET_MS 就停下收消息），主线程要画下一帧时（'frame'）发一份视图。
 * 视图里推演状态的类型化数组是新拷贝的，直接转移（transfer）给主线程，不再拷一遍。
 */
const RUN_BUDGET_MS = 12;
const LOOP_MS = 4;

// 这个文件跑在 Worker 里；工程的 DOM 类型下 self 是 Window，借 Worker 的 postMessage 签名。
const port = self as unknown as Worker;
let host: SimHost | null = null;
let wantFrame = true;
let last = performance.now();

function post(msg: FromHost): void {
  const transfer: Transferable[] = [];
  if (msg.t === 'view' && msg.view.state) collectBuffers(msg.view.state, transfer);
  port.postMessage(msg, transfer);
}

function collectBuffers(value: unknown, out: Transferable[]): void {
  if (value === null || typeof value !== 'object') return;
  if (ArrayBuffer.isView(value)) {
    if (!out.includes(value.buffer)) out.push(value.buffer as ArrayBuffer);
    return;
  }
  for (const v of Object.values(value)) collectBuffers(v, out);
}

port.onmessage = (e: MessageEvent<ToHost>) => {
  const msg = e.data;
  try {
    if (msg.t === 'init') {
      host = new SimHost(msg.config, msg.rules, { speed: msg.speed, held: msg.held });
      wantFrame = true;
      return;
    }
    if (msg.t === 'frame') {
      wantFrame = true;
      return;
    }
    const reply = host?.handle(msg);
    if (reply) post(reply);
  } catch (err) {
    const message = (err as Error).message;
    // 带编号的请求要有回音，不然主线程那边一直等着。
    if ('id' in msg) post({ t: 'failed', id: msg.id, message });
    else post({ t: 'error', message });
  }
};

function loop(): void {
  const now = performance.now();
  try {
    if (host) {
      host.run(now - last, () => performance.now(), now + RUN_BUDGET_MS);
      if (wantFrame) {
        wantFrame = false;
        post({ t: 'view', view: host.view() });
      }
    }
  } catch (err) {
    post({ t: 'error', message: (err as Error).message });
  }
  last = now;
  setTimeout(loop, LOOP_MS);
}
loop();
