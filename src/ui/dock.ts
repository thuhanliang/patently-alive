import { FIELD_KIND_NAMES, type FieldKind } from './fieldTools';

/**
 * 下方正中的工具栏（参照 Lovart 的现场设计图）：一排图标纸签。
 * 左边是兽医箱的五类工具（陷阱、夜间搜捕、体检采样、找尸体、围栏），右边是档案馆、设计台。
 * 点一类工具：上方弹出这一类的参数卡，并进入放置模式；再点一次（或 Esc）收起。
 * 图标：陷阱、采样、围栏用 Lovart P6 切下来的蓝图蓝纸件（public/ui/），其余是代码画的剪纸占位。
 */
export interface DockHandle {
  /** 现在打开的是哪一类工具（null 表示收着）。 */
  readonly kind: FieldKind | null;
  /** 收起工具卡（Esc、打开档案馆或设计台时）。 */
  close(): void;
  /** 每帧调用：档案馆、设计台的按钮跟着它们开没开。 */
  sync(archiveOpen: boolean, deskOpen: boolean): void;
}

const BLUE = '#3a78c2';
const BLUE_EDGE = '#24548f';
const KRAFT = '#d7b27a';
const KRAFT_EDGE = '#9c7643';
/** 夜间搜捕：一支手电筒。 */
const TORCH = `<svg viewBox="0 0 46 38"><path d="M6 15 h18 l8 -6 v20 l-8 -6 h-18 z" fill="${BLUE}" stroke="${BLUE_EDGE}" stroke-width="1.2"/><path d="M33 12 l10 -6 M33 19 h11 M33 26 l10 6" stroke="#f0c45a" stroke-width="2.4" stroke-linecap="round"/><rect x="9" y="17" width="8" height="4" fill="#bcd3ee"/></svg>`;
/** 找尸体：一把放大镜。 */
const LENS = `<svg viewBox="0 0 46 38"><circle cx="18" cy="16" r="10" fill="#d9e8f7" stroke="${BLUE}" stroke-width="4.5"/><path d="M26 24 l11 10" stroke="${BLUE_EDGE}" stroke-width="6" stroke-linecap="round"/><path d="M13 12 q4 -4 9 -1" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;
/** 档案馆：一个牛皮纸文件夹。 */
const FOLDER = `<svg viewBox="0 0 46 38"><path d="M4 9 h13 l4 4 h21 v20 h-38 z" fill="${KRAFT_EDGE}"/><path d="M4 15 h38 v18 h-38 z" fill="${KRAFT}" stroke="${KRAFT_EDGE}" stroke-width="1"/><rect x="9" y="11" width="22" height="6" fill="#f4ead2" transform="rotate(-4 20 14)"/></svg>`;
/** 设计台：一把三角尺和一支圆规。 */
const DESK = `<svg viewBox="0 0 46 38"><path d="M5 33 l18 -26 v26 z" fill="${KRAFT}" stroke="${KRAFT_EDGE}" stroke-width="1.2"/><path d="M11 30 l8 -11 v11 z" fill="#2a1f14" opacity=".18"/><path d="M33 6 l-7 27 M33 6 l7 27" stroke="#8e7a5e" stroke-width="2.4" stroke-linecap="round"/><circle cx="33" cy="6" r="3" fill="#c9a24a" stroke="#8a6a24"/></svg>`;

const ICONS: Record<FieldKind | 'archive' | 'desk', string> = {
  trap: '<img src="ui/cage.webp" alt="">',
  cull: TORCH,
  sample: '<img src="ui/ring.webp" alt="">',
  necropsy: LENS,
  fence: '<img src="ui/fence.webp" alt="">',
  archive: FOLDER,
  desk: DESK,
};
const TITLES: Record<FieldKind, string> = {
  trap: '布笼子：放几晚，抓到哪些就移除',
  cull: '今晚在一片地上搜捕某一种动物',
  sample: '抓一只做体检、采样，检查后放生',
  necropsy: '找新鲜尸体带回来做尸检',
  fence: '架防兔网或防捕食者围栏：点起点、终点',
};

export function bindDock(
  dock: HTMLElement,
  pop: HTMLElement,
  handlers: {
    /** 打开一类工具（参数卡已经显示）。 */
    choose: (kind: FieldKind) => void;
    /** 收起工具卡、退出放置模式。 */
    stop: () => void;
    archive: () => void;
    desk: () => void;
  },
): DockHandle {
  let kind: FieldKind | null = null;
  const make = (key: FieldKind | 'archive' | 'desk', label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.innerHTML = `${ICONS[key]}<span></span>`;
    b.lastElementChild!.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    dock.append(b);
    return b;
  };
  const close = (): void => {
    kind = null;
    pop.hidden = true;
    for (const [, b] of toolButtons) b.classList.remove('active');
    handlers.stop();
  };
  const toolButtons = (['trap', 'cull', 'sample', 'necropsy', 'fence'] as const).map(
    (k) =>
      [
        k,
        make(k, k === 'cull' ? '搜捕' : k === 'necropsy' ? '尸检' : k === 'sample' ? '采样' : FIELD_KIND_NAMES[k], TITLES[k], () => {
          if (kind === k) {
            close();
            return;
          }
          kind = k;
          pop.hidden = false;
          for (const [kk, b] of toolButtons) b.classList.toggle('active', kk === k);
          handlers.choose(k);
        }),
      ] as const,
  );
  const sep = document.createElement('span');
  sep.className = 'sep';
  dock.append(sep);
  const archiveBtn = make('archive', '档案', '翻看现有技术：真实动物的数据档案和知识卡', () => {
    close();
    handlers.archive();
  });
  const deskBtn = make('desk', '设计台', '设计一种新动物：选体型、部件和繁殖策略，看推导出来的代价', () => {
    close();
    handlers.desk();
  });
  return {
    get kind() {
      return kind;
    },
    close,
    sync: (archiveOpen, deskOpen) => {
      archiveBtn.classList.toggle('active', archiveOpen);
      deskBtn.classList.toggle('active', deskOpen);
    },
  };
}
