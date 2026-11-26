import numpy as np, sys
from scipy.optimize import least_squares
exec(open('fitortho.py').read().split("for label,args")[0])
YAW,PIT=49.0,12.0
rms,x=fit(yaw0=YAW,pit0=PIT,fix=True)
c=x[:5]; m=x[5:]
names='a c gx gy1 fx fy0 fy1 fz bx by0 by1'.split()
print(f'鼻子 rms {rms:.2f}px  比例 {c[2]:.0f}px/m（参考图 896×640 里）')
for n,v in zip(names,m): print(f'  {n} = {v:.3f}')
# 玻璃：设计图上的 4 个角（整图坐标）→ 鼻子参考图坐标 ref=(overall-170)*2.56, (overall-650)*2.56
ref=lambda o:((o[0]-170)*2.56,(o[1]-650)*2.56)
def solve(L,R):
    def f2(v):
        a,y,z=v; o=[]
        for P_,q in [((-a,y,z),L),((a,y,z),R)]:
            X,Y=projo(c,P_); rx,ry=ref(q); o+=[X-rx,Y-ry]
        return o
    s=least_squares(f2,[0.8,1.8,-1.0]); return s.x,np.sqrt(np.mean(np.square(s.fun)))
b,rb=solve((400,556.7),(640,600)); t,rt=solve((446.7,431.7),(670,458))
print(f'玻璃底边：半宽 {b[0]:.2f} 高 {b[1]:.2f} 在鼻子面板后 {0.05-b[2]:.2f}（rms {rb:.1f}px）')
print(f'玻璃顶边：半宽 {t[0]:.2f} 高 {t[1]:.2f} 在鼻子面板后 {0.05-t[2]:.2f}（rms {rt:.1f}px）')
print(f'引擎盖水平长 ≈ {0.05-b[2]:.2f} m；玻璃后倾 {np.degrees(np.arctan2(b[2]-t[2],t[1]-b[1])):.1f}°；车宽 ≈ {2*m[0]+0.4:.2f} m')
np.save('ortho_result.npy',np.r_[c,m,b,t])
