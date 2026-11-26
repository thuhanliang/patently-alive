# 平行（轴测）投影检验：偏转 49°、俯视 12°（车身直线族 48.3°/11.1°、用户手画线 49.4°/12.6°、灯是正八边形 50°，三个来源一致）。依赖同目录的 fit-ortho.py 等，路径按实验时的临时目录写，复用前需改。
import numpy as np
from PIL import Image, ImageDraw, ImageFont
exec(open('fitortho.py').read().split("def fit(")[0])
R=np.load('ortho_result.npy'); c=R[:5]; m=R[5:16]; b=R[16:19]; t=R[19:22]
a,cy,gx,gy1,fx,fy0,fy1,fz,bx,by0,by1=m
def to_overall(p): return (p[0]/2.56+170, p[1]/2.56+650)
def P(pt): return to_overall(projo(c,pt))
im=Image.open('/home/user/patently-alive/art/incoming/lovart/010/5-details/6-overall.jpg').convert('RGB')
d=ImageDraw.Draw(im,'RGBA')
def line(p,q,col,w=2): d.line([P(p),P(q)],fill=col,width=w)
def poly(pts,col,w=3):
    for i in range(len(pts)): line(pts[i],pts[(i+1)%len(pts)],col,w)
F=0.05
# 地面网格（0.5 m）
for x in np.arange(-1.5,1.51,0.5): line((x,0,0.5),(x,0,-4.5),(0,110,255,120),1)
for z in np.arange(0.5,-4.51,-0.5): line((-1.5,0,z),(1.5,0,z),(0,110,255,120),1)
# 坐标轴（原点：车头正面底边正中的地面）
o=np.array([0,0,F])
for ax,col,L,tk in (((1,0,0),(255,0,0,255),1.5,0.5),((0,1,0),(0,170,0,255),2.5,0.5),((0,0,-1),(0,0,255,255),4.0,0.5)):
    line(tuple(o),tuple(o+np.array(ax)*L),col,4)
    k=tk
    while k<=L+1e-6:
        p=P(tuple(o+np.array(ax)*k)); d.ellipse([p[0]-4,p[1]-4,p[0]+4,p[1]+4],fill=col); d.text((p[0]+6,p[1]-6),f'{k:g}',fill=col); k+=tk
# 正八边形灯：中心 (±a, cy, F)，外框高 0.39、宽 0.39（正八边形）
def octagon(cx,cyy,hw,hh,cut=0.5):
    cxm=hw*cut; cym=hh*cut
    return [(cx-hw+cxm,cyy-hh,F),(cx+hw-cxm,cyy-hh,F),(cx+hw,cyy-hh+cym,F),(cx+hw,cyy+hh-cym,F),(cx+hw-cxm,cyy+hh,F),(cx-hw+cxm,cyy+hh,F),(cx-hw,cyy+hh-cym,F),(cx-hw,cyy-hh+cym,F)]
hwl=hhl=0.195
for s in (-1,1): poly(octagon(s*a,cy,hwl,hhl,0.29),(255,0,255,255),3)
# 格栅开口、信箱、面板外框
poly([(-gx,fy1+0.0,F),(gx,fy1,F),(gx,gy1,F),(-gx,gy1,F)],(255,140,0,255),3)
poly([(-bx,by0,F+fz*0.8),(bx,by0,F+fz*0.8),(bx,by1,F+fz*0.8),(-bx,by1,F+fz*0.8)],(255,200,0,255),3)
# 鼻子面板轮廓：宽 ±(a+0.1)，高 0.52~1.44
W=a+0.1
poly([(-W,0.52,F),(W,0.52,F),(W,1.44,F),(-W,1.44,F)],(0,200,200,255),2)
# 引擎盖顶面到玻璃底边
poly([(-W,1.44,F),(W,1.44,F),(b[0],b[1],b[2]),(-b[0],b[1],b[2])],(255,100,0,255),3)
# 玻璃
poly([(-b[0],b[1],b[2]),(b[0],b[1],b[2]),(t[0],t[1],t[2]),(-t[0],t[1],t[2])],(0,200,0,255),3)
crop=(80,250,1100,1050)
cc=im.crop(crop); dd=ImageDraw.Draw(cc); dd.rectangle([0,0,cc.width,22],fill=(255,255,255)); dd.text((6,5),'ORTHOGRAPHIC yaw 49 pitch 12: ground grid 0.5m | red=x green=y(up) blue=z(back) | magenta = REGULAR octagon lamps | orange=grille, yellow=mailbox | cyan=nose panel | green=glass',fill=(0,0,0))
cc.save('o-ortho.png'); print(cc.size)
