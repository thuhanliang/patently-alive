import type { Design, Part } from '../data';
import { seal, sparkline, svgEl } from './paperArt';
import { sound } from './sound';

/**
 * 物种专利证书（2026-11-15）：每办完一份委托，事务所给设计的动物发一张证书，挂在事务所墙上。
 * 证书上的话是"一本正经地荒唐"（GDD 的调性）：权利要求书按设计的部件一条条写，审查员的意见按验收的结果挑。
 * 内容全由设计和验收结果拼出来，不由 AI 写（铁律 6）。只存在这个浏览器里。
 */

export interface Patent {
  /** 第几号（这个浏览器里发过的第几张）。 */
  no: number;
  name: string;
  /** 委托的名字（哪座岛）和委托人。 */
  place: string;
  client: string;
  /** 结果（见 verdict.ts 的 ReplyKey）。 */
  reply: string;
  /** 每季季末的只数。 */
  counts: number[];
  /** 委托人要的下限（折线上的虚线）。 */
  floor: number;
  claims: string[];
  /** 档案馆认为最接近的现有技术和相似度（0–1）；没有就不写。 */
  prior: { name: string; similarity: number } | null;
  /** 设计台上的样子（缩小过的图）。 */
  portrait: string;
}

const KEY = 'patently-alive-patents';
/** 墙上最多挂几张（再多就把最早的摘下来）。 */
const MAX_KEPT = 12;

export function readPatents(): Patent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Patent[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function savePatent(p: Omit<Patent, 'no'>): Patent {
  const all = readPatents();
  const patent: Patent = { ...p, no: (all.at(-1)?.no ?? 0) + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify([...all, patent].slice(-MAX_KEPT)));
  } catch {
    // 存不下（画像太大、空间满了）就不挂墙，证书照样看得到。
  }
  return patent;
}

const massText = (kg: number): string => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} 吨` : kg >= 1 ? `${Number(kg.toFixed(1))} 千克` : `${Math.round(kg * 1000)} 克`);
const times = (log10: number): string => `${Math.pow(10, log10).toFixed(2)} 倍`;

/** 权利要求书：按设计的部件一条条写，工程法律腔。parts 是这份设计用的各个部件。 */
export function claimsOf(design: Design, parts: Readonly<Record<'coat' | 'mouth' | 'limbs' | 'tail' | 'digestion' | 'rearing', Pick<Part, 'name'>>>): string[] {
  const out = [
    `一种体重约 ${massText(design.bodyMassKg)} 的四足动物，其特征在于：体表覆有${parts.coat.name}。`,
    `根据权利要求 1 所述的动物，其特征在于：以${parts.mouth.name}取食，经${parts.digestion.name}消化。`,
    `根据权利要求 1 所述的动物，其特征在于：以${parts.limbs.name}行进，身后设有${parts.tail.name}一条。`,
    `根据权利要求 1 所述的动物，其特征在于：幼崽为${parts.rearing.name}型，${design.nest === 'burrow' ? '产于洞中' : design.nest === 'ground' ? '产于地面浅窝' : '产于巢中'}。`,
  ];
  const shape: string[] = [];
  const s = design.shape;
  if (s?.leg) shape.push(`腿长为同类的 ${times(s.leg)}`);
  if (s?.tail) shape.push(`尾长为同类的 ${times(s.tail)}`);
  if (s?.fur) shape.push(`毛长为同类的 ${times(s.fur)}`);
  const ear = design.appearance?.earLen;
  if (ear !== undefined && Math.abs(ear - 1) > 0.05) shape.push(ear < 0.05 ? '不设耳廓' : `耳长为同类的 ${ear.toFixed(1)} 倍`);
  if (shape.length) out.push(`根据前述任一权利要求所述的动物，其特征在于：${shape.join('，')}。`);
  return out;
}

/** 审查员的意见：庄重，按验收结果挑一句。 */
export const EXAMINER: Record<string, string> = {
  success: '经实地验收，该物种确能在所述岛屿上存续，且未见扰邻。准予授权。',
  gone: '经实地验收，该物种未能存续。本局对申请人的勇气表示敬意；证书照发，以资留念。',
  few: '经实地验收，该物种尚在，惟数目令人担忧。本局建议申请人近期不要离岛太远。',
  swarm: '经实地验收，该物种的存续情况超出预期。委托人对"超出预期"一词持保留意见。',
  natives: '经实地验收，该物种存续良好。本局提请申请人注意：海边原有的住户并未同意这项发明。',
  habitat: '经实地验收，该物种存续良好，所述岛屿则不然。本局不受理岛屿提出的异议，但记录在案。',
};

const GRANTED = new Set(['success']);

/** 一张证书（DOM）。small：墙上的缩略版，只有画像、名字、号数和图章。 */
export function patentCard(p: Patent, small = false): HTMLElement {
  const card = document.createElement('div');
  card.className = `patent${small ? ' small' : ''}`;
  const no = document.createElement('div');
  no.className = 'patent-no';
  no.textContent = `物种专利 第 ${String(p.no).padStart(4, '0')} 号`;
  const title = document.createElement('div');
  title.className = 'patent-title';
  title.textContent = small ? p.name : '物种专利证书';
  const img = document.createElement('img');
  img.className = 'patent-portrait';
  img.src = p.portrait;
  img.alt = '';
  const stamp = svgEl(seal(GRANTED.has(p.reply) ? '授权' : '存档', GRANTED.has(p.reply) ? 'blue' : 'brown'));
  if (small) {
    card.append(no, img, title, stamp);
    return card;
  }
  const name = document.createElement('div');
  name.className = 'patent-name';
  name.textContent = `名称：${p.name}`;
  const fig = document.createElement('div');
  fig.className = 'patent-fig';
  const cap = document.createElement('span');
  cap.textContent = '说明书附图 1';
  fig.append(img, cap);
  const claims = document.createElement('ol');
  claims.className = 'patent-claims';
  for (const c of p.claims) {
    const li = document.createElement('li');
    li.textContent = c;
    claims.append(li);
  }
  const sec = (label: string): HTMLElement => {
    const h = document.createElement('div');
    h.className = 'log-head';
    h.textContent = label;
    return h;
  };
  const para = (text: string, cls = ''): HTMLElement => {
    const e = document.createElement('p');
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  const chart = document.createElement('div');
  chart.append(svgEl(sparkline(p.counts, p.floor)));
  card.append(
    no,
    title,
    name,
    fig,
    sec('权利要求书'),
    claims,
    ...(p.prior ? [sec('现有技术检索'), para(`自然档案馆认为，最接近的现有技术是「${p.prior.name}」（相似度 ${Math.round(p.prior.similarity * 100)}%）。${p.prior.similarity >= 0.9 ? '馆员在页边写道：这不就是它吗。' : p.prior.similarity < 0.55 ? '馆员在页边写道：没见过这样的。' : ''}`)] : []),
    sec(`实施例 · ${p.place}`),
    para(`受${p.client}委托投放，历时 ${Math.round(p.counts.length / 4)} 年，逐季只数如下。虚线为委托人要求的下限。`, 'note'),
    chart,
    sec('审查意见'),
    para(EXAMINER[p.reply] ?? EXAMINER['success']!, 'patent-opinion'),
    para('生生事务所 · 专利局驻所审查员', 'sign'),
    stamp,
  );
  return card;
}

/** 把画像缩到墙上挂得下的大小（存进浏览器的东西不能太大）。 */
export async function shrinkPortrait(url: string, maxW = 420): Promise<string> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, maxW / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** 把一张证书摆到屏幕正中看（点任何地方收起来）。 */
export function showPatent(p: Patent): void {
  document.getElementById('patent-view')?.remove();
  const veil = document.createElement('div');
  veil.id = 'patent-view';
  const sheet = document.createElement('div');
  sheet.className = 'modal-card';
  sheet.append(patentCard(p));
  veil.append(sheet);
  veil.addEventListener('click', () => veil.remove());
  document.body.append(veil);
  sound.play('flip');
  window.setTimeout(() => veil.isConnected && sound.play('stamp'), 450);
}
