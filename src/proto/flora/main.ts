import 'lxgw-wenkai-screen-webfont/style.css';
import { floraSpecies } from '../../data';
import { cutPlant, type FloraLook } from '../../render/flora/shapes';

/**
 * 植物图鉴页（开发和审核用）：每一种植物按真实高度画成剪纸，一格一种，写着中文名、毛利名、学名。
 * ?month=3（游戏的月份，0 = 春季第一个月）：这个月开花、结果的会画出花和果。
 */
interface Sp {
  id: string;
  name: string;
  maori: string;
  latin: string;
  look: FloraLook;
  flowerMonths: number[];
  fruitMonths: number[];
}
const species = floraSpecies as unknown as Sp[];
const q = new URLSearchParams(location.search);
const month = Number(q.get('month') ?? 3);
// ?mode=variants：每种一行，四株不同的个体（前两株不开花、后两株开花结果），看同一种植物的变化。
const variants = q.get('mode') === 'variants';
const cols = variants ? 4 : 5;
const cellW = 300;
const cellH = 330;
const dpr = 2;
const cv = document.createElement('canvas');
const items = variants ? species.flatMap((sp) => [0, 1, 2, 3].map((v) => ({ sp, v }))) : species.map((sp) => ({ sp, v: -1 }));
const rows = Math.ceil(items.length / cols);
cv.width = cols * cellW * dpr;
cv.height = rows * cellH * dpr + 60 * dpr;
cv.style.width = `${cols * cellW}px`;
document.body.append(cv);
const g = cv.getContext('2d')!;
g.scale(dpr, dpr);

/** 纸纹：一层细密的噪点，正片叠底。 */
const grain = document.createElement('canvas');
grain.width = grain.height = 128;
{
  const gg = grain.getContext('2d')!;
  const img = gg.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 225 + Math.random() * 30;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  gg.putImageData(img, 0, 0);
}
const pattern = g.createPattern(grain, 'repeat')!;

function path(p: number[], ox: number, oy: number, k: number): Path2D {
  const pa = new Path2D();
  for (let i = 0; i < p.length; i += 2) {
    const x = ox + p[i]! * k;
    const y = oy - p[i + 1]! * k;
    if (i === 0) pa.moveTo(x, y);
    else pa.lineTo(x, y);
  }
  pa.closePath();
  return pa;
}

void document.fonts.ready.then(() => {
  g.fillStyle = '#4a3527';
  g.font = '22px "LXGW WenKai Screen"';
  g.fillText(variants ? '岛上的植物 · 每种四株（后两株开花、结果）' : `岛上的植物 · 游戏的第 ${month} 个月（0 = 春季第一个月）`, 20, 38);
  items.forEach(({ sp, v }, i) => {
    const cx = (i % cols) * cellW + cellW / 2;
    const top = 60 + Math.floor(i / cols) * cellH;
    const ground = top + cellH - 70;
    const flower = v >= 0 ? (v >= 2 && sp.flowerMonths.length ? 1 : 0) : sp.flowerMonths.includes(month) ? 1 : 0;
    const fruit = v >= 0 ? (v >= 2 && sp.fruitMonths.length ? 1 : 0) : sp.fruitMonths.includes(month) ? 1 : 0;
    const cut = cutPlant(sp.look, v >= 0 ? v * 17 + 5 : i * 7 + 3, flower, fruit);
    // 按格子缩放：最高的那种也放得下；比例尺写在下面。
    const k = Math.min(210 / Math.max(0.3, cut.height), (cellW - 40) / Math.max(0.3, cut.width));
    g.fillStyle = '#e4d6b8';
    g.fillRect(cx - cellW / 2 + 14, ground, cellW - 28, 3);
    for (const sh of cut.sheets) {
      for (const p of sh.polys) {
        const pa = path(p, cx, ground, k);
        // 投影、白边、纸、纸纹。
        g.save();
        g.translate(2.5, 3.5);
        g.fillStyle = 'rgba(60,40,20,0.22)';
        g.fill(pa);
        g.restore();
        g.lineJoin = 'round';
        g.lineWidth = 3;
        g.strokeStyle = '#fbf6ea';
        g.stroke(pa);
        g.fillStyle = sh.color;
        g.fill(pa);
        g.save();
        g.globalCompositeOperation = 'multiply';
        g.globalAlpha = 0.35;
        g.fillStyle = pattern;
        g.fill(pa);
        g.restore();
      }
    }
    g.fillStyle = '#4a3527';
    g.font = '18px "LXGW WenKai Screen"';
    g.textAlign = 'center';
    g.fillText(sp.name, cx, ground + 26);
    g.font = '13px "LXGW WenKai Screen"';
    g.fillStyle = '#7a6250';
    g.fillText(`${sp.maori ? sp.maori + ' · ' : ''}${sp.latin}`, cx, ground + 44);
    g.fillText(`约 ${sp.look.height} 米${flower ? ' · 开花' : ''}${fruit ? ' · 结果' : ''}`, cx, ground + 60);
    g.textAlign = 'left';
  });
});
