"""
把 Lovart 生成的品红底素材表切成单个透明 PNG（剪纸 demo 用）。

用法：python3 -I scripts/art/slice_sheet.py <素材表> <输出目录> [最大边长] [合并间隙像素] [--parts]
做法：按"品红程度" min(R,B) - G 抠背景并去溢色；再按行、列的投影找出空隙，把每个素材裁出来。
输出 <输出目录>/<行>_<列>.png 和 manifest.json
（每行每个素材的 [宽, 高, 不透明像素数, 原图 x, 原图 y, 原图宽, 原图高]）。

--parts：拆分零件表（handoff/006）用。整张表用同一个缩放倍数（最大边长 ÷ 原图边长，不放大），
零件之间的相对大小不变；原图位置用来和第一行拼好的参照对位。
"""
import json
import os
import sys

import numpy as np
from PIL import Image


def key_magenta(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    m = np.minimum(r, b) - g
    alpha = 1.0 - np.clip((m - 60.0) / 80.0, 0.0, 1.0)
    # 自然色里 B 很少高过 G 的同时 R 也高过 G：凡是 min(R,B) > G 的部分都当成品红溢色减掉。
    spill = np.clip(m, 0.0, None)
    out = np.stack([np.clip(r - spill, 0, 255), g, np.clip(b - spill, 0, 255), alpha * 255.0], axis=-1)
    return out.astype(np.uint8)


def runs(profile: np.ndarray, min_count: int, max_gap: int) -> list[tuple[int, int]]:
    """投影里连续有内容的区间；间隔不超过 max_gap 的合并。"""
    on = profile >= min_count
    spans: list[list[int]] = []
    i, n = 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            if spans and i - spans[-1][1] <= max_gap:
                spans[-1][1] = j
            else:
                spans.append([i, j])
            i = j
        else:
            i += 1
    return [(a, b) for a, b in spans if b - a >= 8]


def main() -> None:
    args = [a for a in sys.argv[1:] if a != '--parts']
    parts = '--parts' in sys.argv
    src, out_dir = args[0], args[1]
    max_side = int(args[2]) if len(args) > 2 else 256
    rgba = key_magenta(np.asarray(Image.open(src).convert('RGB')))
    # 零件表：整张表一个倍数。
    sheet_scale = min(1.0, max_side / max(rgba.shape[0], rgba.shape[1]))
    fg = rgba[..., 3] > 128
    os.makedirs(out_dir, exist_ok=True)
    # 间隙不超过这么多像素的内容算同一个素材（碎片、尾巴尖）；素材挨得近的表要调小。
    gap = int(args[3]) if len(args) > 3 else max(8, fg.shape[0] // 60)
    manifest = []
    for r, (y0, y1) in enumerate(runs(fg.sum(axis=1), 3, gap)):
        band = fg[y0:y1]
        row = []
        for c, (x0, x1) in enumerate(runs(band.sum(axis=0), 2, gap)):
            cell = band[:, x0:x1]
            ys = np.nonzero(cell.any(axis=1))[0]
            img = Image.fromarray(rgba[y0 + ys[0]:y0 + ys[-1] + 1, x0:x1])
            src_box = [int(x0), int(y0 + ys[0]), img.width, img.height]
            scale = sheet_scale if parts else min(1.0, max_side / max(img.size))
            if scale < 1.0:
                img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
            img.save(os.path.join(out_dir, f'{r}_{c}.png'), optimize=True)
            area = int((np.asarray(img)[..., 3] > 128).sum())
            row.append([img.width, img.height, area, *src_box])
        manifest.append(row)
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump(manifest, f)
    print(src, [len(row) for row in manifest])


if __name__ == '__main__':
    main()
