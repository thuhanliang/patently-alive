import 'lxgw-wenkai-screen-webfont/style.css';
import type { Shape } from '../../render/puppet/fit';
import { HEAD_PRESETS, SEGMENT_PRESETS, headShape, jawAngle, segmentShape, type HeadForm } from '../../render/puppet/topo';

/**
 * 零件拓扑试验页（docs/research/part-topology.md）：每类零件一行，按典型形态（预设）排开；
 * 右上角的滑块调"自由"那一格的头（看几个控制量能调出多少种头）。转轴画蓝圈。
 */
const dpr = 2;
const W = 1500;
const H = 1250;
const cv = document.createElement('canvas');
cv.width = W * dpr;
cv.height = H * dpr;
cv.style.width = `${W}px`;
document.body.append(cv);
const g = cv.getContext('2d')!;
g.scale(dpr, dpr);
const DYE = { main: '#d98b3f', stripe: '#a85e26', pale: '#f3e2c4', ink: '#2b1d14' };

function poly(p: number[], ox: number, oy: number, rot = 0): Path2D {
  const pa = new Path2D();
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < p.length; i += 2) {
    const x = ox + p[i]! * c - p[i + 1]! * s;
    const y = oy + p[i]! * s + p[i + 1]! * c;
    if (i === 0) pa.moveTo(x, y);
    else pa.lineTo(x, y);
  }
  pa.closePath();
  return pa;
}
function drawShape(sh: Shape, ox: number, oy: number, rot = 0, ink: number[][] = []): void {
  const out = poly(sh.outline, ox, oy, rot);
  g.save();
  g.translate(2, 3);
  g.fillStyle = 'rgba(60,40,20,0.25)';
  g.fill(out);
  g.restore();
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#fbf6ea';
  g.stroke(out);
  g.fillStyle = DYE.main;
  g.fill(out);
  g.save();
  g.clip(out);
  for (const s of sh.stripe) {
    g.fillStyle = DYE.stripe;
    g.fill(poly(s, ox, oy, rot));
  }
  for (const s of sh.pale) {
    g.fillStyle = DYE.pale;
    g.fill(poly(s, ox, oy, rot));
  }
  g.restore();
  for (const s of ink) {
    g.fillStyle = DYE.ink;
    g.fill(poly(s, ox, oy, rot));
  }
}
function pivot(x: number, y: number): void {
  g.strokeStyle = '#2f5d8a';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, 4, 0, Math.PI * 2);
  g.stroke();
}
function label(t: string, x: number, y: number, size = 15): void {
  g.fillStyle = '#4a3527';
  g.font = `${size}px "LXGW WenKai Screen"`;
  g.textAlign = 'center';
  g.fillText(t, x, y);
}

const free: Omit<HeadForm, 'R'> = { ...HEAD_PRESETS['猫']! };
function drawHead(f: Omit<HeadForm, 'R'>, x: number, y: number, R: number): void {
  const form = { ...f, R };
  const cut = headShape(form);
  // 下颌在头下面（先画），沿关节 → 吻端下沿的方向。
  drawShape(cut.jaw, x + cut.jawPivot[0], y + cut.jawPivot[1], jawAngle(form, cut));
  drawShape(cut.head, x, y, 0, cut.ink);
  pivot(x, y);
  pivot(x + cut.jawPivot[0], y + cut.jawPivot[1]);
}

function render(): void {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#efe5cf';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#4a3527';
  g.font = '24px "LXGW WenKai Screen"';
  g.textAlign = 'left';
  g.fillText('零件拓扑：几个控制量 → 典型形态', 20, 36);
  // 第一行：头的预设 + 自由的那一格。
  const heads = Object.entries(HEAD_PRESETS);
  heads.forEach(([name, f], i) => {
    const x = 40 + i * 170;
    drawHead(f, x, 170, 34);
    label(name, x + 60, 230);
  });
  drawHead(free, 40, 380, 60);
  label('自由（右上角的滑块）', 140, 470, 17);
  // 骨段的预设：每种零件一行。
  let row = 0;
  for (const [part, presets] of Object.entries(SEGMENT_PRESETS)) {
    const y = 560 + row * 135;
    label(part, 40, y + 5, 18);
    Object.entries(presets).forEach(([name, st], i) => {
      const L = part === '胸片' ? 180 : part === '尾节' ? 70 : 150;
      const x = 100 + i * 330;
      const sh = segmentShape(L, st.map(([t, up, down]) => ({ t, up: up * L, down: down * L })), { pale: part === '胸片' ? 0.35 : 0.25, stripes: part === '小腿' ? 0 : L * 0.3 });
      drawShape(sh, x + 30, y);
      pivot(x + 30, y);
      pivot(x + 30 + L, y);
      label(name, x + 30 + L / 2, y + 60);
    });
    row++;
  }
}

const ui = document.getElementById('ui')!;
const ctl: Array<[keyof typeof free, string, number, number]> = [
  ['snout', '吻长', 0, 4],
  ['rootH', '吻根高', 0.3, 1],
  ['tipH', '吻端高', 0.2, 1.1],
  ['tip', '吻端尖', 0, 1],
  ['bridge', '鼻梁弯', -1, 1],
  ['jaw', '下颌厚', 0.05, 0.7],
];
for (const [k, name, lo, hi] of ctl) {
  const lab = document.createElement('label');
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(lo);
  inp.max = String(hi);
  inp.step = '0.01';
  inp.value = String(free[k]);
  const val = document.createElement('span');
  val.textContent = String(free[k]);
  inp.oninput = (): void => {
    free[k] = Number(inp.value);
    val.textContent = inp.value;
    render();
  };
  lab.append(name, inp, val);
  ui.append(lab);
}
void document.fonts.ready.then(render);
