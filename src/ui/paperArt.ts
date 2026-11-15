/**
 * 界面上的小纸件（代码画的剪纸占位，2026-11-14）：邮票、图章、趴着的猫、三年里数量的小折线。
 * 都是 SVG 字符串；颜色守规矩——墨色深褐、蓝图蓝，不用朱红。
 */

const INK = '#4a3a28';
const BLUE = '#2f6bb3';

/** 一枚邮票：齿边、一座小岛或一只鸟。kind 决定画什么。 */
export function postageStamp(kind: 'island' | 'bird'): string {
  const teeth = Array.from({ length: 9 }, (_, i) => `<circle cx="${4 + i * 7}" cy="0" r="2.4"/><circle cx="${4 + i * 7}" cy="76" r="2.4"/>`).join('') + Array.from({ length: 11 }, (_, i) => `<circle cx="0" cy="${3 + i * 7}" r="2.4"/><circle cx="64" cy="${3 + i * 7}" r="2.4"/>`).join('');
  const art =
    kind === 'island'
      ? `<rect x="7" y="8" width="50" height="46" fill="#2f5d8c"/><path d="M7 44 q10 -7 18 -3 q8 -14 20 -6 q8 2 12 9 v10 h-50z" fill="#8fae5a"/><path d="M7 48 q12 -4 24 0 t26 0 v6 h-50z" fill="#3f79b5"/><circle cx="46" cy="18" r="5" fill="#f3d27a"/>`
      : `<rect x="7" y="8" width="50" height="46" fill="#cfe0ea"/><path d="M14 40 q8 -16 24 -12 l10 -6 l-4 9 q2 12 -14 13 q-10 1 -16 -4z" fill="#f6f1e6" stroke="${INK}" stroke-width="1"/><path d="M34 26 q6 -5 12 -3 l-4 6z" fill="#2a2a2a"/><path d="M26 44 v7 M32 44 v7" stroke="#a8562f" stroke-width="1.6"/>`;
  return `<svg class="stamp-post" viewBox="-3 -3 70 82" aria-hidden="true"><mask id="st-${kind}"><rect x="-3" y="-3" width="70" height="82" fill="#fff"/><g fill="#000">${teeth}</g></mask><rect x="0" y="0" width="64" height="76" fill="#fbf5e4" mask="url(#st-${kind})"/>${art}<text x="32" y="68" text-anchor="middle" font-size="9" fill="${INK}" font-family="serif" letter-spacing="1">生生邮政</text></svg>`;
}

/** 一枚圆图章：双圈，中间两到三个字。tone：blue 办成了的，brown 没办成或待定的。 */
export function seal(text: string, tone: 'blue' | 'brown'): string {
  const c = tone === 'blue' ? BLUE : '#7a5a3c';
  const size = text.length >= 3 ? 22 : 28;
  return `<svg class="seal" viewBox="0 0 100 100" aria-hidden="true"><defs><filter id="seal-rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25"/><feComposite in="SourceGraphic" operator="in"/></filter></defs><g filter="url(#seal-rough)" fill="none" stroke="${c}"><circle cx="50" cy="50" r="45" stroke-width="5"/><circle cx="50" cy="50" r="37" stroke-width="1.5"/><text x="50" y="${50 + size * 0.36}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${c}" stroke="none" font-family="'LXGW WenKai Screen', 'Kaiti SC', serif" letter-spacing="2">${text}</text><path d="M22 72 h56" stroke-width="1.2"/><text x="50" y="84" text-anchor="middle" font-size="8.5" fill="${c}" stroke="none" font-family="serif" letter-spacing="2">生生事务所</text></g></svg>`;
}

/** 趴在桌角的猫（剪纸：几片叠起来的纸，眼睛闭着，尾巴卷在身前）。 */
export function sleepingCat(): string {
  return `<svg class="office-cat" viewBox="0 0 240 130" aria-hidden="true">
<path d="M26 112 q-16 -44 30 -62 q44 -18 96 -6 q48 10 60 44 q8 22 -6 30 z" fill="#d9924a"/>
<path d="M70 58 q30 -10 62 -4 M92 50 q22 -6 46 0 M60 72 q12 -6 26 -6" stroke="#b56f2e" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.75"/>
<path d="M150 118 q40 6 62 -8 q14 -10 4 -22 q-10 -8 -18 2 q8 4 2 10 q-14 10 -50 8z" fill="#c9823c"/>
<path d="M18 104 q-10 -30 14 -46 l2 -22 l18 14 q14 -4 26 2 l16 -16 l4 24 q16 16 6 44 q-40 12 -86 0z" fill="#e2a25c"/>
<path d="M36 40 l4 12 l8 -6z M92 34 l-10 8 l12 4z" fill="#f3c9a0"/>
<path d="M40 78 q7 6 14 0 M70 78 q7 6 14 0" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
<path d="M60 86 l4 4 l-8 0z" fill="#b5654a"/>
<path d="M30 86 l-16 -3 M30 91 l-15 3 M94 86 l16 -3 M94 91 l15 3" stroke="#fbf5e4" stroke-width="1.2" opacity="0.8"/>
<path d="M26 112 q90 10 190 -2" stroke="rgba(20,12,4,.25)" stroke-width="2" fill="none"/>
</svg>`;
}

/** 一条小折线：三年里每季的只数。虚线是委托人要的下限。 */
export function sparkline(values: readonly number[], floor: number): string {
  const W = 560;
  const H = 70;
  const max = Math.max(floor * 1.4, ...values, 1);
  const x = (i: number): number => 14 + (i * (W - 28)) / Math.max(1, values.length - 1);
  const y = (v: number): number => H - 12 - (v / max) * (H - 24);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const years = [3.5, 7.5].filter((i) => i < values.length - 1).map((i) => `<path d="M${x(i).toFixed(1)} 6 V${H - 8}" stroke="${INK}" stroke-opacity=".18" stroke-dasharray="2 4"/>`).join('');
  const last = values.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${years}<path d="M10 ${y(floor).toFixed(1)} H${W - 10}" stroke="${BLUE}" stroke-opacity=".55" stroke-dasharray="6 5"/><polyline points="${pts}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>${values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === last ? 4 : 2.2}" fill="${i === last ? BLUE : INK}"/>`).join('')}</svg>`;
}

/** 把一段 SVG 字符串变成元素。 */
export function svgEl(markup: string): Element {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild!;
}
