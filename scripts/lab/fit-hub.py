import numpy as np
from scipy.optimize import least_squares
exec(open('fit.py').read().split("def res(v):")[0].split("obs = {")[0])  # 取 proj 等
import re
src=open('fit.py').read()
exec(src[src.index("def proj"):src.index("def res")])
Wpx,Hpx=896,640
V=np.load('hub_vertices.npy')
def to_ref(o): return ((o[0]-170)*2.56,(o[1]-650)*2.56)
Vr=np.array([to_ref(v) for v in V])
def octagon(xc,yc,zc,r,rot=22.5):
    out=[]
    for k in range(8):
        a=np.radians(rot+45*k)
        out.append((xc,yc+r*np.sin(a),zc+r*np.cos(a)))   # 轮盘在 x = xc 的竖直平面里
    return out
def check(cam,label):
    best=None
    for rot in (22.5,0.0):
        for zc0 in (-1.5,-2.5,-3.5):
            def res(v):
                xc,yc,zc,r=v; P=octagon(xc,yc,zc,r,rot); out=[]
                # 顶点顺序不确定：对每个设计图顶点找最近的投影顶点（8 对 8）
                Q=np.array([proj(cam,p) for p in P])
                for q in Vr:
                    d=np.min(np.hypot(Q[:,0]-q[0],Q[:,1]-q[1]))
                    out.append(d)
                return out
            r=least_squares(res,[0.85,0.45,zc0,0.22],bounds=([0.6,0.2,-8,0.08],[1.2,1.0,0,0.6]))
            rms=np.sqrt(np.mean(np.square(r.fun)))
            if best is None or rms<best[0]: best=(rms,r.x,rot)
    print(f'{label}: 轮毂八边形拟合 rms {best[0]:.1f} px（参考图坐标，整图 ×0.39） 位置 x={best[1][0]:.2f} 高={best[1][1]:.2f} z={best[1][2]:.2f} 外接半径={best[1][3]:.2f}')
def mk(pos,yaw,pit,fov): return [*pos,np.radians(yaw),np.radians(pit),fov]
check(mk([2.944,3.595,5.019],30.7,23.6,8.698),'旧镜头（偏转 30.7° 俯视 23.6°）')
check(mk([3.877,2.901,4.67],40.07,16.4,9.166),'新镜头（偏转 40.1° 俯视 16.4°）')
for yaw,pit in ((35,20),(45,16),(45,22),(50,20),(40,22),(40,12)):
    # 位置：保持看向同一点、同一距离
    f=np.array([-np.sin(np.radians(yaw))*np.cos(np.radians(pit)),-np.sin(np.radians(pit)),-np.cos(np.radians(yaw))*np.cos(np.radians(pit))])
    tgt=np.array([1.54,2.396,2.654]); pos=tgt-f*6.9
    check(mk(pos,yaw,pit,9.0),f'试 偏转 {yaw}° 俯视 {pit}°')
