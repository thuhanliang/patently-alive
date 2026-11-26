# 挡风玻璃实验台的镜头：玻璃几何由我定，镜头去对设计图上窗框四角。用法：python3 scripts/lab/fit-windshield-cam.py
# 挡风玻璃实验台自己的镜头：玻璃的几何由我定（引擎盖约 1 米），镜头去对设计图上的窗框位置。
import numpy as np
from scipy.optimize import least_squares
Wpx,Hpx=960,600
# 设计图上的点（整图坐标）→ 参考裁图（300,360 起，放大 2 倍）坐标
def ref(o): return ((o[0]-300)*2,(o[1]-360)*2)
H=0.64; rake=np.radians(34)
Bz=-0.97; By=1.48
hwB,hwT=0.59,0.54
Tz=Bz-H*np.sin(rake); Ty=By+H*np.cos(rake)
mull=0.015
P={'BL':(-hwB,By,Bz),'BR':(hwB,By,Bz),'TL':(-hwT,Ty,Tz),'TR':(hwT,Ty,Tz)}
O={'BL':(400,556.7),'BR':(640,600),'TL':(446.7,431.7),'TR':(670,458),'MB':(542,573),'MT':(573,453)}
def proj(cam,Pt):
    px,py,pz,yaw,pit,fov=cam
    pos=np.array([px,py,pz]); f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
    r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f)
    d=np.array(Pt)-pos; x,y,z=d@r,d@u,d@f; t=np.tan(np.radians(fov)/2)
    return Wpx/2+x/(z*t)*(Hpx/2), Hpx/2-y/(z*t)*(Hpx/2)
def res(v):
    out=[]
    for k in P:
        X,Y=proj(v,P[k]); rx,ry=ref(O[k]); out+=[X-rx,Y-ry]
    return out
best=None
for fov in (14,20,28):
    d=7*np.tan(np.radians(8.7/2))/np.tan(np.radians(fov/2))
    yaw,pit=np.radians(30),np.radians(24)
    tgt=np.array([0,1.8,-1.2]); f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
    x0=[*(tgt-f*d),yaw,pit,fov]
    r=least_squares(res,x0,bounds=([-30,-30,-30,0,0.1,6],[30,30,30,1.5,1.2,50]))
    rms=np.sqrt(np.mean(np.square(r.fun)))
    print('fov init',fov,'-> rms',round(rms,2),'cam',np.round(r.x,3), 'yaw°',round(np.degrees(r.x[3]),1),'pitch°',round(np.degrees(r.x[4]),1))
    if best is None or rms<best[0]: best=(rms,r.x)
rms,cam=best
yaw,pit=cam[3],cam[4]
f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
tgt=cam[:3]+f*3
print('BEST rms',round(rms,2))
print('CAMSTR',','.join(f'{x:.3f}' for x in [*cam[:3],*tgt,cam[5]]))
print('glass B',(By,Bz),'T',(round(Ty,3),round(Tz,3)))
