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
  // 纸浆里的小斑点（手工纸的样子）：几百个亮的、暗的小点，只进颜色。
  const fleck = new Float32Array(N * N);
  for (let f = 0; f < 900; f++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const r = 0.6 + rnd() * rnd() * 2.2;
    const v = rnd() < 0.55 ? -(0.05 + rnd() * 0.08) : 0.04 + rnd() * 0.05;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const k = ((((y % N) + N) % N) * N + (((x % N) + N) % N)) | 0;
        fleck[k] = fleck[k]! + v * (1 - d / (r + 0.5));
      }
  }
  // 纸的"齿"：冷压水彩纸那种一粒一粒的小凸起，斜光一照就看得见。
  const tooth = tileNoise(N, 41, 2, 48);
  const h = new Float32Array(N * N);
  for (let i = 0; i < h.length; i++) {
    const t = tooth[i]!;
    h[i] = low[i]! * 0.4 + fine[i]! * 0.25 + fib[i]! * 0.14 + t * t * 0.6;
  }
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
  const strength = 4.2;
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
      const m = Math.round((0.88 + low[y * N + x]! * 0.13 + fib[y * N + x]! * 0.05 + fleck[y * N + x]!) * 245);
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

/**
 * 所有纸共用的"天光"：飘过的云在纸上投下的柔和暗斑（一张可平铺的软噪声，按世界 x、z 铺，随时间挪）。
 * uCloudAmt 为 0 时没有（纸剧场里不用）。
 */
export const paperGlobals = {
  uCloudTex: { value: null as Texture | null },
  uCloudOff: { value: new Vector2(0, 0) },
  uCloudAmt: { value: 0 },
  uCloudScale: { value: 1 / 60 },
};

function cloudTexture(): Texture {
  const N = 256;
  const v = tileNoise(N, 23, 4, 3);
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  for (let i = 0; i < v.length; i++) {
    const t = Math.min(1, Math.max(0, (v[i]! - 0.5) / 0.16));
    const k = t * t * (3 - 2 * t);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.round(k * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = LinearSRGBColorSpace;
  return t;
}
const cache = new Map<string, MeshStandardMaterial>();

/**
 * 一种颜色的纸。scale 是纸纹的疏密（世界单位里一块纹理多大：米）；edge 为真是纸的断面（白一点、更粗糙）。
 * 同样的参数共用一个材质。
 */
export interface PaperAo {
  /** 一张灰度图：铺在地面上（世界的 x、z），颜色乘上它（层与层接缝处的暗、整张纸上的斑驳）。 */
  tex: Texture;
  x0: number;
  z0: number;
  size: number;
}

export function paperMaterial(
  color: number | string,
  opts: { scale?: number; edge?: boolean; emissive?: number; ao?: PaperAo; bump?: number; variant?: string; patch?: (sh: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void } = {},
): MeshStandardMaterial {
  const scale = opts.scale ?? 0.35;
  const bump = opts.bump ?? 1;
  const key = `${new Color(color).getHexString()}|${scale}|${opts.edge ? 1 : 0}|${opts.emissive ?? 0}|${opts.ao ? opts.ao.tex.id : ''}|${bump}|${opts.variant ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  maps ??= paperMaps();
  paperGlobals.uCloudTex.value ??= cloudTexture();
  const c = new Color(color);
  if (opts.edge) c.lerp(new Color(0xf7f0e2), 0.22);
  const m = new MeshStandardMaterial({
    side: DoubleSide,
    shadowSide: DoubleSide,
    color: c,
    roughness: 1,
    metalness: 0,
    map: maps.mottle,
    normalMap: maps.normal,
    normalScale: new Vector2(0.9 * bump, 0.9 * bump),
    roughnessMap: maps.rough,
    ...(opts.emissive ? { emissive: new Color(opts.emissive), emissiveIntensity: 0.6 } : {}),
  });
  // 纹理坐标按世界尺寸铺（ExtrudeGeometry 的 uv 是形状的坐标）。
  // 纸纹取两种尺度叠起来（细的纤维 + 大一号的纸浆起伏），远看近看都不是光滑的塑料。
  const ao = opts.ao;
  m.onBeforeCompile = (sh) => {
    sh.uniforms['uPaperScale'] = { value: 1 / scale };
    Object.assign(sh.uniforms, paperGlobals);
    let vs = sh.vertexShader
      .replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv * uPaperScale;\n#endif\n#ifdef USE_NORMALMAP\nvNormalMapUv = vNormalMapUv * uPaperScale;\n#endif\n#ifdef USE_ROUGHNESSMAP\nvRoughnessMapUv = vRoughnessMapUv * uPaperScale;\n#endif',
      )
      .replace('void main() {', 'uniform float uPaperScale;\nvarying vec3 vPaperWorld;\nvoid main() {');
    vs = vs.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n{ vec4 pw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\npw = instanceMatrix * pw;\n#endif\nvPaperWorld = (modelMatrix * pw).xyz; }',
    );
    sh.vertexShader = vs;
    let fs = sh.fragmentShader
      .replace('void main() {', 'varying vec3 vPaperWorld;\nuniform sampler2D uAo;\nuniform vec4 uAoBox;\nuniform sampler2D uCloudTex;\nuniform vec2 uCloudOff;\nuniform float uCloudAmt;\nuniform float uCloudScale;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - uCloudAmt * texture2D(uCloudTex, vPaperWorld.xz * uCloudScale + uCloudOff).r;')
      .replace(
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv ) * (0.55 + 0.5 * texture2D( map, vMapUv * 0.231 + 0.37 ));',
      )
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\nvec3 mapN2 = texture2D( normalMap, vNormalMapUv * 0.219 + 0.53 ).xyz * 2.0 - 1.0;\nmapN = vec3(mapN.xy + mapN2.xy * 0.75, mapN.z);',
      );
    if (ao) {
      sh.uniforms['uAo'] = { value: ao.tex };
      sh.uniforms['uAoBox'] = { value: [ao.x0, ao.z0, 1 / ao.size, 0] };
      fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(uAo, (vPaperWorld.xz - uAoBox.xy) * uAoBox.z).r;');
    }
    sh.fragmentShader = fs;
    opts.patch?.(sh);
  };
  m.customProgramCacheKey = () => `paper${scale}|${ao ? ao.tex.id : ''}|${opts.variant ?? ''}`;
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
