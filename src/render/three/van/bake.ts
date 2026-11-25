import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 把一组里不会动的零件按材质合成几个大网格（2026-11-25）：「勾勾」有上千块纸片和铜条，
 * 一块一次绘制、再乘上两盏灯的阴影，iPad 吃不消。合完以后外观一样，绘制次数降到几十次。
 * userData.noBake 的子树不动（会动的眼皮、门、篷子……），它们自己可以另外再合。
 */
export function bake(group: Object3D): void {
  group.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map<Material, { geos: BufferGeometry[]; cast: boolean }>();
  const victims: Mesh[] = [];
  const visit = (o: Object3D): void => {
    if (o !== group && o.userData['noBake']) return;
    if ((o as Mesh).isMesh && !(o as { isInstancedMesh?: boolean }).isInstancedMesh) {
      const m = o as Mesh;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some((x) => x.transparent)) return;
      let g = m.geometry;
      g = g.index ? g.toNonIndexed() : g.clone();
      if (!g.getAttribute('uv') || !g.getAttribute('normal')) return;
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const M = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(M);
      if (M.determinant() < 0) flip(g);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: g.getAttribute('position').count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = mats[gr.materialIndex ?? 0] ?? mats[0]!;
        const sub = slice(g, gr.start, gr.count);
        let b = buckets.get(mat);
        if (!b) buckets.set(mat, (b = { geos: [], cast: false }));
        b.geos.push(sub);
        b.cast ||= m.castShadow;
      }
      victims.push(m);
    }
    for (const c of [...o.children]) visit(c);
  };
  visit(group);
  for (const v of victims) {
    v.removeFromParent();
  }
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    mesh.name = 'baked';
    group.add(mesh);
  }
}

function slice(g: BufferGeometry, start: number, count: number): BufferGeometry {
  const out = new BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(k);
    const n = a.itemSize;
    out.setAttribute(k, new BufferAttribute((a.array as Float32Array).slice(start * n, (start + count) * n), n));
  }
  return out;
}

/** 镜像过的零件：三角形的绕向反了，换回来。 */
function flip(g: BufferGeometry): void {
  for (const k of ['position', 'normal', 'uv']) {
    const a = g.getAttribute(k);
    const arr = a.array as Float32Array;
    const n = a.itemSize;
    for (let t = 0; t < a.count; t += 3)
      for (let j = 0; j < n; j++) {
        const i1 = (t + 1) * n + j;
        const i2 = (t + 2) * n + j;
        const tmp = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = tmp;
      }
  }
}
