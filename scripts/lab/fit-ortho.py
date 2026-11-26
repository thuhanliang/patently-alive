# 平行（轴测）投影拟合：屏幕 = s·(r·P, u·P) + 偏移。参数只有 偏转、俯视、比例、偏移 + 鼻子尺寸，没有视场角这个难约束的量。
import numpy as np
from scipy.optimize import least_squares
src=open('fit.py').read()
exec(src.split("def proj")[0])           # obs, pts(), F, GZ, GH
Wpx,Hpx=896,640
def basis(yaw,pit):
    f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
    r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f); return f,r,u
def projo(c,P):
    yaw,pit,s,tx,ty=c; f,r,u=basis(yaw,pit); P=np.array(P)
    return tx+s*(P@r), ty-s*(P@u)
def fit(yaw0=None,pit0=None,fix=False):
    def res(v):
        c=v[:5]; m=v[5:]; P=pts(m); out=[]
        for k,(ox,oy) in obs.items():
            X,Y=projo(c,P[k]); out+=[X-ox,Y-oy]
        return out
    y0=np.radians(yaw0 or 45); p0=np.radians(pit0 or 15)
    x0=[y0,p0,380,450,350,0.55,1.11,0.25,1.43,0.19,0.71,1.05,0.28,0.21,0.69,1.07]
    lo=[0.1,0.0,100,-2000,-2000,0.3,0.8,0.1,1.2,0.1,0.5,0.9,0.1,0.1,0.5,0.9]
    hi=[1.5,1.0,3000,4000,4000,0.9,1.5,0.5,1.7,0.5,0.95,1.3,0.6,0.5,0.95,1.3]
    if fix:
        lo[0]=y0-1e-6;hi[0]=y0+1e-6;lo[1]=p0-1e-6;hi[1]=p0+1e-6
    r=least_squares(res,x0,bounds=(lo,hi))
    return np.sqrt(np.mean(np.square(r.fun))),r.x
for label,args in (('自由（偏转、俯视都拟合）',dict()),
                   ('固定为用户手画线：偏转 49.4°、俯视 12.6°',dict(yaw0=49.4,pit0=12.6,fix=True)),
                   ('固定为灭点法：偏转 44.9°、俯视 11.2°',dict(yaw0=44.9,pit0=11.2,fix=True)),
                   ('固定为 旧拟合 偏转 31°、俯视 24°',dict(yaw0=31,pit0=24,fix=True)),
                   ('固定 偏转 40°、俯视 16°',dict(yaw0=40,pit0=16,fix=True))):
    rms,x=fit(**args)
    print(f'{label}: 鼻子 rms {rms:.2f}px | 偏转 {np.degrees(x[0]):.1f}° 俯视 {np.degrees(x[1]):.1f}° 比例 {x[2]:.0f}px/m | 灯中心±{x[5]:.2f} 高{x[6]:.2f} 格栅半宽{x[7]:.2f} 鼻头宽±{x[13]:.2f} fz {x[12]:.2f}')
