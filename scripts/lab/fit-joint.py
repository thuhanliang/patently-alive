# 联合拟合镜头：车鼻子 14 个点 + 轮毂（正八边形）的屏幕比。用法：python3 scripts/lab/fit-joint.py（需要同目录的 fit-nose.py 的 obs/pts，见 exec 那行）
# 联合拟合：车鼻子的点 + 轮毂（正八边形）的屏幕比，镜头的偏转、俯视、视场角都自由。
import numpy as np
from scipy.optimize import least_squares
exec(open('fit-nose.py').read().split("x0=[")[0])
Wpx,Hpx=896,640
HUB=83/123
def fit(w_hub, fov0):
    def res(v):
        cam=v[:6]; m=v[6:]
        P=pts(m); out=[]
        for k,(ox,oy) in obs.items():
            X,Y=proj(cam,P[k]); out+=[X-ox,Y-oy]
        out.append(w_hub*(np.sin(cam[3])*np.cos(cam[4])-HUB))
        return out
    yaw=np.radians(45); pit=np.radians(20)
    d=6.5*np.tan(np.radians(8.7/2))/np.tan(np.radians(fov0/2)); tgt=np.array([0.0,1.05,0.1])
    f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
    x0=[*(tgt-f*d),yaw,pit,fov0,0.55,1.11,0.25,1.43,0.19,0.71,1.05,0.28,0.21,0.69,1.07]
    lo=[-30,-30,-30,0.3,0.0,5,0.3,0.8,0.1,1.2,0.1,0.5,0.9,0.1,0.1,0.5,0.9]
    hi=[30,30,30,1.4,1.0,40,0.9,1.5,0.5,1.7,0.5,0.95,1.3,0.6,0.5,0.95,1.3]
    r=least_squares(res,x0,bounds=(lo,hi))
    cam=r.x[:6]
    rms=np.sqrt(np.mean(np.square(r.fun[:-1])))
    def ref(o): return ((o[0]-170)*2.56,(o[1]-650)*2.56)
    def solve(L,R):
        def f2(v):
            a,y,z=v; o=[]
            for P_,q in [((-a,y,z),L),((a,y,z),R)]:
                X,Y=proj(cam,P_); rx,ry=ref(q); o+=[X-rx,Y-ry]
            return o
        s=least_squares(f2,[0.6,1.8,-0.3]); return s.x,np.sqrt(np.mean(np.square(s.fun)))
    b,rb=solve((400,556.7),(640,600)); t,rt=solve((446.7,431.7),(670,458))
    return rms,r.x,b,rb,t,rt
for fov0 in (8.7,12,16):
    rms,x,b,rb,t,rt=fit(60,fov0)
    print(f'初值 fov {fov0}: 鼻子 rms {rms:.2f}px | 偏转 {np.degrees(x[3]):.1f}° 俯视 {np.degrees(x[4]):.1f}° fov {x[5]:.1f}° | 灯中心 ±{x[7+0-1+1]:.2f}'.replace('x[7]','')+
          f' | 玻璃底 半宽{b[0]:.2f} 高{b[1]:.2f} 后{b[2]:.2f} (rms{rb:.1f}) 顶 半宽{t[0]:.2f} 高{t[1]:.2f} 后{t[2]:.2f} (rms{rt:.1f}) | 引擎盖长≈{0.05-b[2]:.2f}')
    print('   鼻子参数 a,c,gx,gy1,fx,fy0,fy1,fz,bx,by0,by1 =',np.round(x[6:],3))
