"""
把 AI 生成的一整只纸偶成品图，按零件之间的分界线近似切成一片片零件，再排一张“炸开图”（handoff/007 的新路线）。

用法：python3 -I scripts/art/cut_parts.py <成品图> <种子.json> <输出目录>
依赖：pip install opencv-python-headless scikit-image

做法：
1. 背景：和四个角颜色接近的像素（纯黑或品红底都行）。
2. 分界线：零件之间有一条细的浅色切边和一道暗影；用形态学的顶帽 / 黑帽把细亮线、细暗线提出来，当作“地形高度”。
3. 种子.json 里每片零件给几个落在它身上的点，分水岭从种子往外长，长到分界线停下。
   分界线有断口也没关系：两边的种子会在断口处相遇。
4. 每片零件存成透明 PNG（被别的零件盖住的部分是缺的，留给 AI 局部补全）。
5. 炸开图：按种子.json 的零件树，从根开始，每片沿给定方向推开，直到和已经放好的零件之间留出空隙；角度和大小都不变。

种子.json：{"parts": {"<名字>": {"seeds": [[x, y], ...], "parent": "<父零件>" | null, "dir": [dx, dy]}}, "gap": 16}
（坐标是原图像素，y 朝下；dir 是相对父零件往哪边推。）

输出：
- parts/<名字>.png：单片零件（原图分辨率，透明底）
- segments.png：原图上叠各零件的色块和名字，检查切得对不对
- exploded.png：黑底炸开图；exploded-labeled.png 加上名字
- manifest.json：每片在原图里的外框、在炸开图里的位移
"""
import json
import os
import sys

import cv2
import numpy as np
from skimage.segmentation import watershed


def main(src: str, seeds_path: str, out: str) -> None:
    im = cv2.imread(src)
    if im is None:
        sys.exit(f'读不了图：{src}')
    spec = json.load(open(seeds_path, encoding='utf-8'))
    parts: dict = spec['parts']
    gap = int(spec.get('gap', 16))
    names = list(parts)
    H, W = im.shape[:2]

    # 1. 背景：和四角的平均色接近。
    corners = np.array([im[2, 2], im[2, -3], im[-3, 2], im[-3, -3]], float).mean(axis=0)
    fg = np.linalg.norm(im.astype(float) - corners, axis=2) > 45

    # 2. 分界线的强度：细亮线（低饱和）+ 细暗线。
    L = cv2.cvtColor(im, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32)
    sat = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)[:, :, 1]
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    bright = cv2.morphologyEx(L, cv2.MORPH_TOPHAT, k) * (sat < 110)
    dark = cv2.morphologyEx(L, cv2.MORPH_BLACKHAT, k)
    elev = cv2.GaussianBlur(np.maximum(bright, dark * 0.8), (3, 3), 0)

    # 3. 分水岭。
    markers = np.zeros((H, W), np.int32)
    for i, n in enumerate(names):
        for x, y in parts[n]['seeds']:
            cv2.circle(markers, (int(x), int(y)), 4, i + 1, -1)
    markers[~fg] = 0
    bg = len(names) + 1
    markers[cv2.erode((~fg).astype(np.uint8), k) > 0] = bg
    lab = watershed(elev, markers)
    lab[~fg] = 0

    # 4. 每片零件：带上分界线（往外 1 像素），只留最大的一块，填掉里面的小洞。
    os.makedirs(os.path.join(out, 'parts'), exist_ok=True)
    rgba = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)
    masks = {}
    manifest = {}
    for i, n in enumerate(names):
        m = cv2.dilate((lab == i + 1).astype(np.uint8), np.ones((3, 3), np.uint8)) & fg.astype(np.uint8)
        cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        if not cnts:
            sys.exit(f'零件 {n} 没切出来：检查它的种子点')
        m2 = np.zeros_like(m)
        cv2.drawContours(m2, [max(cnts, key=cv2.contourArea)], -1, 1, -1)
        masks[n] = m2.astype(bool)
        ys, xs = np.nonzero(m2)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
        p = rgba[y0:y1, x0:x1].copy()
        p[:, :, 3] = m2[y0:y1, x0:x1] * 255
        cv2.imwrite(os.path.join(out, 'parts', f'{n}.png'), p)
        manifest[n] = {'bbox': [x0, y0, x1 - x0, y1 - y0], 'parent': parts[n].get('parent')}

    # 检查图：色块 + 名字。
    rng = np.random.default_rng(3)
    cols = rng.integers(60, 255, (bg + 1, 3))
    cols[0] = 0
    cols[bg] = 0
    vis = (im * 0.45 + cols[lab] * 0.55).astype(np.uint8)
    for n, m in masks.items():
        ys, xs = np.nonzero(m)
        put_label(vis, n, int(xs.mean()), int(ys.mean()))
    cv2.imwrite(os.path.join(out, 'segments.png'), vis)

    # 5. 炸开图。
    PAD = max(H, W) // 2
    CH, CW = H + 2 * PAD, W + 2 * PAD
    occ = np.zeros((CH, CW), bool)
    kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * gap + 1, 2 * gap + 1))
    pts = {n: np.argwhere(m) for n, m in masks.items()}
    roots = [n for n in names if not parts[n].get('parent')]
    order, queue = [], list(roots)
    while queue:
        n = queue.pop(0)
        order.append(n)
        queue += [c for c in names if parts[c].get('parent') == n]
    missing = set(names) - set(order)
    if missing:
        sys.exit(f'这些零件的父零件不在树上：{sorted(missing)}')
    off: dict = {}
    for n in order:
        par = parts[n].get('parent')
        o = np.zeros(2)
        if par:
            d = np.array(parts[n].get('dir', [0, 1]), float)
            d /= np.linalg.norm(d)
            o = off[par] + d * 10
            for _ in range(3000):
                yy = pts[n][:, 0] + PAD + round(o[1])
                xx = pts[n][:, 1] + PAD + round(o[0])
                if not occ[yy, xx].any():
                    break
                o = o + d * 2
        off[n] = o
        m = np.zeros((CH, CW), np.uint8)
        m[pts[n][:, 0] + PAD + round(o[1]), pts[n][:, 1] + PAD + round(o[0])] = 1
        occ |= cv2.dilate(m, kern) > 0
    canvas = np.zeros((CH, CW, 3), np.uint8)
    canvas[:] = corners.astype(np.uint8)
    for n in order:
        yy, xx = pts[n][:, 0], pts[n][:, 1]
        canvas[yy + PAD + round(off[n][1]), xx + PAD + round(off[n][0])] = im[yy, xx]
    ys, xs = np.nonzero(occ)
    y0, y1, x0, x1 = max(0, ys.min() - 20), ys.max() + 20, max(0, xs.min() - 20), xs.max() + 20
    canvas = canvas[y0:y1, x0:x1]
    cv2.imwrite(os.path.join(out, 'exploded.png'), canvas)
    labeled = canvas.copy()
    for n in order:
        ys_, xs_ = pts[n][:, 0], pts[n][:, 1]
        put_label(labeled, n, int(xs_.mean() + PAD + off[n][0] - x0), int(ys_.mean() + PAD + off[n][1] - y0))
    cv2.imwrite(os.path.join(out, 'exploded-labeled.png'), labeled)
    for n in order:
        manifest[n]['offset'] = [round(float(off[n][0]), 1), round(float(off[n][1]), 1)]
    json.dump({'source': os.path.basename(src), 'parts': manifest}, open(os.path.join(out, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'{len(names)} 片零件 → {out}')


def put_label(img: np.ndarray, text: str, x: int, y: int) -> None:
    (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
    cv2.putText(img, text, (x - w // 2, y + h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 0), 3)
    cv2.putText(img, text, (x - w // 2, y + h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
