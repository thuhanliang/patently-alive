/**
 * 引导便签（2026-11-10）：屏幕上方正中一张小纸签，永远只说一件事——现在该做什么，或者正在等什么。
 * 来自试玩的反馈"信息很多，不知道要做什么"。只有"立足"型的委托用它。
 */
export interface GuideState {
  /** 正等着在地图上点投放地点：放几只、叫什么。 */
  placing: { count: number; name: string } | null;
  /** 事务所设计的动物：名字和现在的只数（还没放过为空）。 */
  mine: { name: string; count: number }[];
  /** 这一季已经放上岛、生了、死了多少（只算事务所设计的）。 */
  season: { released: number; births: number; dead: number };
  /** 正在路上的投放（检疫、运输），还有几天到；没有为 null。 */
  arrivingInDays: number | null;
  paused: boolean;
  /** 离季末还有几天。 */
  daysToQuarter: number;
  ended: boolean;
}

export function guideText(g: GuideState): { text: string; action: 'desk' | 'play' | 'fast' | null } {
  if (g.ended) return { text: '委托结束了。可以留下来再看看，也可以回事务所。', action: null };
  if (g.placing) return { text: `在岛上的草地上点一下，放出 ${g.placing.count} 只${g.placing.name}。`, action: null };
  if (g.mine.length === 0 && g.arrivingInDays === null) return { text: '岛上还没有你的动物。先去设计台设计一种。', action: 'desk' };
  if (g.arrivingInDays !== null && g.mine.every((m) => m.count === 0))
    return g.paused ? { text: `它们在路上（检疫、运输还要 ${g.arrivingInDays} 天）。让时间走起来。`, action: 'play' } : { text: `它们在路上，还要 ${g.arrivingInDays} 天到。`, action: null };
  // 便签上只留只数：生了多少、死了多少在岛上看（纸偶头上的小纸签），季末看验收单。数太多会眼花。
  const who = g.mine.map((m) => `${m.name} ${m.count} 只`).join('，');
  if (g.paused) return { text: `${who}。让时间走起来，季末出验收单。`, action: 'play' };
  return { text: `${who}。看看它们在岛上过得怎么样；${g.daysToQuarter > 10 ? '季末' : `还有 ${g.daysToQuarter} 天`}出验收单。`, action: 'fast' };
}

/** 便签本身：一句话 + 至多一个按钮。 */
export class Guide {
  private readonly text = document.createElement('span');
  private readonly button = document.createElement('button');
  private last = '';

  constructor(
    private readonly el: HTMLElement,
    private readonly act: { desk: () => void; play: () => void; fast: () => void },
  ) {
    el.append(this.text, this.button);
    el.hidden = true;
    this.button.addEventListener('click', () => {
      const a = this.button.dataset['action'] as 'desk' | 'play' | 'fast' | undefined;
      if (a) this.act[a]();
    });
  }

  update(g: GuideState): void {
    const { text, action } = guideText(g);
    const sig = `${text}|${action}`;
    if (sig === this.last) return;
    this.last = sig;
    this.el.hidden = false;
    this.text.textContent = text;
    this.button.hidden = action === null;
    this.button.dataset['action'] = action ?? '';
    this.button.textContent = action === 'desk' ? '去设计台' : action === 'play' ? '▶ 开始' : action === 'fast' ? '快进到季末' : '';
  }
}
