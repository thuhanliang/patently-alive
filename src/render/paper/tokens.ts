import { Container, Graphics } from 'pixi.js';

/**
 * 代表单位：每个物种在地图上只放几只剪纸，每只旁边的数量签是它"代表"的那些格子的数量之和。
 * 所有代表的数量加起来正好等于这个物种的总数（每格只归给最近的一个代表）。
 */

export interface Token {
  /** 格坐标（格中心为整数）。 */
  x: number;
  y: number;
  count: number;
}

/** 按格子数量把一个物种聚成 k 个代表（确定性：初值按数量和距离贪心挑，之后几轮 Lloyd）。 */
export function clusterTokens(counts: ArrayLike<number>, w: number, h: number, isLand: (i: number) => boolean): Token[] {
  let total = 0;
  for (let i = 0; i < counts.length; i++) total += counts[i]!;
  if (total === 0) return [];
  const k = total < 10 ? 1 : Math.min(5, Math.max(2, Math.round(Math.sqrt(total) / 6)));
  // 先按 12×12 的块汇总，挑数量多、彼此又离得远的块当初值。
  const B = 12;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const blocks: { x: number; y: number; n: number }[] = [];
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y++)
        for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
          const c = counts[y * w + x]!;
          n += c;
          sx += c * x;
          sy += c * y;
        }
      if (n > 0) blocks.push({ x: sx / n, y: sy / n, n });
    }
  const seeds: { x: number; y: number }[] = [];
  while (seeds.length < Math.min(k, blocks.length)) {
    let best = -1;
    let bestScore = -1;
    blocks.forEach((b, i) => {
      const d = seeds.length === 0 ? 1 : Math.min(...seeds.map((s) => Math.hypot(s.x - b.x, s.y - b.y))) / 30;
      const score = b.n * Math.min(1, d);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    seeds.push({ x: blocks[best]!.x, y: blocks[best]!.y });
  }
  const assign = new Int32Array(counts.length).fill(-1);
  for (let iter = 0; iter < 6; iter++) {
    const acc = seeds.map(() => ({ n: 0, sx: 0, sy: 0 }));
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i]!;
      if (c === 0) continue;
      const x = i % w;
      const y = (i - x) / w;
      let best = 0;
      let bd = Infinity;
      seeds.forEach((s, j) => {
        const d = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      assign[i] = best;
      acc[best]!.n += c;
      acc[best]!.sx += c * x;
      acc[best]!.sy += c * y;
    }
    acc.forEach((a, j) => {
      if (a.n > 0) seeds[j] = { x: a.sx / a.n, y: a.sy / a.n };
    });
  }
  // 重心可能落在水里（两座岛之间）：挪到这个代表名下离重心最近、且有动物的陆地格上。
  return seeds
    .map((s, j) => {
      let n = 0;
      let bx = s.x;
      let by = s.y;
      let bd = Infinity;
      for (let i = 0; i < counts.length; i++) {
        if (assign[i] !== j) continue;
        n += counts[i]!;
        if (!isLand(i)) continue;
        const x = i % w;
        const y = (i - x) / w;
        const d = (x - s.x) ** 2 + (y - s.y) ** 2;
        if (d < bd) {
          bd = d;
          bx = x;
          by = y;
        }
      }
      return { x: bx, y: by, count: n };
    })
    .filter((t) => t.count > 0);
}

/**
 * 代表单位的大小（格，身长）：随体重压缩着变。真实比例下长度 ∝ 体重^(1/3)，这里用 0.12 次方：
 * 大小顺序不变，差距压小——鸟 2.6 格、鼠 3.0、兔 3.8、猫 4.3；200 公斤的设计物种约 6.9 格。
 */
export function tokenLengthCells(bodyMassKg: number): number {
  return 2.6 * Math.pow(bodyMassKg / 0.06, 0.12);
}

export type PuppetKind = 'cat-orange' | 'cat-piebald' | 'bird' | 'rabbit' | 'rat' | 'generic';

const RIM = 0xf7f2e6;
const BRAD = 0xc9a24a;

/**
 * 占位的剪纸木偶（代码画的）：躯干、头、腿、尾各一片，外面一圈白边，关节处一颗金色纸钉。
 * 朝右，原点在脚底中间，长度 = len 像素。正式的参数化部件（V3）到了以后换掉。
 */
export function drawPuppet(kind: PuppetKind, len: number): Container {
  const c = new Container();
  const body = new Graphics();
  const brads = new Graphics();
  c.addChild(body, brads);
  const L = len;
  // 每一片纸先画一圈略大的白边、再画本色：前面的纸片盖住后面的，接缝处露出白边。
  const piece = (draw: (g: Graphics, grow: number) => void, color: number): void => {
    draw(body, L * 0.035);
    body.fill(RIM);
    draw(body, 0);
    body.fill(color);
  };
  const brad = (x: number, y: number): void => {
    brads.circle(x, y, Math.max(1.2, L * 0.025)).fill(BRAD);
  };
  const leg = (x: number, top: number, wdt: number, color: number): void =>
    piece((g, e) => g.roundRect(x - wdt / 2 - e, top - e, wdt + 2 * e, -top + e, wdt / 2 + e), color);

  if (kind === 'bird') {
    // 双斑鸻一类：圆身、短直嘴、细腿、白身黑头顶、背上灰褐。
    const legC = 0x3a3a3a;
    leg(L * 0.02, -L * 0.3, L * 0.035, legC);
    leg(L * 0.14, -L * 0.3, L * 0.035, legC);
    piece((g, e) => g.ellipse(L * 0.05, -L * 0.42, L * 0.3 + e, L * 0.18 + e), 0xf4f1ea);
    piece((g, e) => g.ellipse(-L * 0.02, -L * 0.47, L * 0.24 + e, L * 0.1 + e), 0x9c8f7c);
    piece((g, e) => g.poly([-L * 0.22 - e, -L * 0.5, -L * 0.4 - e, -L * 0.56 - e, -L * 0.36 - e, -L * 0.44 + e]), 0x6f655a);
    piece((g, e) => g.circle(L * 0.3, -L * 0.62, L * 0.12 + e), 0xf4f1ea);
    piece((g, e) => g.ellipse(L * 0.3, -L * 0.69, L * 0.11 + e, L * 0.06 + e), 0x1d1d1d);
    piece((g, e) => g.poly([L * 0.4, -L * 0.64 - e, L * 0.53 + e, -L * 0.61, L * 0.4, -L * 0.58 + e]), 0x2a2a2a);
    body.circle(L * 0.33, -L * 0.63, L * 0.018).fill(0x111111);
    brad(L * 0.22, -L * 0.55);
    brad(L * 0.06, -L * 0.33);
    return c;
  }

  const look = {
    'cat-orange': { main: 0xe08b3d, dark: 0xb05e22, light: 0xf3d2a4, head: 0.17, earH: 0.12, tail: 'long', legH: 0.3, bodyH: 0.17, snout: 0.05 },
    'cat-piebald': { main: 0xf2eee6, dark: 0x1f1f22, light: 0xf2eee6, head: 0.17, earH: 0.12, tail: 'long', legH: 0.3, bodyH: 0.17, snout: 0.05 },
    rabbit: { main: 0xcfae7f, dark: 0xa98458, light: 0xefe3cc, head: 0.16, earH: 0.3, tail: 'puff', legH: 0.14, bodyH: 0.24, snout: 0.05 },
    rat: { main: 0x7f8b9a, dark: 0x5b6573, light: 0xb9c0c8, head: 0.12, earH: 0.06, tail: 'thin', legH: 0.1, bodyH: 0.13, snout: 0.12 },
    generic: { main: 0x8fa37a, dark: 0x5d6e4d, light: 0xd8e0c8, head: 0.15, earH: 0.08, tail: 'long', legH: 0.25, bodyH: 0.17, snout: 0.06 },
  }[kind];
  const legTop = -L * look.legH;
  const bodyY = legTop - L * look.bodyH * 0.6;
  // 后面两条腿颜色深一点，像在另一层。
  leg(-L * 0.24, legTop, L * 0.07, look.dark);
  leg(L * 0.2, legTop, L * 0.07, look.dark);
  // 尾巴
  if (look.tail === 'long')
    piece((g, e) => g.poly([-L * 0.36, bodyY - e, -L * 0.6 - e, bodyY - L * 0.28 - e, -L * 0.54 + e, bodyY - L * 0.3 - e, -L * 0.32 + e, bodyY + L * 0.06 + e]), kind === 'cat-piebald' ? look.dark : look.main);
  else if (look.tail === 'thin')
    piece((g, e) => g.poly([-L * 0.32, bodyY + L * 0.02 - e, -L * 0.75 - e, bodyY + L * 0.12, -L * 0.32, bodyY + L * 0.07 + e]), 0xb7a3a8);
  else piece((g, e) => g.circle(-L * 0.36, bodyY - L * 0.04, L * 0.07 + e), 0xf6f2ea);
  // 躯干
  piece((g, e) => g.ellipse(-L * 0.02, bodyY, L * 0.36 + e, L * look.bodyH + e), look.main);
  if (kind === 'cat-orange')
    for (const sx of [-0.2, -0.08, 0.04, 0.16]) body.poly([L * sx, bodyY - L * look.bodyH * 0.95, L * (sx + 0.04), bodyY - L * look.bodyH * 0.95, L * (sx + 0.015), bodyY + L * 0.02]).fill(look.dark);
  if (kind === 'cat-piebald') body.ellipse(-L * 0.08, bodyY - L * 0.05, L * 0.22, L * 0.12).fill(look.dark);
  // 前面两条腿
  leg(-L * 0.17, legTop, L * 0.075, kind === 'cat-piebald' ? look.light : look.main);
  leg(L * 0.26, legTop, L * 0.075, kind === 'cat-piebald' ? look.light : look.main);
  // 头、耳、吻
  const hx = L * 0.36;
  const hy = bodyY - L * look.bodyH * 0.9;
  const hr = L * look.head;
  if (kind === 'rabbit') {
    piece((g, e) => g.ellipse(hx - hr * 0.5, hy - hr - L * look.earH * 0.5, L * 0.05 + e, L * look.earH * 0.55 + e), look.main);
    piece((g, e) => g.ellipse(hx - hr * 0.1, hy - hr - L * look.earH * 0.45, L * 0.05 + e, L * look.earH * 0.5 + e), look.dark);
  } else {
    piece((g, e) => g.poly([hx - hr * 0.8 - e, hy - hr * 0.4, hx - hr * 0.55, hy - hr - L * look.earH - e, hx - hr * 0.05 + e, hy - hr * 0.6]), kind === 'cat-piebald' ? look.dark : look.main);
    piece((g, e) => g.poly([hx - hr * 0.1 - e, hy - hr * 0.6, hx + hr * 0.3, hy - hr - L * look.earH - e, hx + hr * 0.7 + e, hy - hr * 0.3]), kind === 'cat-piebald' ? look.dark : look.main);
  }
  piece((g, e) => g.circle(hx, hy, hr + e), kind === 'cat-piebald' ? look.dark : look.main);
  piece((g, e) => g.ellipse(hx + hr * 0.75, hy + hr * 0.25, hr * 0.45 + L * look.snout + e, hr * 0.42 + e), look.light);
  body.circle(hx + hr * 0.3, hy - hr * 0.15, Math.max(1, L * 0.022)).fill(0x141414);
  body.circle(hx + hr * 0.75 + L * look.snout + hr * 0.3, hy + hr * 0.12, Math.max(0.8, L * 0.016)).fill(0x3a2a2a);
  brad(hx - hr * 0.55, hy + hr * 0.4);
  brad(-L * 0.17, legTop + L * 0.02);
  brad(L * 0.26, legTop + L * 0.02);
  return c;
}
