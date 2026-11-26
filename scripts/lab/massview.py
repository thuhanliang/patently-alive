import sys
from PIL import Image, ImageDraw
S='/tmp/claude-0/-home-user-patently-alive/f281a6a0-02aa-525e-b17d-7cb26125a82d/scratchpad/lab'
tag=sys.argv[1]
P=[(157,553),(157,345),(177,335),(275,318),(300,302),(307,297),(350,170),(370,140),(955,137),(962,118),(1170,118),(1195,135),(1207,165),(1207,553)]
r=Image.open('/home/user/patently-alive/public/lab/ref-side.png').convert('RGB'); t=Image.open(f'{S}/ms-{tag}.png').convert('RGB').resize(r.size)
for im in (r,t): ImageDraw.Draw(im).line([(x-100,y) for x,y in P+[P[0]]],fill=(230,30,30),width=2)
c=Image.new('RGB',(r.width,r.height*2+8),'white'); c.paste(r,(0,0)); c.paste(t,(0,r.height+8)); c.save(f'{S}/cmp-ms-{tag}.png')
r=Image.open('/home/user/patently-alive/public/lab/ref-front.png').convert('RGB'); t=Image.open(f'{S}/mf-{tag}.png').convert('RGB').resize(r.size)
# 正视截面（像素）：画在两张图上
BF=0.00526; sec=[(0,1.02),(1.57,1.02),(1.65,0.93),(2.3,0.93),(2.44,0.85),(2.53,0.72)]
pts=[(1626+h/BF-1380,613-y/BF-60) for y,h in sec]; pts=pts+[(1626-h/BF-1380,613-y/BF-60) for y,h in reversed(sec)]
for im in (r,t): ImageDraw.Draw(im).line(pts+[pts[0]],fill=(30,90,230),width=2)
c=Image.new('RGB',(r.width*2+8,r.height),'white'); c.paste(r,(0,0)); c.paste(t,(r.width+8,0)); c.save(f'{S}/cmp-mf-{tag}.png')
