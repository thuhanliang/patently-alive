import { DesignSchema, type Design, type Part, type SpeciesParams } from '../data';
import { checksum, compileDesign, percentText, partsOf, nearest, traitsOf, type CheckId, type CheckResult, type CompiledDesign, type DesignKit, type Grade } from '../sim';
import { BLUEPRINT, DESIGN_COLORS, cssAlpha } from '../render/palette';
import { countPicker } from './countPicker';
import { drawBlueprint, massText } from './blueprint';

const ACTIVITY: Array<[Design['activity'], string]> = [
  ['diurnal', '昼行'],
  ['nocturnal', '夜行'],
  ['crepuscular', '晨昏活动'],
  ['cathemeral', '昼夜都活动'],
];

/** 体重滑杆的范围（千克，按对数）。 */
const MASS_MIN = 0.005;
const MASS_MAX = 100_000;
/** 浏览器里的草稿（只是方便，读不到也照常工作）。 */
const DRAFT_KEY = 'patently-alive-design-draft';

/** 设计台上"投放到这里"要的东西；情景不允许投放设计物种时不传，就不显示这一栏。 */
export interface ReleaseHooks {
  maxAnimals: number;
  /** 投放 count 只的花费说明。 */
  quote(species: SpeciesParams, count: number): string;
  /** 选好了数量：设计台关掉，回到地图上点投放地点。 */
  start(design: Design, species: SpeciesParams, count: number): void;
}

/**
 * 设计台（阶段 3）：拼部件、调性状，实时看蓝图线稿、能量收支、推导属性和老同事的提醒。
 * 设计台只编译、不改推演；打开时推演暂停（由 main 看 isOpen 决定）。信息只放这一屏。
 */
export class DesignDesk {
  private open = false;
  private design: Design;
  private compiled: CompiledDesign | null = null;
  /** 每窝仔数的输入框："自动"时显示推出来的数（不能改）。 */
  private litterInput: HTMLInputElement | null = null;
  private readonly canvas = document.createElement('canvas');
  private readonly energyBox = div('desk-energy');
  private readonly derivedBox = div('desk-derived');
  private readonly hintBox = div('desk-hints');
  /** 拖滑杆时一帧里会来好几次输入：线稿每帧只画一次。 */
  private drawPending = false;
  private count = 20;
  private releaseNote: HTMLElement | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly kit: DesignKit,
    private readonly slots: ReadonlyArray<{ id: keyof Design['parts']; name: string; visible: boolean }>,
    private readonly templates: ReadonlyArray<{ species: string; design: Design }>,
    /** 比对"最像的现有技术"用。 */
    private readonly priorArt: ReadonlyMap<string, SpeciesParams>,
    private readonly release?: ReleaseHooks,
  ) {
    // 草稿里的部件可能已经改名或删掉了：编译不了就不用它。
    const draft = loadDraft();
    const usable = draft !== null && canCompile(draft, kit);
    this.design = usable ? draft : { ...templates.find((t) => t.species === 'mongoose')!.design, name: '新设计', color: DESIGN_COLORS[0] };
    el.addEventListener('click', (e) => {
      if (e.target === el) this.close();
    });
    this.canvas.className = 'desk-blueprint';
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** 当前的设计和编译结果（第 4 步投放用）。 */
  get current(): { design: Design; compiled: CompiledDesign } {
    return { design: this.withId(), compiled: this.compiled ?? compileDesign(this.withId(), this.kit) };
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    this.open = true;
    this.el.style.display = 'flex';
    this.render();
  }

  close(): void {
    this.open = false;
    this.el.replaceChildren();
    this.el.style.display = 'none';
  }

  /** 物种 id 由设计内容决定：同样的设计同一个 id（再投放只是多放几只），改了就是另一个物种。 */
  private withId(): Design {
    const { id: _, ...rest } = this.design;
    return { ...this.design, id: `d_${checksum(rest).toString(36)}` };
  }

  private render(): void {
    const card = div('modal-card desk-card');
    const head = div('archive-head');
    head.append(textEl('div', '设计台 · 新物种', 'modal-title'));
    const closeBtn = textEl('button', '×', 'card-close');
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', () => this.close());
    head.append(closeBtn);

    const left = div('desk-left');
    left.append(this.canvas, ...(this.release ? [this.releaseRow(this.release)] : []), this.energyBox);
    const right = div('desk-right');
    right.append(this.derivedBox, this.hintBox);
    const body = div('desk-body');
    body.append(left, this.controls(), right);
    card.append(head, body);
    this.el.replaceChildren(card);
    this.update();
  }

  /** 投放这个设计：选数量、看花费，然后回到地图上点地点。投放后收不回来。 */
  private releaseRow(hooks: ReleaseHooks): HTMLElement {
    const picker = countPicker({
      verb: '投放',
      button: '投放到这里',
      title: '关掉设计台，在地图上点投放地点。投放后收不回来，只能再用兽医手段减少。',
      max: hooks.maxAnimals,
      initial: this.count,
      onCount: (n) => {
        this.count = n;
        this.quoteRelease();
      },
      onGo: (n) => {
        this.count = n;
        const { design, compiled } = this.current;
        this.close();
        hooks.start(design, compiled.params, n);
      },
    });
    this.releaseNote = picker.note;
    return picker.row;
  }

  private quoteRelease(): void {
    if (this.release && this.compiled && this.releaseNote) this.releaseNote.textContent = this.release.quote(this.compiled.params, this.count);
  }

  /** 中间一栏：从现有技术开始、名字、性状、各槽位的部件。 */
  private controls(): HTMLElement {
    const box = div('desk-controls');
    const d = this.design;

    const from = document.createElement('select');
    from.add(new Option('从现有技术开始……', ''));
    for (const t of this.templates) from.add(new Option(t.design.name, t.species));
    from.addEventListener('change', () => {
      const t = this.templates.find((x) => x.species === from.value);
      if (!t) return;
      this.design = { ...t.design, name: `仿${t.design.name}`.slice(0, 20), color: this.design.color ?? DESIGN_COLORS[0] };
      saveDraft(this.design);
      this.render();
    });
    box.append(row('起点', from));

    const name = document.createElement('input');
    name.value = d.name;
    name.maxLength = 20;
    name.addEventListener('input', () => this.set({ name: name.value.trim() || '新设计' }));
    box.append(row('名字', name));

    // 体重：对数滑杆。
    const mass = document.createElement('input');
    mass.type = 'range';
    mass.min = String(Math.log10(MASS_MIN));
    mass.max = String(Math.log10(MASS_MAX));
    mass.step = '0.01';
    mass.value = String(Math.log10(d.bodyMassKg));
    const massLabel = textEl('span', massText(d.bodyMassKg), 'note');
    mass.addEventListener('input', () => {
      const kg = roundMass(10 ** Number(mass.value));
      massLabel.textContent = massText(kg);
      this.set({ bodyMassKg: kg });
    });
    box.append(row('体重', mass, massLabel));

    // 主色：田野笔记的几种平涂色。
    const colors = div('desk-colors');
    for (const c of DESIGN_COLORS) {
      const b = document.createElement('button');
      b.className = `desk-color${(d.color ?? '') === c ? ' active' : ''}`;
      b.style.background = c;
      b.title = '在世界里的主色';
      b.addEventListener('click', () => {
        colors.querySelectorAll('.desk-color').forEach((x) => x.classList.toggle('active', x === b));
        this.set({ color: c });
      });
      colors.append(b);
    }
    box.append(row('主色', colors));

    const litter = numberInput(1, 16, d.litterSize, (v) => this.set({ litterSize: v }));
    this.litterInput = litter;
    // "自动"：按同体型、同食性的典型值推（阶段 3.5）。手填的数留着，取消勾选时还原。
    const auto = document.createElement('input');
    auto.type = 'checkbox';
    auto.checked = d.litterAuto === true;
    litter.disabled = auto.checked;
    auto.addEventListener('change', () => {
      litter.disabled = auto.checked;
      if (auto.checked) this.set({ litterAuto: true });
      else {
        const { litterAuto: _, ...rest } = this.design;
        this.design = rest;
        litter.value = String(rest.litterSize);
        this.set({});
      }
    });
    const autoLabel = document.createElement('label');
    autoLabel.append(auto, ' 自动');
    autoLabel.title = '按同体型、同食性的真实动物一般一窝几个来定';
    box.append(row('每窝', litter, textEl('span', '个', 'note'), autoLabel));
    const months = numberInput(1, 12, d.breedingMonths, (v) => this.set({ breedingMonths: v }));
    box.append(row('繁殖季', months, textEl('span', '个月（从春天算起）', 'note')));

    const activity = select(ACTIVITY, d.activity, (v) => this.set({ activity: v }));
    box.append(row('活动', activity));
    const nest = select(
      [
        ['burrow', '洞穴或巢穴'],
        ['ground', '地面浅窝'],
      ],
      d.nest,
      (v) => this.set({ nest: v }),
    );
    box.append(row('窝', nest));
    const territorial = document.createElement('input');
    territorial.type = 'checkbox';
    territorial.checked = d.territorial;
    territorial.addEventListener('change', () => this.set({ territorial: territorial.checked }));
    box.append(row('守领地', territorial));

    for (const slot of this.slots) {
      const options = [...this.kit.parts.values()].filter((p) => p.slot === slot.id);
      const blurb = textEl('div', '', 'note desk-blurb');
      const pick = select(
        options.map((p) => [p.id, p.name] as [string, string]),
        d.parts[slot.id],
        (v) => {
          this.set({ parts: { ...this.design.parts, [slot.id]: v } });
          blurb.textContent = partText(this.kit.parts.get(v)!);
        },
      );
      blurb.textContent = partText(this.kit.parts.get(d.parts[slot.id])!);
      const label = slot.visible ? slot.name : `${slot.name}（看不见）`;
      const r = row(label, pick);
      box.append(r, blurb);
    }
    return box;
  }

  private set(patch: Partial<Design>): void {
    this.design = { ...this.design, ...patch };
    saveDraft(this.design);
    this.update();
  }

  /** 重新编译，刷新线稿、能量收支、推导属性和提醒（控件不重建，免得丢焦点）。 */
  private update(): void {
    const design = this.withId();
    const c = compileDesign(design, this.kit);
    this.compiled = c;
    // 画布要先进了文档才有尺寸；一帧只画一次（画最新的设计）。
    if (!this.drawPending) {
      this.drawPending = true;
      requestAnimationFrame(() => {
        this.drawPending = false;
        if (this.open && this.compiled) drawBlueprint(this.canvas, this.withId(), this.compiled.bird);
      });
    }
    if (this.litterInput && design.litterAuto) this.litterInput.value = String(c.params.reproduction.litterSize);
    this.renderEnergy(c);
    this.renderDerived(c);
    this.renderHints(c);
    this.quoteRelease();
  }

  private renderEnergy(c: CompiledDesign): void {
    const { lines, needKjPerDay, digestibility, appetite } = c.energy;
    const bar = div('desk-energy-bar');
    lines.forEach((l, i) => {
      const seg = div('desk-energy-seg');
      // 省能量的部件（负数）不画进条里，只在下面列出。
      seg.style.flexGrow = String(Math.max(0, l.kjPerDay));
      seg.style.background = cssAlpha(BLUEPRINT, 0.85 - 0.6 * (i / Math.max(1, lines.length - 1)));
      seg.title = `${l.label}：${Math.round(l.kjPerDay)} 千焦/天`;
      bar.append(seg);
    });
    const list = document.createElement('dl');
    list.className = 'archive-data';
    for (const l of lines) list.append(textEl('dt', l.label), textEl('dd', `${l.kjPerDay >= 0 ? '' : '−'}${Math.abs(Math.round(l.kjPerDay))} 千焦/天`));
    list.append(textEl('dt', '合计'), textEl('dd', `${Math.round(needKjPerDay)} 千焦/天`));
    list.append(textEl('dt', '消化'), textEl('dd', `吃进去的能取出 ${Math.round(digestibility * 100)}%`));
    // 胃口刻度：0.5×–2×，1× 是同体重的现有动物。
    const scale = div('desk-appetite');
    const marker = div('desk-appetite-marker');
    const pos = Math.min(1, Math.max(0, (Math.log2(appetite) + 1) / 2));
    marker.style.left = `${pos * 100}%`;
    // 胃口偏大的门槛由引擎定（提醒 energyHigh），界面不另写一个数。
    const high = c.hints.some((h) => h.id === 'energyHigh');
    marker.classList.toggle('warn', high);
    scale.append(div('desk-appetite-mid'), marker);
    const labels = div('note desk-appetite-labels');
    labels.append(textEl('span', '0.5×'), textEl('span', '1×'), textEl('span', '2×'));
    this.energyBox.replaceChildren(
      textEl('div', '能量收支', 'log-head'),
      bar,
      list,
      textEl('div', `胃口：同体重现有动物的 ${appetite.toFixed(2)} 倍`, high ? 'desk-warn' : ''),
      scale,
      labels,
    );
  }

  private renderDerived(c: CompiledDesign): void {
    const p = c.params;
    const r = p.reproduction;
    const bird = c.bird;
    const diet = [
      ['植物', p.diet.plant],
      ['脊椎动物', p.diet.vertebrate],
      ['无脊椎动物', p.diet.invertebrate],
    ]
      .filter(([, v]) => (v as number) > 0)
      .map(([k, v]) => `${k} ${Math.round((v as number) * 100)}%`)
      .join('，');
    const littersPerYear = c.littersPerYear;
    const move = [p.movement.flies ? '会飞' : c.tooHeavyToFly ? '有翅膀但飞不起来' : null, p.movement.climbs ? '会爬' : null, p.movement.territorial ? '守领地' : null]
      .filter(Boolean)
      .join('，');
    const dl = document.createElement('dl');
    dl.className = 'archive-data';
    const rows: Array<[string, string]> = [
      ['食性', diet],
      [bird ? '孵化期' : '妊娠期', `${r.gestationDays} 天`],
      ['窝里', `${r.nestDays} 天`],
      ['两窝间隔', `${r.litterIntervalDays} 天（一年约 ${littersPerYear.toFixed(1)} 窝）`],
      ['性成熟', days(r.ageAtMaturityDays)],
      ['最长寿命', `${p.maxLifespanYears} 年`],
      ['成体年存活', `${Math.round(p.survival.adultAnnual * 100)}%`],
      ['每天活动', `${p.movement.dailyRangeM} 米`],
      ['家域', `${p.movement.homeRangeKm2} 平方公里`],
      ['移动', move || '—'],
      ...c.viability.map((r): [string, string] => [CHECK_NAMES[r.id], viabilityText(r)]),
    ];
    for (const [k, v] of rows) dl.append(textEl('dt', k), textEl('dd', v));
    const near = nearest(traitsOf(p), this.priorArt.values(), 1)[0];
    this.derivedBox.replaceChildren(
      textEl('div', '推导属性', 'log-head'),
      textEl('p', '这些都由体型、部件和繁殖策略推出来，不能直接填。', 'note'),
      dl,
      ...(near ? [textEl('p', `最像的现有技术：${this.priorArt.get(near.id)!.name}（相似度 ${Math.round(near.similarity * 100)}%）`, 'note')] : []),
    );
  }

  private renderHints(c: CompiledDesign): void {
    this.hintBox.replaceChildren(
      textEl('div', '老同事的批注', 'log-head'),
      ...(c.hints.length > 0 ? c.hints.map((h) => textEl('p', `· ${h.text}`, 'desk-hint')) : [textEl('p', '看着还行。投出去才知道。', 'note')]),
    );
  }
}

const CHECK_NAMES: Record<CheckId, string> = { skeleton: '骨骼', digestion: '消化', reproduction: '繁殖' };
const SKELETON_GRADES: Record<Grade, string> = { ok: '能跑', strained: '跑不动', failing: '走不动', fatal: '站不住' };

/** 推导属性里的一行：骨骼写安全系数和等级（只说情况，提醒在批注里）。 */
function viabilityText(r: CheckResult): string {
  if (r.skipped) return '—';
  if (r.id === 'skeleton') return `安全系数 ${(r.evidence.safety ?? 0).toFixed(1)}（${SKELETON_GRADES[r.grade]}）`;
  if (r.id === 'reproduction') return reproductionText(r);
  if (r.id === 'digestion') return digestionText(r);
  return r.grade === 'ok' ? '正常' : '有问题';
}

const DIGESTION_GRADES: Record<Grade, string> = { ok: '吃得够', strained: '吃力', failing: '营养不良', fatal: '养不活' };

/** 消化一行：食谱里的植物都是草本时，能量够需要的几成（提醒在批注里）；不吃植物的写"不吃植物"。 */
function digestionText(r: CheckResult): string {
  const fed = r.evidence.herbFed;
  if (fed === undefined) return '不吃植物';
  return `植物都是草时，能量够需要的 ${percentText(fed)}%（${DIGESTION_GRADES[r.grade]}）`;
}

/** 繁殖一行：兽写每个新生儿多重，鸟写蛋数是否超出；有后果的写出来（提醒在批注里）。 */
function reproductionText(r: CheckResult): string {
  const e = r.evidence;
  const head = (e.neonateG ?? 0) > 0 ? `每个新生儿约 ${massText((e.neonateG ?? 0) / 1000)}` : '每窝蛋数';
  const issues: string[] = [];
  if ((e.neonateSurvival ?? 1) < 1) issues.push(`约 ${percentText(1 - e.neonateSurvival!)}% 保不住`);
  if ((e.dystociaPerLitter ?? 0) > 0) issues.push(`难产 ${percentText(e.dystociaPerLitter!)}%/窝`);
  return `${head}（${issues.length > 0 ? issues.join('，') : '在真实范围内'}）`;
}

function partText(p: Part): string {
  const why = p.effects.map((e) => e.why).join('；');
  return why ? `${p.blurb}（${why}）` : p.blurb;
}

function canCompile(d: Design, kit: DesignKit): boolean {
  try {
    partsOf(d, kit);
    return true;
  } catch {
    return false;
  }
}

function loadDraft(): Design | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const r = DesignSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

function saveDraft(d: Design): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // 存不了草稿不影响设计。
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function textEl(tag: string, text: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function row(label: string, ...inputs: HTMLElement[]): HTMLElement {
  const r = div('desk-row');
  r.append(textEl('span', label, 'desk-label'), ...inputs);
  return r;
}

function select<T extends string>(options: ReadonlyArray<[T, string]>, value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [v, label] of options) s.add(new Option(label, v));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value as T));
  return s;
}

function numberInput(min: number, max: number, value: number, onChange: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.value = String(value);
  i.style.width = '4em';
  i.addEventListener('input', () => {
    const n = Math.floor(Number(i.value));
    if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
  });
  // 离开输入框时把超出范围的数改成实际用的数，并且真的用它（显示的和设计里的一致）。
  i.addEventListener('change', () => {
    const n = Math.max(min, Math.min(max, Math.floor(Number(i.value)) || min));
    i.value = String(n);
    onChange(n);
  });
  return i;
}

/** 体重取两位有效数字（滑杆上的值不必那么精确）。 */
function roundMass(kg: number): number {
  return Number(Math.min(MASS_MAX, Math.max(MASS_MIN, kg)).toPrecision(2));
}

const days = (d: number): string => (d >= 360 ? `${(d / 360).toFixed(1)} 年` : `${d} 天`);
