# 平行投影工具：世界坐标 (x 车宽，y 向上，z 向车头；车头正面在 z=0.05) <-> 整图（2000×1500）像素。
import numpy as np
R=np.load('/tmp/claude-0/-home-user-patently-alive/f281a6a0-02aa-525e-b17d-7cb26125a82d/scratchpad/lab/ortho_result.npy')
YAW,PIT,S,TX,TY=R[:5]   # S：鼻子参考图里的 px/m；TX,TY 同一坐标系
def basis(yaw=YAW,pit=PIT):
    f=np.array([-np.sin(yaw)*np.cos(pit),-np.sin(pit),-np.cos(yaw)*np.cos(pit)])
    r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f); return f,r,u
f_,r_,u_=basis()
PXM=S/2.56   # 整图 px / m
def to_px(P):
    P=np.array(P,float); X=TX+S*(P@r_); Y=TY-S*(P@u_)
    return (170+X/2.56, 650+Y/2.56)
def from_px(px,py,plane):
    """整图像素 -> 世界，plane=('x'|'y'|'z', 值)"""
    X=(px-170)*2.56; Y=(py-650)*2.56
    a=(X-TX)/S; b=-(Y-TY)/S             # P·r = a, P·u = b
    # P = a r + b u + t f ，用平面约束解 t
    ax={'x':0,'y':1,'z':2}[plane[0]]
    base=a*r_+b*u_
    t=(plane[1]-base[ax])/f_[ax]
    return base+t*f_
if __name__=='__main__':
    print('yaw',np.degrees(YAW),'pit',np.degrees(PIT),'整图 px/m',round(PXM,1))
