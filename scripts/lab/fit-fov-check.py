# 镜头的视场角（fov）从车鼻子一张图里其实定不准：鼻子几乎是平的，深度变化很小。
# 这里固定几个 fov，分别重新拟合车鼻子的镜头，看拟合误差；再用同一个镜头反推挡风玻璃的深度。
import numpy as np
from scipy.optimize import least_squares
src=open('fit.py').read().split("x0=[")[0]
exec(src)
Wpx,Hpx=896,640
def run(fov):
    def res(v):
        cam=list(v[:5])+[fov]; m=v[5:]
        P=pts(m); out=[]
        for k,(ox,oy) in obs.items():
            X,Y=proj(cam,P[k]); out+=[X-ox,Y-oy]
        return out
    # 距离随 fov 变：保持视野大小近似不变
    d=6.5*np.tan(np.radians(8.7/2))/np.tan(np.radians(fov/2))
    yaw,pit=np.radians(31),np.radians(24)
    tgt=np.array([0.0,1.05,0.1])
    f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
    pos=tgt-f*d
    x0=[*pos,yaw,pit,0.55,1.11,0.25,1.43,0.19,0.71,1.05,0.28,0.21,0.69,1.07]
    lo=[-30,-30,-30,0,0,0.3,0.8,0.1,1.2,0.1,0.5,0.9,0.1,0.1,0.5,0.9]
    hi=[30,30,30,1.5,1.2,0.9,1.5,0.4,1.7,0.35,0.95,1.3,0.6,0.4,0.95,1.3]
    r=least_squares(res,x0,bounds=(lo,hi))
    cam=list(r.x[:5])+[fov]
    rms=np.sqrt(np.mean(np.square(r.fun)))
    # 挡风玻璃：四角在设计图（整图坐标）上的位置 -> 转成鼻子参考图坐标（ref = (overall-170)*2.56, (overall-650)*2.56）
    def ref(o): return ((o[0]-170)*2.56,(o[1]-650)*2.56)
    def solve(L,R):
        def f2(v):
            a,y,z=v; o=[]
            for P_,q in [((-a,y,z),L),((a,y,z),R)]:
                X,Y=proj(cam,P_); rx,ry=ref(q); o+=[X-rx,Y-ry]
            return o
        s=least_squares(f2,[0.6,1.8,-0.3]); return s.x,np.sqrt(np.mean(np.square(s.fun)))
    b,rb=solve((400,556.7),(640,600)); t,rt=solve((446.7,431.7),(670,458))
    return rms,b,rb,t,rt,cam
for fov in (8.7,14,20,28):
    rms,b,rb,t,rt,cam=run(fov)
    print(f'fov {fov:5.1f}: 鼻子拟合 rms {rms:5.2f}px | 玻璃底 半宽{b[0]:.2f} 高{b[1]:.2f} 后{b[2]:.2f} (rms{rb:.1f}) | 玻璃顶 半宽{t[0]:.2f} 高{t[1]:.2f} 后{t[2]:.2f} (rms{rt:.1f})  引擎盖长≈{0.05-b[2]:.2f}  玻璃斜长≈{np.hypot(t[1]-b[1],t[2]-b[2]):.2f}')
