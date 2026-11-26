import sys, json; sys.path.insert(0,'.')
from ortho import *
from PIL import Image, ImageDraw
im=Image.open('/home/user/patently-alive/art/incoming/lovart/010/5-details/6-overall.jpg').convert('RGB')
d=ImageDraw.Draw(im,'RGBA')
def box(x0,x1,y0,y1,z0,z1,col,w=3):
    V=[(x,y,z) for x in (x0,x1) for y in (y0,y1) for z in (z0,z1)]
    idx=lambda x,y,z:(x*4+y*2+z)
    E=[(a,b) for a in range(8) for b in range(8) if a<b and bin(a^b).count('1')==1]
    for a,b in E: d.line([to_px(V[a]),to_px(V[b])],fill=col,width=w)
B=json.load(open('boxes.json'))
cols={'nose':(255,0,255,255),'cab':(0,170,0,255),'cargo':(0,90,255,255),'roof':(255,140,0,255),'wheel':(200,0,0,255)}
for name,v in B.items():
    box(*v,col=cols.get(name.split('_')[0],(80,80,80,255)))
# 地面网格
for x in np.arange(-1.5,2.01,0.5): d.line([to_px((x,0,0.5)),to_px((x,0,-6.5))],fill=(0,110,255,90),width=1)
for z in np.arange(0.5,-6.51,-0.5): d.line([to_px((-1.5,0,z)),to_px((2,0,z))],fill=(0,110,255,90),width=1)
for z in np.arange(0.0,-6.1,-1.0):
    p=to_px((0.0,0,z)); d.text((p[0],p[1]),f'z{z:g}',fill=(0,0,255,255))
im.save(sys.argv[1] if len(sys.argv)>1 else 'boxes.png')
