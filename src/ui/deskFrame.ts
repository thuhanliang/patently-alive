import type { Design, SpeciesParams } from '../data';
import { checksum, compileDesign, type DesignKit } from '../sim';
import { DESIGN_COLORS } from '../render/palette';
import { countPicker } from './countPicker';

/** 现场画像的主色：暖的赭色，在绿的岛上看得清（以后可以让玩家自己挑）。 */
const DESIGN_COLOR = DESIGN_COLORS[3];

/** "带去岛上"要的东西；情景不允许投放设计物种时不传。 */
export interface DeskRelease {
  maxAnimals: number;
  /** 投放 count 只的花费说明，以及付不付得起。 */
  quote(species: SpeciesParams, count: number): { text: string; ok: boolean };
  /** 选好了名字和数量：设计台收起，回到地图上点投放地点。portrait 是设计台上那只纸偶的样子。 */
  start(design: Design, species: SpeciesParams, count: number, portrait: string): void;
}

/**
 * 游戏里的设计台（2026-11-10，取代旧的设计弹窗）：整屏嵌入设计台玩具（desk.html?embed=1），世界留在后面不动。
 * 设计台只管拼身体；"带去岛上"把设计交回来，这里起名字、定数量、报花费，然后回地图上选地点。
 * 开着时推演暂停（由 main 看 isOpen 决定）。
 */
export class DeskFrame {
  private open = false;
  private frame: HTMLIFrameElement | null = null;
  private readonly card = document.createElement('div');
  private name = '';
  private count = 20;

  constructor(
    private readonly el: HTMLElement,
    private readonly kit: DesignKit,
    /** 设计台上方便签上的一句话：委托人要什么、岛上有什么。 */
    private readonly brief: string,
    private readonly release?: DeskRelease,
  ) {
    this.card.className = 'desk-release';
    this.card.hidden = true;
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== this.frame?.contentWindow) return;
      const m = e.data as { type?: string; design?: Design; portrait?: string };
      if (m?.type === 'pa-desk-ready') this.frame!.contentWindow!.postMessage({ type: 'pa-desk-brief', text: this.brief }, location.origin);
      else if (m?.type === 'pa-desk-close') this.close();
      else if (m?.type === 'pa-desk-release' && m.design && m.portrait) this.offer(m.design, m.portrait);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    if (!this.frame) {
      // 第一次打开才载入；之后只是藏起来，桌上的设计一直留着。
      this.frame = document.createElement('iframe');
      this.frame.className = 'desk-frame';
      this.frame.title = '设计台';
      this.frame.src = `${import.meta.env.BASE_URL}desk.html?embed=1&cut=P11-cat`;
      this.el.replaceChildren(this.frame, this.card);
    }
    this.card.hidden = true;
    this.el.style.display = 'block';
  }

  close(): void {
    this.open = false;
    this.el.style.display = 'none';
  }

  /** 设计台交回来一份设计：起名字、定数量、看花费和老同事的提醒。 */
  private offer(raw: Design, portrait: string): void {
    const card = this.card;
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = '带去岛上';
    const img = document.createElement('img');
    img.src = portrait;
    img.alt = '';
    img.className = 'desk-portrait';
    if (!this.release) {
      const p = document.createElement('p');
      p.textContent = '这份委托不能往岛上放设计的动物。';
      card.replaceChildren(title, img, p, this.backButton());
      card.hidden = false;
      return;
    }
    const release = this.release;
    const nameRow = document.createElement('label');
    nameRow.className = 'desk-name';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.placeholder = '给它起个名字';
    input.value = this.name;
    nameRow.append('名字 ', input);
    /** 物种 id 由设计内容决定：同样的设计同一个 id（再放只是多放几只），改了就是另一种。 */
    const build = (): { design: Design; species: SpeciesParams } => {
      const { id: _, ...rest } = { ...raw, name: input.value.trim() || '新设计', color: DESIGN_COLOR };
      const design: Design = { ...rest, id: `d_${checksum(rest).toString(36)}` };
      return { design, species: compileDesign(design, this.kit).params };
    };
    const compiled = compileDesign({ ...raw, color: DESIGN_COLOR }, this.kit);
    const hints = document.createElement('div');
    hints.className = 'desk-hints';
    for (const h of compiled.hints.slice(0, 3)) {
      const p = document.createElement('p');
      p.textContent = `老同事：${h.text}`;
      hints.append(p);
    }
    const picker = countPicker({
      verb: '放',
      button: '到岛上选地点',
      title: '回到地图上，点一下选投放的地点；放出去就收不回来了',
      max: release.maxAnimals,
      initial: this.count,
      onCount: (n) => {
        this.count = n;
        showQuote(n);
      },
      onGo: (n) => {
        this.name = input.value.trim();
        const { design, species } = build();
        this.close();
        release.start(design, species, n, portrait);
      },
    });
    const showQuote = (n: number): void => {
      const q = release.quote(build().species, n);
      picker.note.textContent = q.text;
      picker.button.disabled = !q.ok;
    };
    showQuote(this.count);
    card.replaceChildren(title, img, nameRow, hints, picker.row, picker.note, this.backButton());
    card.hidden = false;
    input.focus();
  }

  private backButton(): HTMLElement {
    const b = document.createElement('button');
    b.textContent = '再改改';
    b.className = 'desk-back';
    b.addEventListener('click', () => (this.card.hidden = true));
    return b;
  }
}
