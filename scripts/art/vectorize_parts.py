"""
把切好的纸偶零件变成矢量数据 + 一张纸纹贴图（handoff/007 的新路线，接 cut_parts.py）。

用法：python3 -I scripts/art/vectorize_parts.py <成品图> <种子.json> <输出目录>
依赖：pip install opencv-python-headless scikit-image

每片零件：
- 轮廓：分水岭切出的遮罩，补全被盖住的部分（只在盖住它的零件底下按凸包补），关节处补一块以转轴为圆心的圆形搭接片，
  再平滑成多边形。坐标是零件自己的：转轴在原点，骨头朝 +x（和 src/render/puppet/parts.ts 一样），单位是原图像素。
- 色区（像无限暖暖的染色区）：主色 / 条纹 / 浅色三档，各自一组多边形，颜色由代码给（铁律：内容即数据，颜色是数据）。
  补出来的部分只有主色（平时被盖住）。
- 原图上的铆钉和白色切边不进色区：代码按轮廓重画白边、影子和铆钉。
- 上下层（z）：种子.json 的 zOrder（底 → 顶）。

纸纹：从原图里挑一块只有主色的方块，去色、除以大范围模糊（只留纸的明暗），亮度拉到接近白，镜像拼成可以平铺的贴图，
用“正片叠底”铺在代码上的颜色上面。

种子.json 里每片零件可以给 "pivot": [x, y]（原图像素）、"pivotEstimated": true（图上没有铆钉，位置是估的）、
"overlap": 像素数（和父零件沿骨头方向互相多盖一截，见下）。
输出：<输出目录>/vector.json、paper.png
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut_parts import part_masks, segment  # noqa: E402


def smooth_poly(mask: np.ndarray, sigma: float = 1.6, eps: float = 0.5) -> np.ndarray:
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)[:, 0, :].astype(np.float32)
    n = len(c)
    r = int(3 * sigma) + 1
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    w /= w.sum()
    ext = np.concatenate([c[-r:], c, c[:r]])
    sm = np.stack([np.convolve(ext[:, i], w, 'valid') for i in range(2)], axis=1)[:n]
    ap = cv2.approxPolyDP(sm.reshape(-1, 1, 2).astype(np.float32), eps, True)[:, 0, :]
    return ap


def polys(mask: np.ndarray, min_area: float = 12) -> list:
    cnts, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in cnts:
        if cv2.contourArea(c) < min_area:
            continue
        m = np.zeros(mask.shape, np.uint8)
        cv2.drawContours(m, [c], -1, 1, -1)
        out.append(smooth_poly(m, 1.2, 0.6))
    return out


def main(src: str, seeds_path: str, out: str) -> None:
    im = cv2.imread(src)
    spec = json.load(open(seeds_path, encoding='utf-8'))
    parts: dict = spec['parts']
    names = list(parts)
    H, W = im.shape[:2]
    lab, fg, _ = segment(im, parts)
    masks = part_masks(lab, fg, parts)
    hull = {}
    for n, m in masks.items():
        cnts, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        h = np.zeros((H, W), np.uint8)
        cv2.drawContours(h, [cv2.convexHull(max(cnts, key=cv2.contourArea))], -1, 1, -1)
        hull[n] = h.astype(bool)

    # 上下层：种子.json 的 zOrder（底 → 顶）。纸偶的规律：远侧的腿最底下；铆钉长在哪片上，哪片就在上面。
    zo = spec.get('zOrder')
    if not zo or sorted(zo) != sorted(names):
        sys.exit('种子.json 要给 zOrder：全部零件从底到顶排一遍')
    z = {n: i for i, n in enumerate(zo)}

    # 转轴：种子.json 里给的，没给就用和父零件接触处的中点。
    pivot = {}
    for n in names:
        if 'pivot' in parts[n]:
            pivot[n] = np.array(parts[n]['pivot'], float)
        else:
            ys, xs = np.nonzero(masks[n])
            pivot[n] = np.array([xs.mean(), ys.mean()])

    # 补全：凸包落在“压着它的零件”底下的部分；再加关节的圆形搭接片。
    full = {}
    for n in names:
        over = np.zeros((H, W), bool)
        for m in names:
            if z[m] > z[n]:
                over |= masks[m]
        full[n] = masks[n] | (hull[n] & over)
    lap_r = {}
    # 每片零件的内切圆半径（最粗处的一半）。
    inr = {n: float(cv2.distanceTransform(np.pad(masks[n].astype(np.uint8), 1), cv2.DIST_L2, 5).max()) for n in names}
    for n in names:
        p = parts[n].get('parent')
        if not p:
            continue
        # 圆头的半径：两片里细的那片的内切圆半径（关节处肢体粗细的一半）。
        r = float(np.clip(0.9 * min(inr[n], inr[p]), 5, 40))
        lap_r[n] = r
        disc = np.zeros((H, W), np.uint8)
        cv2.circle(disc, tuple(int(v) for v in pivot[n]), int(r), 1, -1)
        full[n] |= disc.astype(bool)
        full[p] |= disc.astype(bool)

    extra = {n: np.zeros((H, W), bool) for n in names}
    # 重叠：种子.json 里给了 "overlap": 像素数的关节，两片沿骨头方向各往对方那边延伸一截（分界线的形状平移过去），
    # 上层那片盖住下层，转动时不露缝（例如胸片和臀片之间）。
    for n in names:
        p = parts[n].get('parent')
        d = parts[n].get('overlap', 0)
        if not p or not d:
            continue
        ys, xs = np.nonzero(masks[n])
        v = np.array([xs.mean(), ys.mean()]) - pivot[p]
        v = v / np.linalg.norm(v) * d
        shift = lambda m, dx, dy: cv2.warpAffine(m.astype(np.uint8), np.float32([[1, 0, dx], [0, 1, dy]]), (W, H)) > 0
        grow_n = shift(full[n], -v[0], -v[1]) & full[p]
        grow_p = shift(full[p], v[0], v[1]) & full[n]
        full[n] |= grow_n
        full[p] |= grow_p
        extra[n] |= grow_n
        extra[p] |= grow_p

    # 色区：去掉铆钉和白边，按颜色分主色 / 条纹 / 浅色。
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(int)
    Lc = cv2.cvtColor(im, cv2.COLOR_BGR2LAB)[:, :, 0].astype(int)
    rivet = ((hsv[:, :, 1] < 45) & (hsv[:, :, 2] > 230)).astype(np.uint8)
    rivet = cv2.dilate(rivet, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (27, 27))) > 0
    tone = np.zeros((H, W), np.int8)  # 0 主色 1 条纹 2 浅色
    tone[(Lc < 120) & (hsv[:, :, 0] < 30)] = 1
    tone[(Lc > 200) & (hsv[:, :, 1] < 120)] = 2
    out_parts = []
    for n in sorted(names, key=lambda n: z[n]):
        par = parts[n].get('parent')
        if par:
            ys, xs = np.nonzero(masks[n])
            c = np.array([xs.mean(), ys.mean()]) - pivot[n]
            ang = float(np.arctan2(c[1], c[0]))
        else:
            ang = 0.0
        ca, sa = np.cos(-ang), np.sin(-ang)

        def local(poly: np.ndarray) -> list:
            d = poly.astype(float) - pivot[n]
            x = d[:, 0] * ca - d[:, 1] * sa
            y = d[:, 0] * sa + d[:, 1] * ca
            return [round(float(v), 1) for xy in zip(x, y) for v in xy]

        inner = cv2.erode(masks[n].astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) > 0
        valid = inner & ~rivet
        # 白边和铆钉那一圈：按最近的有效像素的色区填上（不让白边被当成“浅色”）。
        t = np.where(valid, tone, -1).astype(np.int16)
        t_img = np.where(t < 0, 0, t + 1).astype(np.uint8)
        dist, idx = cv2.distanceTransformWithLabels((t_img == 0).astype(np.uint8), cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
        ys, xs = np.nonzero(t_img)
        lut = np.zeros(idx.max() + 1, np.uint8)
        lut[idx[ys, xs]] = t_img[ys, xs]
        filled = lut[idx] - 1
        regions = {}
        for k, key in ((1, 'stripe'), (2, 'pale')):
            m = (filled == k) & (masks[n] | extra[n])
            m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
            regions[key] = [local(p) for p in polys(m)]
        out_parts.append({
            'id': n,
            'parent': par,
            'z': z[n],
            'pivot': [round(float(v), 1) for v in pivot[n]],
            'pivotEstimated': bool(parts[n].get('pivotEstimated', False)),
            'angle': round(ang, 4),
            'lapR': round(lap_r.get(n, 0.0), 1),
            'outline': local(smooth_poly(full[n])),
            **regions,
        })

    # 纸纹：最大的一块纯主色方块。
    main_only = (tone == 0) & fg & ~rivet
    for n in names:
        main_only &= ~(cv2.dilate(masks[n].astype(np.uint8), np.ones((3, 3), np.uint8)) > 0) | (cv2.erode(masks[n].astype(np.uint8), np.ones((9, 9), np.uint8)) > 0)
    dist = cv2.distanceTransform(main_only.astype(np.uint8), cv2.DIST_L2, 5)
    cy, cx = np.unravel_index(np.argmax(dist), dist.shape)
    half = int(min(dist[cy, cx] * 0.7, 48))
    patch = Lc[cy - half: cy + half, cx - half: cx + half].astype(np.float32)
    hp = patch / cv2.GaussianBlur(patch, (0, 0), 12)
    paper = np.clip(1.0 + (hp - 1.0) * 1.4, 0.7, 1.15)
    paper = paper / np.percentile(paper, 90)
    tile = np.clip(paper, 0, 1)
    tile = np.concatenate([tile, tile[:, ::-1]], axis=1)
    tile = np.concatenate([tile, tile[::-1, :]], axis=0)
    os.makedirs(out, exist_ok=True)
    cv2.imwrite(os.path.join(out, 'paper.png'), (tile * 255).astype(np.uint8))

    json.dump({
        'source': os.path.basename(src),
        'size': [W, H],
        'paperPatch': [int(cx), int(cy), half * 2],
        # 原图里三档色区的颜色（中位数），只当“原样”那一套染色的参考。
        'palette': {key: '#%02x%02x%02x' % tuple(int(v) for v in np.median(im[(tone == k) & fg & ~rivet], axis=0)[::-1]) for k, key in ((0, 'main'), (1, 'stripe'), (2, 'pale'))},
        'parts': out_parts,
        # 骨架绑定（四条腿各三片零件和趾尖、地面高度、头尾）：原样抄过去，src/render/puppet/cutoutPuppet.ts 用。
        'rig': spec.get('rig'),
    }, open(os.path.join(out, 'vector.json'), 'w'), ensure_ascii=False)
    print('纸纹取自', (int(cx), int(cy)), '边长', half * 2)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
