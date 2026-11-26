# glb → dae（SketchUp 直接导入，File → Import → COLLADA）：保留部件层级和名字，每个部件是一个组件；保留颜色（不带纸纹贴图）
import sys, numpy as np, trimesh, collada
from collada import material, source, geometry, scene as csc
src, out = sys.argv[1], sys.argv[2]
sc = trimesh.load(src, force='scene', process=False)
mesh = collada.Collada()
mats = {}
def mat_for(col):
    key = tuple(int(c) for c in col[:3])
    if key not in mats:
        i = len(mats)
        eff = material.Effect(f'e{i}', [], 'lambert', diffuse=tuple(c / 255 for c in key) + (1.0,), double_sided=True)
        m = material.Material(f'm{i}', f'c{key[0]:02x}{key[1]:02x}{key[2]:02x}', eff)
        mesh.effects.append(eff); mesh.materials.append(m); mats[key] = m
    return mats[key]
def color_of(g):
    v = g.visual
    try:
        bc = v.material.baseColorFactor
        if bc is not None: return [int(c) if c > 1 else int(c * 255) for c in bc]
    except Exception: pass
    try:
        mc = v.material.main_color
        if mc is not None: return list(mc)
    except Exception: pass
    try: return list(v.face_colors[0])
    except Exception: return [200, 190, 170]
G = sc.graph
edges = G.transforms.edge_data
children = {}
for (a, b), d in edges.items():
    children.setdefault(a, []).append(b)
gid = [0]
used = set()
def safe(n):
    n = str(n)
    base = n; k = 1
    while n in used: n = f'{base}_{k}'; k += 1
    used.add(n); return n
def build(name):
    d = None
    node_children = []
    for ch in children.get(name, []):
        node_children.append(build(ch))
    # 这个节点自己的几何
    gname = None
    for (a, b), dd in edges.items():
        if b == name:
            gname = dd.get('geometry'); M = dd.get('matrix', np.eye(4)); break
    else:
        M = np.eye(4)
    if gname is not None and gname in sc.geometry:
        g = sc.geometry[gname]
        k = gid[0]; gid[0] += 1
        verts = np.asarray(g.vertices, dtype=np.float32)
        norms = np.asarray(g.vertex_normals, dtype=np.float32)
        vs = source.FloatSource(f'v{k}', verts.flatten(), ('X', 'Y', 'Z'))
        ns = source.FloatSource(f'n{k}', norms.flatten(), ('X', 'Y', 'Z'))
        geom = geometry.Geometry(mesh, f'g{k}', str(name), [vs, ns])
        il = source.InputList(); il.addInput(0, 'VERTEX', f'#v{k}'); il.addInput(0, 'NORMAL', f'#n{k}')
        geom.primitives.append(geom.createTriangleSet(np.asarray(g.faces, dtype=np.int32).flatten(), il, 'mat'))
        mesh.geometries.append(geom)
        node_children.append(csc.GeometryNode(geom, [csc.MaterialNode('mat', mat_for(color_of(g)), inputs=[])]))
    return csc.Node(safe(name), children=node_children, transforms=[csc.MatrixTransform(np.asarray(M, dtype=np.float32).flatten())])
root = build(G.base_frame)
s = csc.Scene('scene', [root]); mesh.scenes.append(s); mesh.scene = s
mesh.assetInfo.upaxis = collada.asset.UP_AXIS.Y_UP
mesh.assetInfo.unitmeter = 1.0; mesh.assetInfo.unitname = 'meter'
mesh.write(out)
print('wrote', out, gid[0], 'meshes', len(mats), 'colors')
