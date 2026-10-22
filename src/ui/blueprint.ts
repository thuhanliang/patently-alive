import type { Design } from '../data';
import { BLUEPRINT, PAPER, css, cssAlpha } from '../render/palette';

/**
 * 设计台的蓝图线稿（代码画，田野笔记的"玩家批注"画法：蓝图蓝墨线、纸色底）。
 * 只是画法：读设计里选了哪些部件，画出大致的样子；不读推导结果，不影响推演。
 * 申请书的说明书附图（第 5 步）也用它。
 */
export function drawBlueprint(canvas: HTMLCanvasElement, design: Design, bird: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  // 还没进文档或被藏起来：没有尺寸，不画（canvas.width 是设备像素，不能拿来当 CSS 尺寸）。
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css(PAPER);
  ctx.fillRect(0, 0, w, h);
  // 方格底纹。
  ctx.strokeStyle = cssAlpha(BLUEPRINT, 0.08);
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 16) line(ctx, x + 0.5, 0, x + 0.5, h);
  for (let y = 0; y <= h; y += 16) line(ctx, 0, y + 0.5, w, y + 0.5);

  const ink = css(BLUEPRINT);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 体型：按体重的对数在 5 克 – 100 吨之间缩放。
  const t = Math.min(1, Math.max(0, (Math.log10(design.bodyMassKg) + 2.3) / 7.3));
  const aspect = bird ? 0.72 : 0.5;
  // 身体上方要留出头和翅膀，下方留出腿和尺寸标注；放不下就整体缩小。
  const above = design.parts.limbs === 'wings' ? 1.9 : 1.25;
  // 形状（腿长、尾长"比一般长多少"）：线稿跟着拉长、缩短。
  const legK = 10 ** (design.shape?.leg ?? 0);
  const tailK = 10 ** (design.shape?.tail ?? 0);
  const below = 0.8 + legLength(design.parts.limbs) * legK;
  let rx = (40 + 55 * t) * (Math.min(w, h * 1.6) / 400);
  const fit = (h - 24 - 34) / (rx * aspect * (above + below));
  if (fit < 1) rx *= fit;
  const ry = rx * aspect;
  const legLen = legLength(design.parts.limbs) * legK * ry;
  const cx = w * 0.47;
  const cy = 24 + ry * above;
  const ground = cy + ry * 0.8 + legLen;

  // 地面线。
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  line(ctx, 12, ground, w - 12, ground);
  ctx.setLineDash([]);

  ctx.lineWidth = 2;
  drawLimbs(ctx, design.parts.limbs, cx, cy, rx, ry, ground, bird);
  ctx.save();
  ctx.translate(cx - rx, cy);
  ctx.scale(tailK, 1);
  ctx.translate(-(cx - rx), -cy);
  drawTail(ctx, design.parts.tail, cx - rx, cy, ry);
  ctx.restore();
  // 身体。
  ctx.fillStyle = css(PAPER);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawCoat(ctx, design.parts.coat, cx, cy, rx, ry);
  if (design.parts.limbs === 'wings') drawWing(ctx, cx, cy, rx, ry);
  // 头。
  const hr = ry * (bird ? 0.62 : 0.68);
  const hx = cx + rx * 0.92;
  const hy = cy - ry * 0.55;
  ctx.fillStyle = css(PAPER);
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawMouth(ctx, design.parts.mouth, hx + hr * 0.85, hy + hr * 0.1, hr);
  // 眼：夜行的眼大。
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(hx + hr * 0.3, hy - hr * 0.25, Math.max(2, hr * (design.activity === 'nocturnal' ? 0.2 : 0.12)), 0, Math.PI * 2);
  ctx.fill();

  // 尺寸标注：体长和体重。
  ctx.lineWidth = 1;
  const dimY = ground + 16;
  line(ctx, cx - rx, dimY, cx + rx, dimY);
  line(ctx, cx - rx, dimY - 4, cx - rx, dimY + 4);
  line(ctx, cx + rx, dimY - 4, cx + rx, dimY + 4);
  ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(massText(design.bodyMassKg), cx, dimY + 14);
  ctx.textAlign = 'left';
  ctx.fillText(`图 1　${design.name}`, 12, 18);
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** 腿长（相对身体半高）。 */
function legLength(limbs: string): number {
  switch (limbs) {
    case 'running_legs':
      return 1.6;
    case 'short_legs':
      return 0.35;
    case 'digging_claws':
      return 0.6;
    default:
      return 0.9;
  }
}

function drawLimbs(ctx: CanvasRenderingContext2D, limbs: string, cx: number, cy: number, rx: number, ry: number, ground: number, bird: boolean): void {
  const xs = bird ? [cx + rx * 0.05, cx + rx * 0.25] : [cx - rx * 0.6, cx - rx * 0.4, cx + rx * 0.4, cx + rx * 0.6];
  const top = cy + ry * 0.6;
  const thick = limbs === 'digging_claws';
  ctx.lineWidth = thick ? 4 : 2;
  for (const x of xs) {
    if (bird) {
      // 鸟腿：一个反关节。
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - 6, (top + ground) / 2);
      ctx.lineTo(x, ground);
      ctx.stroke();
    } else {
      line(ctx, x, top, x, ground);
    }
    // 脚：钩爪、掘土爪、普通的脚。
    ctx.lineWidth = 2;
    if (limbs === 'climbing_claws') {
      ctx.beginPath();
      ctx.arc(x + 5, ground - 4, 5, Math.PI * 0.5, Math.PI * 1.5, true);
      ctx.stroke();
    } else if (limbs === 'digging_claws') {
      for (let k = 0; k < 3; k++) line(ctx, x + k * 3, ground, x + 6 + k * 3, ground - 3);
    } else {
      line(ctx, x, ground, x + 7, ground);
    }
    ctx.lineWidth = thick ? 4 : 2;
  }
  ctx.lineWidth = 2;
}

function drawWing(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.moveTo(cx + rx * 0.35, cy - ry * 0.3);
  ctx.quadraticCurveTo(cx - rx * 0.3, cy - ry * 1.9, cx - rx * 1.05, cy - ry * 0.9);
  ctx.quadraticCurveTo(cx - rx * 0.4, cy - ry * 0.55, cx + rx * 0.35, cy - ry * 0.3);
  ctx.stroke();
  // 几根飞羽。
  for (let k = 1; k <= 3; k++) {
    const f = k / 4;
    line(ctx, cx + rx * (0.35 - 1.4 * f), cy - ry * (0.3 + 0.6 * f), cx + rx * (0.2 - 1.4 * f), cy - ry * (0.9 + 0.5 * f));
  }
}

function drawTail(ctx: CanvasRenderingContext2D, tail: string, x: number, y: number, ry: number): void {
  ctx.beginPath();
  switch (tail) {
    case 'balance_tail':
      ctx.moveTo(x + 4, y);
      ctx.bezierCurveTo(x - ry * 1.2, y - ry * 0.2, x - ry * 1.6, y + ry * 0.9, x - ry * 2.4, y + ry * 0.4);
      break;
    case 'fat_tail':
      ctx.moveTo(x + 4, y - ry * 0.35);
      ctx.quadraticCurveTo(x - ry * 1.1, y - ry * 0.3, x - ry * 1.3, y + ry * 0.3);
      ctx.quadraticCurveTo(x - ry * 0.8, y + ry * 0.45, x + 4, y + ry * 0.3);
      break;
    case 'bushy_tail':
      ctx.moveTo(x + 4, y - ry * 0.2);
      for (let k = 0; k < 6; k++) {
        const a = Math.PI * (0.9 + k * 0.22);
        ctx.quadraticCurveTo(x - ry * 0.9 + Math.cos(a) * ry * 1.1, y + Math.sin(a) * ry * 0.9, x - ry * 0.9 + Math.cos(a + 0.2) * ry * 0.8, y + Math.sin(a + 0.2) * ry * 0.7);
      }
      ctx.lineTo(x + 4, y + ry * 0.3);
      break;
    default:
      ctx.moveTo(x + 4, y - ry * 0.1);
      ctx.lineTo(x - ry * 0.4, y - ry * 0.25);
  }
  ctx.stroke();
}

function drawCoat(ctx: CanvasRenderingContext2D, coat: string, cx: number, cy: number, rx: number, ry: number): void {
  ctx.save();
  ctx.lineWidth = 1;
  if (coat === 'feathers') {
    // 鳞片状的羽毛轮廓。
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 5; k++) {
        const x = cx - rx * 0.55 + k * rx * 0.24 + (row % 2) * rx * 0.12;
        const y = cy - ry * 0.25 + row * ry * 0.28;
        ctx.beginPath();
        ctx.arc(x, y, ry * 0.12, 0, Math.PI);
        ctx.stroke();
      }
    }
  } else {
    // 毛：沿背部的短线，厚绒毛画两层。
    const layers = coat === 'dense_fur' ? 2 : 1;
    for (let l = 0; l < layers; l++) {
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (1.15 + k * 0.08);
        const x = cx + Math.cos(a) * rx * (0.92 - l * 0.12);
        const y = cy + Math.sin(a) * ry * (0.92 - l * 0.12);
        line(ctx, x, y, x - 4, y - 5);
      }
    }
  }
  ctx.restore();
}

function drawMouth(ctx: CanvasRenderingContext2D, mouth: string, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (mouth) {
    case 'seed_beak':
      ctx.moveTo(x, y - r * 0.3);
      ctx.lineTo(x + r * 0.6, y);
      ctx.lineTo(x, y + r * 0.3);
      ctx.closePath();
      break;
    case 'probe_bill':
      ctx.moveTo(x, y - r * 0.12);
      ctx.lineTo(x + r * 1.8, y + r * 0.2);
      ctx.lineTo(x, y + r * 0.12);
      break;
    case 'hooked_beak':
      ctx.moveTo(x, y - r * 0.3);
      ctx.quadraticCurveTo(x + r * 0.8, y - r * 0.3, x + r * 0.6, y + r * 0.3);
      ctx.lineTo(x, y + r * 0.2);
      break;
    case 'stout_bill':
      ctx.moveTo(x, y - r * 0.3);
      ctx.lineTo(x + r * 0.9, y);
      ctx.lineTo(x, y + r * 0.25);
      break;
    case 'pointed_snout':
      ctx.moveTo(x - r * 0.1, y - r * 0.3);
      ctx.lineTo(x + r * 1.1, y + r * 0.05);
      ctx.lineTo(x - r * 0.1, y + r * 0.3);
      break;
    case 'gnawing_incisors':
      ctx.moveTo(x, y - r * 0.25);
      ctx.lineTo(x + r * 0.4, y);
      ctx.lineTo(x, y + r * 0.25);
      ctx.rect(x + r * 0.2, y + r * 0.05, r * 0.12, r * 0.3);
      break;
    case 'carnassials':
      ctx.moveTo(x, y - r * 0.25);
      ctx.lineTo(x + r * 0.5, y);
      ctx.lineTo(x, y + r * 0.25);
      // 锯齿状的牙。
      for (let k = 0; k < 3; k++) {
        ctx.moveTo(x + k * r * 0.14, y);
        ctx.lineTo(x + k * r * 0.14 + r * 0.07, y + r * 0.12);
        ctx.lineTo(x + (k + 1) * r * 0.14, y);
      }
      break;
    case 'grinding_molars':
      ctx.rect(x - r * 0.05, y - r * 0.25, r * 0.4, r * 0.5);
      break;
    default:
      ctx.moveTo(x, y - r * 0.25);
      ctx.lineTo(x + r * 0.45, y);
      ctx.lineTo(x, y + r * 0.25);
  }
  ctx.stroke();
}

/** 体重的写法（设计台的滑杆标签也用它）。 */
export function massText(kg: number): string {
  if (kg < 1) return `${Math.round(kg * 1000)} 克`;
  if (kg >= 1000) return `${Number((kg / 1000).toPrecision(3))} 吨`;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} 千克`;
}
