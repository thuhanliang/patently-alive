# 灭点法：自动检测图里的直线 → 按方向分成三族（车宽 x、车长 z、竖直 y）→ 每族求灭点 → 由正交灭点标定镜头。
import numpy as np, cv2
img=cv2.imread('/home/user/patently-alive/art/incoming/lovart/010/5-details/6-overall.jpg')
H,W=img.shape[:2]; print('图',W,H)
g=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
lsd=cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
lines=lsd.detect(g)[0]
# 只要车身区域（排除草、地面、背景）：设计图里车身大致在 x∈[200,1900], y∈[120,1000]
sel=[]
for x1,y1,x2,y2 in lines:
    L=np.hypot(x2-x1,y2-y1)
    if L<28: continue
    cx,cy=(x1+x2)/2,(y1+y2)/2
    if not (150<cx<1500 and 150<cy<1080): continue
    sel.append((x1,y1,x2,y2,L))
sel=np.array(sel); print('候选线段',len(sel))
ang=np.degrees(np.arctan2(sel[:,3]-sel[:,1],sel[:,2]-sel[:,0]))%180   # 0..180，图像坐标 y 向下
np.save('segs.npy',np.c_[sel,ang])
# 三族：竖直（接近 90°）、x 轴族（图像中往右下，约 10–25° 即屏幕向下斜；在 y 向下的坐标里角度为正约 10–30°）、z 轴族（往右上，约 150–175°）
fam={'y':(75,105),'x':(5,35),'z':(145,178)}
res={}
def vp_of(S):
    # 最小二乘求交点：每条线 a x + b y = c，权重=长度
    A=[];B=[];Wt=[]
    for x1,y1,x2,y2,L,a in S:
        n=np.array([y2-y1,-(x2-x1)]); n/=np.linalg.norm(n); A.append(n); B.append(n@np.array([x1,y1])); Wt.append(L)
    A=np.array(A);B=np.array(B);Wt=np.sqrt(np.array(Wt))
    # RANSAC 去掉离群线
    best=None;rng=np.random.default_rng(0)
    for _ in range(600):
        i,j=rng.choice(len(A),2,replace=False)
        M=A[[i,j]]
        if abs(np.linalg.det(M))<1e-3: continue
        p=np.linalg.solve(M,B[[i,j]])
        # 点到每条线的距离，但对灭点远的情况用角度残差：线方向与指向灭点方向的夹角
        d=[]
        for x1,y1,x2,y2,L,a in S:
            mx,my=(x1+x2)/2,(y1+y2)/2
            v=p-np.array([mx,my]); dl=np.array([x2-x1,y2-y1])
            c=abs(v@dl)/(np.linalg.norm(v)*np.linalg.norm(dl)+1e-9); d.append(np.degrees(np.arccos(min(1,c))))
        d=np.array(d); inl=d<2.0
        sc=Wt[inl].sum()
        if best is None or sc>best[0]: best=(sc,p,inl)
    sc,p,inl=best
    M=A[inl]*Wt[inl][:,None]; b=B[inl]*Wt[inl]
    p=np.linalg.lstsq(M,b,rcond=None)[0]
    return p,inl
for k,(lo,hi) in fam.items():
    m=(sel_ang:=ang)>=lo; m&=(ang<=hi)
    S=np.c_[sel[m],ang[m]]
    p,inl=vp_of(S)
    res[k]=(p,S,inl); print(k,'族线段',len(S),'内点',int(inl.sum()),'灭点',np.round(p,0))
np.save('vp.npy',np.array([res[k][0] for k in ('x','y','z')]))
