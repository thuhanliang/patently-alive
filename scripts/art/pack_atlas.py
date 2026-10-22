"""
把 slice_sheet.py 切出来的一组小图（<目录>/<行>_<列>.png + manifest.json）打包成一张图集，给网页一次载入。

用法：python3 -I scripts/art/pack_atlas.py <切图目录> <输出前缀> [质量]
输出 <输出前缀>.webp（有损 WebP，带透明）和 <输出前缀>.json（PixiJS 的 Spritesheet 格式，
帧名 "<行>_<列>"；meta.rows 原样带上 manifest，程序按它还原行列）。

为什么：一张素材表切成几十张 PNG，网页要发几十个请求、几十张贴图，画的时候每张贴图单独一次绘制。
打成一张图集只要一个请求，同一张图集里的素材能合批绘制；WebP 比 PNG 小很多。
"""
import json
import os
import sys

from PIL import Image

PAD = 4  # 素材之间的透明间隔（像素），防止线性采样时串色
MAX_W = 2048


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else 86
    with open(os.path.join(src, 'manifest.json')) as f:
        rows = json.load(f)
    items = []
    for r, row in enumerate(rows):
        for c, _ in enumerate(row):
            img = Image.open(os.path.join(src, f'{r}_{c}.png')).convert('RGBA')
            items.append((f'{r}_{c}', img))
    # 货架装箱：按高度从高到低排，一行放满换下一行。
    width = min(MAX_W, max(sum(img.width + PAD for _, img in items), max(img.width for _, img in items) + PAD))
    order = sorted(items, key=lambda it: (-it[1].height, it[0]))
    x = y = shelf = 0
    places = {}
    for name, img in order:
        if x + img.width + PAD > width:
            x = 0
            y += shelf
            shelf = 0
        places[name] = (x, y)
        x += img.width + PAD
        shelf = max(shelf, img.height + PAD)
    height = y + shelf
    if width > 4096 or height > 4096:
        raise SystemExit(f'图集太大：{width}×{height}')
    atlas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    frames = {}
    for name, img in items:
        px, py = places[name]
        atlas.paste(img, (px, py))
        frames[name] = {
            'frame': {'x': px, 'y': py, 'w': img.width, 'h': img.height},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': img.width, 'h': img.height},
            'sourceSize': {'w': img.width, 'h': img.height},
        }
    image_name = os.path.basename(out) + '.webp'
    atlas.save(out + '.webp', 'WEBP', quality=quality, method=6, exact=False)
    meta = {'image': image_name, 'format': 'RGBA8888', 'size': {'w': width, 'h': height}, 'scale': '1', 'rows': rows}
    with open(out + '.json', 'w') as f:
        json.dump({'frames': frames, 'meta': meta}, f, separators=(',', ':'))
    print(out, f'{width}×{height}', f'{os.path.getsize(out + ".webp") // 1024} KB', len(items), '张')


if __name__ == '__main__':
    main()
