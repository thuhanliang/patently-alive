# 从设计图里自动提取轮毂（浅灰白的正八边形环）的外轮廓：阈值 → 最大连通块 → 凸包 → 简化成 8 个顶点。
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull
im=np.array(Image.open('/home/user/patently-alive/art/incoming/lovart/010/5-details/6-overall.jpg').convert('RGB')).astype(float)
X0,Y0,X1,Y1=775,848,885,985
sub=im[Y0:Y1,X0:X1]
R,G,B=sub[...,0],sub[...,1],sub[...,2]
lum=(R+G+B)/3
mask=(R>175)&(G>135)&(B>105)&((R-B)>40)&((R-B)<100)   # 轮毂环是暖米灰（约 200,160,125）；金色 B<100，深色轮胎很暗
lab,n=ndi.label(mask)
sizes=ndi.sum(mask,lab,range(1,n+1))
k=1+int(np.argmax(sizes)); m=lab==k
m=ndi.binary_closing(m,iterations=2)
ys,xs=np.nonzero(m)
pts=np.c_[xs+X0,ys+Y0].astype(float)
hull=ConvexHull(pts); H=pts[hull.vertices]
def simplify(P,n):
    P=[tuple(p) for p in P]
    while len(P)>n:
        best=None
        for i in range(len(P)):
            a,b,c=np.array(P[i-1]),np.array(P[i]),np.array(P[(i+1)%len(P)])
            area=abs((b-a)[0]*(c-a)[1]-(b-a)[1]*(c-a)[0])/2
            if best is None or area<best[0]: best=(area,i)
        P.pop(best[1])
    return np.array(P)
V=simplify(H,8)
# 按角度排序
c=V.mean(0); order=np.argsort(np.arctan2(V[:,1]-c[1],V[:,0]-c[0])); V=V[order]
print('mask px',int(m.sum()),'size',pts[:,0].min(),pts[:,0].max(),pts[:,1].min(),pts[:,1].max())
print('octagon vertices (overall px):'); print(np.round(V,1).tolist())
np.save('hub_vertices.npy',V)
# 可视化
from PIL import ImageDraw
img=Image.open('/home/user/patently-alive/art/incoming/lovart/010/5-details/6-overall.jpg').convert('RGB').crop((X0-40,Y0-40,X1+40,Y1+20)); k4=4
img=img.resize((img.width*k4,img.height*k4),Image.LANCZOS); d=ImageDraw.Draw(img)
for i in range(8):
    a=V[i]; b=V[(i+1)%8]
    d.line([((a[0]-X0+40)*k4,(a[1]-Y0+40)*k4),((b[0]-X0+40)*k4,(b[1]-Y0+40)*k4)],fill=(255,0,0),width=3)
img.save('hub_vis.png')
