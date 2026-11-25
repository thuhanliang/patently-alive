# 部件实验台：在效果图上量关键点（obs），和模型上对应的点（pts）一起最小二乘拟合镜头和比例。
# 用法：python3 scripts/lab/fit-nose.py（换部件时改 obs、pts、参数表）。
# 从效果图上量的点，同时求镜头和车鼻子的比例（以灯玻璃半高 = 0.126 定尺度）。
import numpy as np
from scipy.optimize import least_squares
Wpx, Hpx = 896, 640
obs = {
 'gL_c':(160,248),'gL_t':(160,170),'gL_b':(160,325),
 'gR_c':(702,380),'gR_t':(702,300),'gR_b':(702,460),
 'grTL':(333,128),'grTR':(572,165),
 'bfTL':(278,378),'bfTR':(455,415),'bfBL':(280,530),'bfBR':(455,570),
 'bbTR':(545,395),'bbBR':(545,555),
}
F=0.05; GZ=0.14; GH=0.126
def pts(m):
    a,c,gx,gy1,fx,fy0,fy1,fz,bx,by0,by1 = m
    return {
     'gL_c':(-a,c,GZ),'gL_t':(-a,c+GH,GZ),'gL_b':(-a,c-GH,GZ),
     'gR_c':(a,c,GZ),'gR_t':(a,c+GH,GZ),'gR_b':(a,c-GH,GZ),
     'grTL':(-gx,gy1,F),'grTR':(gx,gy1,F),
     'bfTL':(-fx,fy1,fz),'bfTR':(fx,fy1,fz),'bfBL':(-fx,fy0,fz),'bfBR':(fx,fy0,fz),
     'bbTR':(bx,by1,F),'bbBR':(bx,by0,F),
    }
def proj(cam, P):
    px,py,pz,yaw,pitch,fov = cam
    pos=np.array([px,py,pz])
    f=np.array([-np.sin(yaw)*np.cos(pitch), -np.sin(pitch), -np.cos(yaw)*np.cos(pitch)])
    r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f)
    d=np.array(P)-pos
    x,y,z=d@r,d@u,d@f
    t=np.tan(np.radians(fov)/2)
    return (Wpx/2 + x/(z*t)*(Hpx/2), Hpx/2 - y/(z*t)*(Hpx/2))
def res(v):
    cam=v[:6]; m=v[6:]
    P=pts(m); out=[]
    for k,(ox,oy) in obs.items():
        X,Y=proj(cam,P[k]); out += [X-ox, Y-oy]
    return out
x0=[1.96,2.6,2.5,np.radians(40),np.radians(26),18, 0.55,1.11,0.25,1.43,0.19,0.71,1.05,0.28,0.21,0.69,1.07]
lo=[-10,-10,-10,0,0,5, 0.3,0.8,0.1,1.2,0.1,0.5,0.9,0.1,0.1,0.5,0.9]
hi=[10,10,10,1.5,1.2,60, 0.9,1.5,0.4,1.7,0.35,0.95,1.3,0.6,0.4,0.95,1.3]
r=least_squares(res,x0,bounds=(lo,hi))
v=r.x; cam=v[:6]
print('rms px', np.sqrt(np.mean(np.square(r.fun))))
print('cam pos', np.round(cam[:3],3), 'yaw', round(np.degrees(cam[3]),1),'pitch',round(np.degrees(cam[4]),1),'fov',round(cam[5],1))
names='a c gx gy1 fx fy0 fy1 fz bx by0 by1'.split()
for n,val in zip(names,v[6:]): print(n, round(val,3))
for k,(dx,dy) in zip(obs, np.array(r.fun).reshape(-1,2)): print(k, round(dx,1), round(dy,1))
yaw,pitch=cam[3],cam[4]
f=np.array([-np.sin(yaw)*np.cos(pitch), -np.sin(pitch), -np.cos(yaw)*np.cos(pitch)])
tgt=cam[:3]+f*3
print('CAM', ','.join(f'{x:.3f}' for x in list(cam[:3])+list(tgt)+[cam[5]]))

def unproj(cam, X, Y, plane):  # plane: ('z', val) or ('y', val) or ('x',val)
    px,py,pz,yaw,pitch,fov = cam
    pos=np.array([px,py,pz]); f=np.array([-np.sin(yaw)*np.cos(pitch), -np.sin(pitch), -np.cos(yaw)*np.cos(pitch)])
    r=np.cross(f,[0,1,0]); r/=np.linalg.norm(r); u=np.cross(r,f); t=np.tan(np.radians(fov)/2)
    dx=(X-Wpx/2)/(Hpx/2)*t; dy=-(Y-Hpx/2)/(Hpx/2)*t
    d=f+dx*r+dy*u
    ax={'x':0,'y':1,'z':2}[plane[0]]
    s=(plane[1]-pos[ax])/d[ax]
    return np.round(pos+s*d,3)
for name,X,Y,pl in [('panel L edge',125,450,('z',F)),('panel R edge',858,420,('z',F)),('panel top above grille',330,92,('z',F)),
   ('whisker L outer1',75,370,('z',F+0.1)),('whisker L outer2',75,445,('z',F+0.1)),('whisker L outer3',80,510,('z',F+0.1)),
   ('whisker L inner1',262,420,('z',F+0.06)),('whisker L inner3',262,515,('z',F+0.06)),
   ('lamp L outer left',88,250,('z',0.15)),('lampR outer right frame',795,395,('z',0.15)),('lampR top frame',702,265,('z',0.15)),('lampR bottom',702,520,('z',0.15)),
   ('visorR front left',590,355,('z',0.27)),('visorR top back',640,205,('z',F))]:
    print(name, unproj(cam,X,Y,pl))
