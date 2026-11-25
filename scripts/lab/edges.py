# 两张图的轮廓叠在一起：效果图的边是红，模型的边是蓝；重合处发紫/黑。另出一张 50% 半透明叠图。
import sys
from PIL import Image, ImageFilter, ImageOps, ImageChops
ref, ren, out = sys.argv[1:4]
a = Image.open(ref).convert('L'); b = Image.open(ren).convert('L').resize(a.size)
def edges(im):
    e = im.filter(ImageFilter.GaussianBlur(1.2)).filter(ImageFilter.FIND_EDGES)
    return e.point(lambda v: 255 if v > 14 else 0)
ea, eb = edges(a), edges(b)
w, h = a.size
o = Image.new('RGB', (w, h), 'white')
px = o.load(); A = ea.load(); B = eb.load()
for y in range(h):
    for x in range(w):
        ra, rb = A[x, y], B[x, y]
        if ra and rb: px[x, y] = (40, 0, 60)
        elif ra: px[x, y] = (230, 40, 40)
        elif rb: px[x, y] = (30, 90, 230)
blend = Image.blend(Image.open(ref).convert('RGB'), Image.open(ren).convert('RGB').resize(a.size), 0.5)
c = Image.new('RGB', (w * 2, h)); c.paste(o, (0, 0)); c.paste(blend, (w, 0)); c.save(out)
