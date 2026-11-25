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

/**
 * 纸的种类（2026-11-22，用户："更像硬卡纸、木纹纸、大地纸"）。都是代码生成的可平铺贴图（法线、粗糙度、颜色斑驳）：
 * - card：硬卡纸。面细，有一点点齿，颜色很匀。地形、植物、大部分纸片用它。
 * - kraft：大地纸（牛皮纸一类）。纤维、深浅斑点看得见，颜色更花。沙滩、土、信封用它。
 * - wood：木纹纸。顺着一个方向的木纹。工作台、抽屉、相框用它。
 * - edge：纸的断面。和正面不是一回事：顺着边走的一道道细纹（压实的纤维），没有齿。
 */
export type PaperKind = 'card' | 'kraft' | 'wood' | 'edge';

interface Recipe {
  low: number;
  fine: number;
  fiber: number;
  fibers: number;
  tooth: number;
  toothCells: number;
  flecks: number;
  mottle: number;
  strength: number;
}

const RECIPES: Record<Exclude<PaperKind, 'wood' | 'edge'>, Recipe> = {
  card: { low: 0.3, fine: 0.25, fiber: 0.05, fibers: 700, tooth: 0.32, toothCells: 64, flecks: 220, mottle: 0.07, strength: 3.2 },
  kraft: { low: 0.4, fine: 0.25, fiber: 0.28, fibers: 2600, tooth: 0.22, toothCells: 56, flecks: 1600, mottle: 0.16, strength: 3.6 },
};

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
}

/** 高度图 + 颜色斑驳（0–1 附近）。 */
function paperFields(kind: PaperKind, N: number): { h: Float32Array; m: Float32Array; strength: number } {
  const h = new Float32Array(N * N);
  const m = new Float32Array(N * N);
  if (kind === 'wood') {
    // 木纹：沿 x 的年轮条带，被低频噪声扭弯；再加细的导管纹。
    const warp = tileNoise(N, 61, 3, 2);
    const warp2 = tileNoise(N, 67, 2, 8);
    const pores = tileNoise(N, 71, 2, 128);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const k = y * N + x;
        const t = (y / N) * 36 + warp[k]! * 1.1 + warp2[k]! * 0.35;
        const ring = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
        const late = Math.pow(ring, 4);
        h[k] = late * 0.35 + pores[k]! * 0.3;
        m[k] = 0.9 + 0.12 * (1 - late) - pores[k]! * 0.08 + warp2[k]! * 0.05;
      }
    return { h, m, strength: 2.2 };
  }
  if (kind === 'edge') {
    // 断面（2026-11-25 重做）：纹理的 v 正好横跨一张纸的厚度（0 → 1），u 顺着边走（以纸厚为单位）。
    // 看得见的东西：三层纸浆压在一起的分层线、两侧切口被压实的一道暗线、顺着边的短纤维、小斑点。
    const fibers = new Float32Array(N * N);
    const rnd = rng(9137);
    for (let f = 0; f < 5200; f++) {
      const x0 = rnd() * N;
      const y0 = rnd() * N;
      const len = 6 + rnd() * 40;
      const v = (rnd() - 0.5) * 0.5;
      for (let t = 0; t < len; t++) {
        const x = Math.floor(x0 + t) % N;
        const y = Math.floor(y0 + Math.sin((x0 + t) * 0.07) * 1.5 + N) % N;
        fibers[y * N + x] = fibers[y * N + x]! + v * (1 - Math.abs(t / len - 0.5) * 2);
      }
    }
    const speck = tileNoise(N, 97, 2, 96);
    const wav = tileNoise(N, 101, 2, 6);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const k = y * N + x;
        const v = y / (N - 1) + (wav[k]! - 0.5) * 0.04;
        const ply = Math.exp(-Math.pow((v - 0.34) / 0.018, 2)) + Math.exp(-Math.pow((v - 0.67) / 0.018, 2)) * 0.8;
        const rim = Math.exp(-v / 0.035) + Math.exp(-(1 - v) / 0.035);
        const sheen = Math.exp(-Math.pow((v - 0.07) / 0.03, 2)) + Math.exp(-Math.pow((v - 0.93) / 0.03, 2));
        h[k] = 0.6 - ply * 0.35 - rim * 0.5 + fibers[k]! * 0.6 + speck[k]! * 0.15;
        m[k] = 1.0 - ply * 0.1 - rim * 0.26 + sheen * 0.05 + fibers[k]! * 0.2 + (speck[k]! - 0.5) * 0.06;
      }
    return { h, m, strength: 2.6 };
  }
  const R = RECIPES[kind];
  const low = tileNoise(N, 7, 4, 4);
  const fine = tileNoise(N, 19, 3, 64);
  const tooth = tileNoise(N, 41, 2, R.toothCells);
  const fib = new Float32Array(N * N);
  const fibTone = new Float32Array(N * N);
  const rnd = rng(12345);
  for (let f = 0; f < R.fibers; f++) {
    let x = rnd() * N;
    let y = rnd() * N;
    let a = rnd() * Math.PI * 2;
    const len = 8 + rnd() * 36;
    const w = 0.25 + rnd() * 0.5;
    const tone = rnd() < 0.5 ? -1 : 1;
    for (let t = 0; t < len; t++) {
      a += (rnd() - 0.5) * 0.3;
      x += Math.cos(a);
      y += Math.sin(a);
      const k = (((Math.floor(y) % N) + N) % N) * N + (((Math.floor(x) % N) + N) % N);
      fib[k] = Math.min(1, fib[k]! + w);
      fibTone[k] = tone;
    }
  }
  const fleck = new Float32Array(N * N);
  for (let f = 0; f < R.flecks; f++) {
    const cx = rnd() * N;
    const cy = rnd() * N;
    const r = 0.5 + rnd() * rnd() * 2;
    const v = rnd() < 0.6 ? -(0.04 + rnd() * 0.08) : 0.03 + rnd() * 0.05;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const k = (((y % N) + N) % N) * N + (((x % N) + N) % N);
        fleck[k] = fleck[k]! + v * (1 - d / (r + 0.5));
      }
  }
  for (let k = 0; k < h.length; k++) {
    const t = tooth[k]!;
    h[k] = low[k]! * R.low + fine[k]! * R.fine + fib[k]! * R.fiber + t * t * R.tooth;
    m[k] = 1 - R.mottle + low[k]! * R.mottle * 1.6 + fib[k]! * fibTone[k]! * R.mottle * 0.5 + fleck[k]! * (R.mottle / 0.1);
  }
  return { h, m, strength: R.strength };
}

/** 纸纹贴图：法线、粗糙度、颜色斑驳。 */
function paperMaps(kind: PaperKind): { normal: Texture; rough: Texture; mottle: Texture } {
  const N = 512;
  const { h, m, strength } = paperFields(kind, N);
  const at = (x: number, y: number): number => h[((y + N) % N) * N + ((x + N) % N)]!;
  const mk = (): [HTMLCanvasElement, ImageData] => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    return [c, c.getContext('2d')!.createImageData(N, N)];
  };
  const [normal, nd] = mk();
  const [rough, rd] = mk();
  const [mottle, md] = mk();
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
      const r = Math.round((0.86 + at(x, y) * 0.12) * 255);
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = Math.min(255, r);
      rd.data[i + 3] = 255;
      const v = Math.max(0, Math.min(255, Math.round(m[y * N + x]! * 245)));
      md.data[i] = md.data[i + 1] = md.data[i + 2] = v;
      md.data[i + 3] = 255;
    }
  normal.getContext('2d')!.putImageData(nd, 0, 0);
  rough.getContext('2d')!.putImageData(rd, 0, 0);
  mottle.getContext('2d')!.putImageData(md, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean): Texture => {
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.colorSpace = srgb ? SRGBColorSpace : LinearSRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { normal: tex(normal, false), rough: tex(rough, false), mottle: tex(mottle, true) };
}

const mapsByKind = new Map<PaperKind, ReturnType<typeof paperMaps>>();
function mapsOf(kind: PaperKind): ReturnType<typeof paperMaps> {
  let m = mapsByKind.get(kind);
  if (!m) mapsByKind.set(kind, (m = paperMaps(kind)));
  return m;
}


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
  /** z 方向的大小（不写就和 size 一样）。 */
  sizeZ?: number;
}

export function paperMaterial(
  color: number | string,
  opts: { kind?: PaperKind; scale?: number; edge?: boolean; metal?: number; core?: number; emissive?: number; ao?: PaperAo; bump?: number; variant?: string; patch?: (sh: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void } = {},
): MeshStandardMaterial {
  // 断面的纹理坐标以纸厚为单位：一块纹理沿边铺 8 个纸厚，横跨正好一个纸厚。
  const scale = opts.edge ? 8 : (opts.scale ?? 0.35);
  const bump = opts.bump ?? 1;
  const kind: PaperKind = opts.edge ? 'edge' : (opts.kind ?? 'card');
  const key = `${kind}|${new Color(color).getHexString()}|${scale}|${opts.edge ? 1 : 0}|${opts.emissive ?? 0}|${opts.ao ? opts.ao.tex.id : ''}|${bump}|${opts.variant ?? ''}|${opts.metal ?? 0}|${opts.core ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const maps = mapsOf(kind);
  paperGlobals.uCloudTex.value ??= cloudTexture();
  const c = new Color(color);
  // 断面是纸芯的颜色：比正面浅一些（染透的彩纸），覆膜的金卡纸芯是白的（core 给更大的值）。
  if (opts.edge) c.lerp(new Color(0xf3ecdc), opts.core ?? 0.28);
  const m = new MeshStandardMaterial({
    side: DoubleSide,
    shadowSide: DoubleSide,
    // 墨线（ink）画在纸的边上：纸面往后让一点点，线才不会一半埋进纸里。
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    color: c,
    roughness: opts.metal ? 0.42 : 1,
    metalness: opts.metal ?? 0,
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
      .replace('void main() {', 'uniform float uPaperScale;\nvarying vec3 vPaperWorld;\nvarying vec3 vPaperLocal;\nvoid main() {');
    vs = vs.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n{ vec4 pw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\npw = instanceMatrix * pw;\n#endif\nvPaperLocal = pw.xyz;\nvPaperWorld = (modelMatrix * pw).xyz; }',
    );
    if (kind === 'edge') vs = vs.split('* uPaperScale;').join('* vec2(uPaperScale, 1.0);');
    sh.vertexShader = vs;
    let fs = sh.fragmentShader
      .replace('void main() {', 'varying vec3 vPaperWorld;\nvarying vec3 vPaperLocal;\nuniform sampler2D uAo;\nuniform vec4 uAoBox;\nuniform sampler2D uCloudTex;\nuniform vec2 uCloudOff;\nuniform float uCloudAmt;\nuniform float uCloudScale;\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - uCloudAmt * texture2D(uCloudTex, vPaperWorld.xz * uCloudScale + uCloudOff).r;')
      .replace(
        'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
        kind === 'edge' || kind === 'wood'
          ? 'vec4 sampledDiffuseColor = texture2D( map, vMapUv );'
          : 'vec4 sampledDiffuseColor = texture2D( map, vMapUv ) * (0.6 + 0.42 * texture2D( map, vMapUv * 0.231 + 0.37 ));',
      )
      .replace(
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
        'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;\nvec3 mapN2 = texture2D( normalMap, vNormalMapUv * 0.219 + 0.53 ).xyz * 2.0 - 1.0;\nmapN = vec3(mapN.xy + mapN2.xy * ' + (kind === 'edge' || kind === 'wood' ? '0.0' : '0.5') + ', mapN.z);',
      );
    if (ao) {
      sh.uniforms['uAo'] = { value: ao.tex };
      sh.uniforms['uAoBox'] = { value: [ao.x0, ao.z0, 1 / ao.size, 1 / (ao.sizeZ ?? ao.size)] };
      fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= texture2D(uAo, (vPaperLocal.xz - uAoBox.xy) * uAoBox.zw).r;');
    }
    sh.fragmentShader = fs;
    opts.patch?.(sh);
  };
  m.customProgramCacheKey = () => `paper${kind}${scale}|${ao ? ao.tex.id : ''}|${opts.variant ?? ''}`;
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
 * 一张纸（xy 平面里剪出形状，朝 +z 有 depth 厚）：正面一张三角化的面（可以有洞）+ 一圈断面（不要背面：贴着别的纸，看不到）。
 * 断面的纹理坐标顺着边走（u = 沿边的长度，v = 高度），所以断面上的细纹是顺着纸边的，不会像正面的纹理被竖着拉长。
 * 断面的法线在平缓的弯处取两边的平均（圆滑），在尖角处分开（剪刀剪出的角是尖的）。
 * 返回的几何有两组：0 正面、1 断面。
 */
export function sheetGeometry(shapes: Array<{ outer: ArrayLike<number>; holes?: ArrayLike<number>[] }>, depth: number, geom?: BufferGeometry): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const side: Array<{ pts: Vector2[] }> = [];
  for (const sh of shapes) {
    const outer = toVecs(sh.outer);
    if (outer.length < 3) continue;
    if (ShapeUtils.isClockWise(outer)) outer.reverse();
    const holes = (sh.holes ?? []).map(toVecs).filter((h) => h.length >= 3);
    for (const h of holes) if (!ShapeUtils.isClockWise(h)) h.reverse();
    const all = [...outer, ...holes.flat()];
    for (const t of ShapeUtils.triangulateShape(outer, holes))
      for (const k of t) {
        const p = all[k]!;
        pos.push(p.x, p.y, depth);
        nor.push(0, 0, 1);
        uv.push(p.x, p.y);
      }
    side.push({ pts: outer }, ...holes.map((pts) => ({ pts })));
  }
  const faceCount = pos.length / 3;
  for (const { pts } of side) {
    const n = pts.length;
    const segN: Vector2[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      const e = new Vector2(b.x - a.x, b.y - a.y);
      const l = e.length() || 1;
      segN.push(new Vector2(e.y / l, -e.x / l));
    }
    // 每个顶点在两条边之间：弯得缓就用平均的法线。
    const vn = (i: number, seg: number): Vector2 => {
      const prev = segN[(i + n - 1) % n]!;
      const next = segN[i % n]!;
      if (prev.dot(next) < 0.64) return segN[seg]!;
      return prev.clone().add(next).normalize();
    };
    let arc = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = pts[i]!;
      const b = pts[j]!;
      const len = a.distanceTo(b);
      const na = vn(i, i);
      const nb = vn(j, i);
      const u0 = arc;
      const u1 = arc + len;
      arc = u1;
      const quad: Array<[Vector2, number, Vector2, number]> = [
        [a, 0, na, u0],
        [b, 0, nb, u1],
        [b, depth, nb, u1],
        [a, 0, na, u0],
        [b, depth, nb, u1],
        [a, depth, na, u0],
      ];
      for (const [p, z, nn, u] of quad) {
        pos.push(p.x, p.y, z);
        nor.push(nn.x, nn.y, 0);
        uv.push(u / depth, z / depth);
      }
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

function toVecs(points: ArrayLike<number>): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const p = new Vector2(points[i]!, points[i + 1]!);
    const last = out[out.length - 1];
    if (!last || last.distanceToSquared(p) > 1e-12) out.push(p);
  }
  if (out.length > 1 && out[0]!.distanceToSquared(out[out.length - 1]!) < 1e-12) out.pop();
  return out;
}

/** 一片没有洞的薄纸（纸偶零件、植物）。 */
export function thinPiece(points: ArrayLike<number>, depth: number, geom?: BufferGeometry): BufferGeometry {
  return sheetGeometry([{ outer: points }], depth, geom);
}

/**
 * 印了图案的纸（2026-11-26）：纸模型的细节大半是"印"上去的——板缝、百叶、木纹、格子布、窗帘、阴影。
 * print 是一张铺满整个面的图（纹理坐标 0–1，几何要用 fitUv 生成），纸纹（法线、粗糙度）照样按 repeat 平铺在上面。
 */
export function printedPaper(print: Texture, repeat: number, kind: PaperKind = 'card', metal = 0): MeshStandardMaterial {
  const maps = mapsOf(kind);
  const nrm = maps.normal.clone();
  nrm.repeat.set(repeat, repeat * 0.7);
  nrm.needsUpdate = true;
  const rough = maps.rough.clone();
  rough.repeat.copy(nrm.repeat);
  rough.needsUpdate = true;
  return new MeshStandardMaterial({
    map: print,
    normalMap: nrm,
    normalScale: new Vector2(0.8, 0.8),
    roughnessMap: rough,
    roughness: metal ? 0.45 : 1,
    metalness: metal,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}
