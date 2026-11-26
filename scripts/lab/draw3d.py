# 检验镜头：把三维坐标（地面网格、坐标轴、体块线框）投影到设计图上。用法：python3 scripts/lab/draw3d.py
# 把镜头的三维坐标（地面网格 + 坐标轴 + 车头的体块线框）投影到设计图上，用来检验镜头。
import sys, numpy as np
from PIL import Image, ImageDraw
src=open('fit.py').read()
exec(src[src.index("def proj"):src.index("def res")])
Wpx,Hpx=896,640
def to_overall(p): return (p[0]/2.56+170, p[1]/2.56+650)
def P(cam,pt): return to_overall(proj(cam,pt))
def draw(cam,out,title,crop=(100,250,1100,1000)):
    im=Image.open('/home/user/patently-alive/art/incoming/lovart/010/5-details/6-overall.jpg').convert('RGB')
    d=ImageDraw.Draw(im,'RGBA')
    def line(a,b,col,w=2): d.line([P(cam,a),P(cam,b)],fill=col,width=w)
    # 地面网格 y = 0：沿 z 的线（x = -2..2）和沿 x 的线（z = 1..-5），每 0.5 米
    for x in np.arange(-2,2.01,0.5):
        line((x,0,1.0),(x,0,-5.0),(0,120,255,150),1)
    for z in np.arange(1.0,-5.01,-0.5):
        line((-2,0,z),(2,0,z),(0,120,255,150),1)
    # 坐标轴（原点在车鼻子正面底边正中的地面）：x 红、y 绿、z 蓝（z 朝后画），每 0.5 米一个刻度
    o=np.array([0,0,0.04])
    line(tuple(o),tuple(o+[1.5,0,0]),(255,0,0,255),4)
    line(tuple(o),tuple(o+[0,1.5,0]),(0,170,0,255),4)
    line(tuple(o),tuple(o+[0,0,-3.0]),(0,0,255,255),4)
    for k in (0.5,1.0,1.5):
        for ax,col in (((1,0,0),(255,0,0)),((0,1,0),(0,170,0))):
            p=P(cam,tuple(o+np.array(ax)*k)); d.ellipse([p[0]-4,p[1]-4,p[0]+4,p[1]+4],fill=col+(255,)); d.text((p[0]+6,p[1]-6),f'{k}',fill=col+(255,))
    for k in (0.5,1.0,1.5,2.0,2.5,3.0):
        p=P(cam,tuple(o+np.array((0,0,-k)))); d.ellipse([p[0]-4,p[1]-4,p[0]+4,p[1]+4],fill=(0,0,255,255)); d.text((p[0]+6,p[1]-6),f'{k}',fill=(0,0,255,255))
    # 车头体块线框：车鼻子面板（宽 1.52、y 0.58~1.44）、引擎盖斜面（到窗台 1.745，后 1.12）、驾驶室外框
    def box(pts,col,w=3):
        for i in range(len(pts)): line(pts[i],pts[(i+1)%len(pts)],col,w)
    hw=0.76
    # 鼻子正面
    box([(-hw,0.583,0.04),(hw,0.583,0.04),(hw,1.435,0.04),(-hw,1.435,0.04)],(255,0,255,255))
    # 引擎盖顶面
    box([(-hw,1.435,0.04),(hw,1.435,0.04),(hw,1.745,-1.12),(-hw,1.745,-1.12)],(255,140,0,255))
    # 侧面轮廓（右）
    box([(hw,0.583,0.04),(hw,1.435,0.04),(hw,1.745,-1.12),(hw,0.583,-1.2)],(255,140,0,200),2)
    # 挡风玻璃四角
    box([(-0.645,1.782,-1.102),(0.645,1.782,-1.102),(0.592,2.347,-1.386),(-0.592,2.347,-1.386)],(0,200,200,255))
    c=im.crop(crop); dd=ImageDraw.Draw(c); dd.rectangle([0,0,c.width,22],fill=(255,255,255,255)); dd.text((6,5),title,fill=(0,0,0))
    c.save(out)
def mk(pos,yaw,pit,fov): return [*pos,np.radians(yaw),np.radians(pit),fov]
draw(mk([2.944,3.595,5.019],30.7,23.6,8.698),'o-old.png','OLD camera: yaw 30.7 pitch 23.6')
draw(mk([3.877,2.901,4.67],40.07,16.4,9.166),'o-new.png','NEW camera: yaw 40.1 pitch 16.4 (blue=ground grid 0.5m, red=x, green=y up, blue=z back; magenta=nose, orange=hood, cyan=glass)')
