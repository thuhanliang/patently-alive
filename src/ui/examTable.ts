import type { Capture, DerivedSpecies } from '../sim';
import { THIN_BCS } from '../sim';
import { ageText, bcsText, massText, stomachText } from './examText';
import { fecalText } from './fieldLog';

/**
 * 诊台（2026-11-28，整体回顾 B 段）：抓回来的一只躺在诊台的垫子上，一样一样地查——
 * 摸脊背（体况）、翻眼睑（黏膜颜色，贫血）、称重、看牙（年龄）、看胃里有什么、做粪检（McMaster 玻片上数虫卵）。
 * 每一样的结果都是引擎按这只动物的真实状态算出来的（exam.ts），这里只负责"查了才看得到"和怎么说。
 * 查到的东西记在右边的病历上；查够了，下面的"鉴别"会把证据摆在一起：瘦，是吃不饱还是有虫？
 * 先体验后命名：McMaster 的算法（数到的 × 50）写在玻片的背面，点玻片翻过来。
 */

type CheckId = 'bcs' | 'mucosa' | 'mass' | 'age' | 'stomach' | 'fecal';

const CHECKS: Array<{ id: CheckId; label: string; hint: string; at: [number, number] }> = [
  { id: 'bcs', label: '摸脊背', hint: '体况：脊突、肋骨摸不摸得到', at: [0.42, 0.32] },
  { id: 'mucosa', label: '翻眼睑', hint: '眼睑黏膜的颜色：越白越贫血', at: [0.8, 0.3] },
  { id: 'age', label: '看牙', hint: '牙的磨损估年龄', at: [0.9, 0.48] },
  { id: 'mass', label: '称重', hint: '放到秤上', at: [0.5, 0.78] },
  { id: 'stomach', label: '看胃内容', hint: '催吐或看粪便里的残渣', at: [0.6, 0.55] },
  { id: 'fecal', label: '粪检', hint: '取一点粪便做 McMaster 虫卵计数', at: [0.2, 0.62] },
];

/** FAMACHA 卡的五档颜色（1 鲜红 → 5 几乎白）。 */
const FAMACHA = ['#c0392b', '#d9655a', '#e79a8e', '#f1c8bf', '#f7ebe6'];

export class ExamTable {
  private cap: Capture | null = null;
  private done = new Set<CheckId>();

  constructor(
    private readonly el: HTMLElement,
    private species: readonly DerivedSpecies[],
    /** 这种动物的样子（图片地址）；没有就画一个剪影。 */
    private readonly imageOf: (speciesId: string) => string | null,
  ) {}

  setSpecies(species: readonly DerivedSpecies[]): void {
    this.species = species;
  }

  get isOpen(): boolean {
    return this.cap !== null;
  }

  close(): void {
    this.cap = null;
    this.el.style.display = 'none';
    this.el.classList.remove('exam-table');
  }

  show(cap: Capture): void {
    this.cap = cap;
    this.done = new Set();
    this.el.classList.add('exam-table');
    this.el.style.display = '';
    this.render();
  }

  private render(): void {
    const c = this.cap;
    if (!c) return;
    const sp = this.species[c.species]!;
    const el = this.el;
    el.replaceChildren();
    const head = document.createElement('div');
    head.className = 'et-head';
    head.innerHTML = `<b></b><span></span>`;
    head.querySelector('b')!.textContent = `诊台 · ${sp.params.name}（${c.female ? '雌' : '雄'}）`;
    head.querySelector('span')!.textContent = `第 ${Math.floor(c.day / 360) + 1} 年第 ${(c.day % 360) + 1} 天 · (${c.x}, ${c.y})`;
    const x = document.createElement('button');
    x.className = 'et-close';
    x.textContent = '放生，关上';
    x.addEventListener('click', () => this.close());
    head.append(x);

    // 垫子：动物躺在上面，身上是能点的地方。
    const mat = document.createElement('div');
    mat.className = 'et-mat';
    const img = this.imageOf(sp.params.id);
    const fig = document.createElement('div');
    fig.className = 'et-animal';
    if (img) fig.style.backgroundImage = `url("${img}")`;
    else fig.classList.add('et-silhouette');
    mat.append(fig);
    for (const ch of CHECKS) {
      if (ch.id === 'fecal' && !c.fecal) continue;
      if (ch.id === 'mucosa' && !c.fecal) continue;
      const b = document.createElement('button');
      b.className = 'et-spot';
      b.classList.toggle('done', this.done.has(ch.id));
      b.style.left = `${ch.at[0] * 100}%`;
      b.style.top = `${ch.at[1] * 100}%`;
      b.textContent = ch.label;
      b.title = ch.hint;
      b.addEventListener('click', () => {
        this.done.add(ch.id);
        this.render();
      });
      mat.append(b);
    }

    // 病历：查过的才写上。
    const chart = document.createElement('dl');
    chart.className = 'et-chart';
    const row = (k: string, v: string | Node): void => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.append(v);
      chart.append(dt, dd);
    };
    if (this.done.has('bcs')) row('体况', `${bcsText(c.bcs)}${c.bcs <= THIN_BCS ? '：脊突、肋骨一根根摸得出来' : ''}`);
    if (this.done.has('mucosa') && c.fecal) {
      const sw = document.createElement('span');
      sw.className = 'et-famacha';
      FAMACHA.forEach((col, i) => {
        const cell = document.createElement('i');
        cell.style.background = col;
        cell.classList.toggle('on', i + 1 === c.fecal!.famacha);
        sw.append(cell);
      });
      const t = document.createElement('span');
      t.textContent = ` 第 ${c.fecal.famacha} 档${c.fecal.famacha >= 4 ? '：苍白，贫血' : c.fecal.famacha === 3 ? '：偏淡' : '：粉红，正常'}`;
      const wrap = document.createElement('span');
      wrap.append(sw, t);
      row('眼睑黏膜', wrap);
    }
    if (this.done.has('age')) row('年龄', ageText(sp, c));
    if (this.done.has('mass')) row('体重', `${massText(c.massKg)}（同种成体典型 ${massText(sp.params.bodyMassKg)}）`);
    if (this.done.has('stomach')) row('胃内容', stomachText(c, this.species));
    if (this.done.has('fecal') && c.fecal) row('粪检', fecalText(c.fecal.epg));
    if (chart.children.length === 0) {
      const p = document.createElement('p');
      p.className = 'et-empty';
      p.textContent = '点垫子上的动物身上的标签，一样一样地查。';
      chart.append(p);
    }

    const body = document.createElement('div');
    body.className = 'et-body';
    body.append(mat, chart);
    el.append(head, body);

    if (this.done.has('fecal') && c.fecal) el.append(slide(c));
    const dx = differential(c, this.done);
    if (dx) el.append(dx);
  }
}

/** McMaster 玻片：两个计数室，每个 6 道格，数到的虫卵画在格子里；点一下翻到背面看算法。 */
function slide(c: Capture): HTMLElement {
  const box = document.createElement('div');
  box.className = 'et-slide';
  const cv = document.createElement('canvas');
  const W = 360;
  const H = 120;
  cv.width = W * 2;
  cv.height = H * 2;
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  const g = cv.getContext('2d')!;
  g.scale(2, 2);
  const n = Math.round(c.fecal!.epg / 50);
  let s = (c.day * 7919 + c.x * 31 + c.y * 17 + 1) >>> 0;
  const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
  const drawFront = (): void => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#e9eef0';
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 2; k++) {
      const x0 = 12 + k * 176;
      g.fillStyle = '#f7fafb';
      g.fillRect(x0, 14, 160, 92);
      g.strokeStyle = '#7f98a6';
      g.lineWidth = 1;
      g.strokeRect(x0, 14, 160, 92);
      for (let i = 1; i < 6; i++) {
        g.beginPath();
        g.moveTo(x0 + (160 * i) / 6, 14);
        g.lineTo(x0 + (160 * i) / 6, 106);
        g.stroke();
      }
    }
    // 虫卵：椭圆，壳薄，里面是一团分裂的胚（桑椹胚）。
    for (let i = 0; i < Math.min(n, 400); i++) {
      const k = rnd() < 0.5 ? 0 : 1;
      const x = 12 + k * 176 + 6 + rnd() * 148;
      const y = 20 + rnd() * 80;
      const a = rnd() * Math.PI;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.strokeStyle = '#6d5a3e';
      g.fillStyle = '#efe4cc';
      g.beginPath();
      g.ellipse(0, 0, 4.2, 2.6, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#b99b6a';
      g.beginPath();
      g.ellipse(0, 0, 2.6, 1.6, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = '#3d4b52';
    g.font = '11px "LXGW WenKai Screen", serif';
    g.fillText('McMaster 计数室（两格共 0.3 毫升）', 12, 11);
  };
  const drawBack = (): void => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#f3ead6';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#4a3527';
    g.font = '13px "LXGW WenKai Screen", serif';
    const lines = [
      '粪便 2 克，加漂浮液到 30 毫升（稀释 15 倍）。',
      '两个计数室一共装 0.3 毫升，相当于 0.02 克粪便。',
      `所以：每克粪便的虫卵数 = 数到的个数 × 50`,
      `这一片数到 ${n} 个 → ${c.fecal!.epg.toLocaleString('zh-CN')} 个/克（EPG）`,
      '数到 0 个不等于没虫：低于 50 个/克时数不出来。',
    ];
    lines.forEach((t, i) => g.fillText(t, 12, 22 + i * 20));
  };
  let back = false;
  drawFront();
  cv.addEventListener('click', () => {
    back = !back;
    if (back) drawBack();
    else drawFront();
  });
  const cap = document.createElement('p');
  cap.textContent = `数到 ${n} 个虫卵。（点玻片翻到背面）`;
  box.append(cv, cap);
  return box;
}

/** 鉴别：查够了（体况 + 胃 或 粪检），把证据摆在一起——瘦，是吃不饱还是有虫？只摆证据，不出题、不打分。 */
function differential(c: Capture, done: ReadonlySet<CheckId>): HTMLElement | null {
  if (!done.has('bcs') || c.bcs > THIN_BCS) return null;
  const lines: string[] = [];
  if (done.has('stomach')) lines.push(c.stomach.fullness < 0.3 ? '胃里几乎是空的：最近吃不饱。' : '胃里是满的：不缺吃的。');
  if (done.has('fecal') && c.fecal) lines.push(c.fecal.epg >= 500 ? `粪便里虫卵很多（${c.fecal.epg} 个/克）：肠里有大量线虫。` : c.fecal.epg > 0 ? `粪便里有一些虫卵（${c.fecal.epg} 个/克）。` : '粪检没数到虫卵。');
  if (done.has('mucosa') && c.fecal) lines.push(c.fecal.famacha >= 4 ? '眼睑苍白：贫血（吸血的线虫）。' : '眼睑颜色正常。');
  if (lines.length === 0) return null;
  const box = document.createElement('div');
  box.className = 'et-dx';
  const h = document.createElement('b');
  h.textContent = '它很瘦。证据：';
  box.append(h);
  for (const t of lines) {
    const p = document.createElement('p');
    p.textContent = t;
    box.append(p);
  }
  return box;
}
