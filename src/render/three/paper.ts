import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
  ShapeUtils,
  Vector2,
  type Texture,
} from 'three';

/**
 * 3D 剪纸的材料（2026-11-22，handoff/009 的新渲染架构）：
 * 每一张纸都是真的薄片——正面、背面、一圈侧边（纸的断面，比正面白一点）——由灯光照亮、互相投影。
 * 纸的纤维是代码生成的一张可平铺的高度图，转成法线和粗糙度贴图，所有纸共用，只换颜色。
 * 不用 Lovart 的图片当纸面：颜色、形状、厚度、光影都由代码定，所以能自由地动、换季、换色。
 */

/** 0–1 的可平铺噪声（值噪声叠几层），size 必须是 2 的幂。 */
function tileNoise(size: number, seed: number, octaves: number, base: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o;
    const grid = new Float32Array(cells * cells);
    let s = (seed * 9301 + o * 49297) >>> 0;
    for (let i = 0; i < grid.length; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      grid[i] = s / 0x1_0000_0000;
    }
    const k = cells / size;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const gx = x * k;
        const gy = y * k;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const tx = gx - x0;
        const ty = gy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const g = (a: number, b: number): number => grid[((b % cells) * cells + (a % cells)) % grid.length]!;
        const v = (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
        out[y * size + x] = out[y * size + x]! + v * amp;
      }
    total += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return out;
}

/** 纸纹：一张高度图（低频的起伏 + 细的纤维），转成法线贴图、粗糙度贴图、颜色上的一点斑驳。 */
function paperMaps(): { normal: Texture; rough: Texture; mottle: Texture } {
  const N = 512;
  const low = tileNoise(N, 7, 4, 4);
  const fine = tileNoise(N, 19, 3, 64);
  // 纤维：沿一个方向拉长的细线（几百条随机的短弧）。
  const fib = new Float32Array(N * N);
  let s = 12345;
  const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
  for (let f = 0; f < 1400; f++) {
    let x = rnd() * N;
    let y = rnd() * N;
    let a = rnd() * Math.PI * 2;
    const len = 10 + rnd() * 40;
    const w = 0.25 + rnd() * 0.5;
    for (let t = 0; t < len; t++) {
      a += (rnd() - 0.5) * 0.3;
      x += Math.cos(a);
      y += Math.sin(a);
      const i = ((Math.floor(y) % N) + N) % N;
      const j = ((Math.floor(x) % N) + N) % N;
      fib[i * N + j] = Math.min(1, fib[i * N + j]! + w);
    }
  }
  const h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) h[i] = low[i]! * 0.55 + fine[i]! * 0.3 + fib[i]! * 0.35;
  const at = (x: number, y: number): number => h[(((y + N) % N) * N + ((x + N) % N))]!;
  const normal = document.createElement('canvas');
  normal.width = normal.height = N;
  const rough = document.createElement('canvas');
  rough.width = rough.height = N;
  const mottle = document.createElement('canvas');
  mottle.width = mottle.height = N;
  const nd = normal.getContext('2d')!.createImageData(N, N);
  const rd = rough.getContext('2d')!.createImageData(N, N);
  const md = mottle.getContext('2d')!.createImageData(N, N);
  const strength = 3.2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      nd.data[i] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      nd.data[i + 1] = Math.round(((dy / l) * 0.5 + 0.5) * 255);
      nd.data[i + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      nd.data[i + 3] = 255;
      const r = Math.round((0.78 + fine[y * N + x]! * 0.2) * 255);
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = r;
      rd.data[i + 3] = 255;
      // 斑驳：颜色乘上去，0.9–1.04 之间，纤维处略亮。
      const m = Math.round((0.9 + low[y * N + x]! * 0.1 + fib[y * N + x]! * 0.05) * 245);
      md.data[i] = md.data[i + 1] = md.data[i + 2] = Math.min(255, m);
      md.data[i + 3] = 255;
    }
  normal.getContext('2d')!.putImageData(nd, 0, 0);
  rough.getContext('2d')!.putImageData(rd, 0, 0);
  mottle.getContext('2d')!.putImageData(md, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean): Texture => {
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { normal: tex(normal, false), rough: tex(rough, false), mottle: tex(mottle, true) };
}

let maps: ReturnType<typeof paperMaps> | null = null;
const cache = new Map<string, MeshStandardMaterial>();

/**
 * 一种颜色的纸。scale 是纸纹的疏密（世界单位里一块纹理多大：米）；edge 为真是纸的断面（白一点、更粗糙）。
 * 同样的参数共用一个材质。
 */
export function paperMaterial(color: number | string, opts: { scale?: number; edge?: boolean; emissive?: number } = {}): MeshStandardMaterial {
  const scale = opts.scale ?? 0.35;
  const key = `${new Color(color).getHexString()}|${scale}|${opts.edge ? 1 : 0}|${opts.emissive ?? 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  maps ??= paperMaps();
  const c = new Color(color);
  if (opts.edge) c.lerp(new Color(0xf7f0e2), 0.55);
  const m = new MeshStandardMaterial({
    side: DoubleSide,
    shadowSide: DoubleSide,
    color: c,
    roughness: opts.edge ? 1 : 0.92,
    metalness: 0,
    map: maps.mottle,
    normalMap: maps.normal,
    normalScale: new Vector2(0.55, 0.55),
    roughnessMap: maps.rough,
    ...(opts.emissive ? { emissive: new Color(opts.emissive), emissiveIntensity: 0.6 } : {}),
  });
  // 纹理坐标按世界尺寸铺（ExtrudeGeometry 的 uv 是形状的坐标）。
  m.onBeforeCompile = (sh) => {
    sh.uniforms['uPaperScale'] = { value: 1 / scale };
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * uPaperScale;\n#endif\n#ifdef USE_NORMALMAP\nvNormalMapUv = vNormalMapUv * uPaperScale;\n#endif\n#ifdef USE_ROUGHNESSMAP\nvRoughnessMapUv = vRoughnessMapUv * uPaperScale;\n#endif').replace('void main() {', 'uniform float uPaperScale;\nvoid main() {');
  };
  m.customProgramCacheKey = () => `paper${scale}`;
  cache.set(key, m);
  return m;
}

/** 黄铜（铆钉、台口的包角）。 */
export const brass = new MeshStandardMaterial({ color: 0xc9973f, metalness: 0.85, roughness: 0.32 });

/**
 * 一张纸片：shape 挤出 depth 厚，正面背面用 face 的纸，侧边用同一种纸的断面（白一点）。
 * 不加倒角（纸的边是直的），但断面看得见。
 */
export function slab(shape: Shape, depth: number, color: number | string, scale = 0.35): { geometry: ExtrudeGeometry; materials: MeshStandardMaterial[] } {
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  return { geometry, materials: [paperMaterial(color, { scale }), paperMaterial(color, { scale, edge: true })] };
}

/** 一串点（x0, y0, x1, y1……）连成形状。 */
export function shapeOf(points: ArrayLike<number>, holes: ArrayLike<number>[] = []): Shape {
  const s = new Shape();
  s.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) s.lineTo(points[i]!, points[i + 1]!);
  s.closePath();
  for (const h of holes) {
    const p = new Shape();
    p.moveTo(h[0]!, h[1]!);
    for (let i = 2; i < h.length; i += 2) p.lineTo(h[i]!, h[i + 1]!);
    s.holes.push(p);
  }
  return s;
}

/**
 * 一片薄纸的快速几何：正面一张三角化的面 + 一圈侧边（不要背面：纸偶贴着别的纸，看不到背面）。
 * 纸偶的零件每次变形都要重建，用 ExtrudeGeometry 太慢，这里自己拼：正面的三角形交给 ShapeUtils，侧边是一圈四边形。
 * 返回的几何有两组：0 正面、1 侧边。
 */
export function thinPiece(points: ArrayLike<number>, depth: number, geom?: BufferGeometry): BufferGeometry {
  const n = points.length / 2;
  const contour: Vector2[] = [];
  for (let i = 0; i < n; i++) contour.push(new Vector2(points[i * 2]!, points[i * 2 + 1]!));
  // 正面朝 +z；ShapeUtils 要求逆时针。
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  if (area < 0) contour.reverse();
  const tris = triangulate(contour);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const t of tris)
    for (const k of t) {
      const p = contour[k]!;
      pos.push(p.x, p.y, depth);
      nor.push(0, 0, 1);
      uv.push(p.x, p.y);
    }
  const faceCount = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const a = contour[i]!;
    const b = contour[(i + 1) % n]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l = Math.hypot(ex, ey) || 1;
    const nx = ey / l;
    const ny = -ex / l;
    const quad: [number, number, number][] = [
      [a.x, a.y, 0],
      [b.x, b.y, 0],
      [b.x, b.y, depth],
      [a.x, a.y, 0],
      [b.x, b.y, depth],
      [a.x, a.y, depth],
    ];
    for (const q of quad) {
      pos.push(...q);
      nor.push(nx, ny, 0);
      uv.push(q[0] + q[2], q[1]);
    }
  }
  const g = geom ?? new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.clearGroups();
  g.addGroup(0, faceCount, 0);
  g.addGroup(faceCount, pos.length / 3 - faceCount, 1);
  g.computeBoundingSphere();
  return g;
}

/** 三角化（three 自带的 earcut，快）。 */
function triangulate(pts: Vector2[]): [number, number, number][] {
  return ShapeUtils.triangulateShape(pts, []) as [number, number, number][];
}
