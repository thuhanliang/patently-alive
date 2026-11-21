"""
把 Lovart 生成的素材表切成单个透明图（2026-11-21，handoff/009 起用；slice_sheet.py 只认正品红，这一批的底是偏粉的品红）。

用法：python3 -I scripts/art/cut_sheet.py <素材表> <输出目录> [最小面积像素]
做法：
- 背景色取四边的中位数；按"色度"（颜色除以亮度）和背景色的距离抠底——背景上的投影只是暗一点的同一种颜色，一起抠掉；
  所以台口中间、洞穴里这种被素材围起来的品红也会抠掉（本来就该是空的）。
- 边缘去溢色：半透明的像素减掉背景色的成分。
- 连通域分件，按"先行后列"编号，输出 <编号>.png（裁到不透明的外框，留 2 像素边）和 index.json、contact.png（带编号的总览）。
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    min_area = int(sys.argv[3]) if len(sys.argv) > 3 else 1500
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    border = np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    s = rgb.sum(axis=2, keepdims=True) + 1e-3
    chroma = rgb / s
    bgc = bg / bg.sum()
    d = np.sqrt(((chroma - bgc) ** 2).sum(axis=2))
    # 亮度太低（接近黑）的像素色度不可靠：按"不是背景"算。
    dark = s[..., 0] < 90
    alpha = np.clip((d - 0.05) / 0.07, 0, 1)
    alpha[dark] = 1
    # 去溢色：半透明处按 alpha 把背景色"减回去"，再除以 alpha 还原素材本来的颜色。
    a3 = alpha[..., None]
    fg = np.where(a3 > 0.02, (rgb - (1 - a3) * bg) / np.maximum(a3, 0.02), rgb)
    fg = np.clip(fg, 0, 255)
    solid = ndimage.binary_closing(alpha > 0.5, iterations=3)
    labels, n = ndimage.label(solid)
    boxes = ndimage.find_objects(labels)
    pieces = []
    for i, sl in enumerate(boxes):
        area = int((labels[sl] == i + 1).sum())
        if area < min_area:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        pieces.append((i + 1, y0, y1, x0, x1, area))
    # 先行后列：中心的 y 分到行（相差不到 120 像素算同一行），行内按 x。
    pieces.sort(key=lambda p: (p[1] + p[2]) / 2)
    rows: list[list[tuple]] = []
    for p in pieces:
        cy = (p[1] + p[2]) / 2
        if rows and abs(cy - (rows[-1][0][1] + rows[-1][0][2]) / 2) < 120:
            rows[-1].append(p)
        else:
            rows.append([p])
    ordered = [p for r in rows for p in sorted(r, key=lambda q: q[3])]
    os.makedirs(out, exist_ok=True)
    index = []
    contact = Image.fromarray(np.uint8(rgb)).convert('RGB')
    draw = ImageDraw.Draw(contact)
    H, W = alpha.shape
    for k, (lab, y0, y1, x0, x1, area) in enumerate(ordered):
        y0, y1, x0, x1 = max(0, y0 - 2), min(H, y1 + 2), max(0, x0 - 2), min(W, x1 + 2)
        # 只留这一件（同一个外框里别的件的碎片不要），但保留被它围住的半透明边。
        own = ndimage.binary_dilation(labels[y0:y1, x0:x1] == lab, iterations=3)
        a = (alpha[y0:y1, x0:x1] * own * 255).astype(np.uint8)
        img = np.dstack([fg[y0:y1, x0:x1].astype(np.uint8), a])
        name = f'{k:02d}.png'
        Image.fromarray(img, 'RGBA').save(os.path.join(out, name))
        index.append({'file': name, 'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0), 'area': area})
        draw.rectangle([x0, y0, x1, y1], outline=(255, 255, 0), width=4)
        draw.text((x0 + 8, y0 + 8), str(k), fill=(255, 255, 0))
    contact.thumbnail((1000, 1000))
    contact.save(os.path.join(out, 'contact.png'))
    with open(os.path.join(out, 'index.json'), 'w') as f:
        json.dump({'background': [int(v) for v in bg], 'pieces': index}, f, indent=1)
    print(src, 'bg', bg.astype(int), 'pieces', len(index))


if __name__ == '__main__':
    main()
