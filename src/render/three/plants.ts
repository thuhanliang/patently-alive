import { BufferGeometry, Color, InstancedMesh, Matrix4, MeshDepthMaterial, RGBADepthPacking, ShaderChunk, Vector3, type Material } from 'three';
import { paperMaterial } from './paper';
import { thinPiece } from './paper';

/**
 * 立着的剪纸植物（2026-11-22）：灌丛、草丛都是一张张有厚度的剪纸，立在纸雕地形上、正对镜头（美术规定）。
 * 镜头抬高往下看时，纸片跟着往后仰，从上面看也不会只剩一条线。
 * 全部是实例化网格：一种形状一次画完，几千丛也只是几次绘制。
 */

/** 所有立着的植物共用：镜头的位置、仰的角度、时间（风）。 */
export const plantUniforms = {
  uCam: { value: new Vector3(0, 10, 10) },
  uLean: { value: 0.5 },
  uTime: { value: 0 },
};

const BILLBOARD = /* glsl */ `
uniform vec3 uCam;
uniform float uLean;
uniform float uTime;
uniform float uSway;
`;

/**
 * 顶点着色器：把纸片绕自己的脚转到正对镜头、往后仰，再按风摆一摆（越高摆得越多）。
 * 算出世界坐标后反解回实例的局部坐标，后面的投影、阴影、雾都照常。
 */
const BILLBOARD_BEGIN = /* glsl */ `
vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
{
  mat4 mi = modelMatrix * instanceMatrix;
  vec3 io = (mi * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 p = vec3(position.x * length(mi[0].xyz) * sign(instanceMatrix[0][0]), position.y * length(mi[1].xyz), position.z * length(mi[2].xyz));
  float sway = sin(uTime * 1.6 + io.x * 0.73 + io.z * 1.31) * 0.6 + sin(uTime * 2.7 + io.x * 1.9) * 0.4;
  p.x += sway * uSway * position.y * position.y * length(mi[1].xyz);
  float a = -uLean;
  p = vec3(p.x, p.y * cos(a) - p.z * sin(a), p.y * sin(a) + p.z * cos(a));
  vec3 d = uCam - io;
  float yaw = atan(d.x, d.z);
  float c = cos(yaw), s = sin(yaw);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  transformed = (inverse(mi) * vec4(io + p, 1.0)).xyz;
}
#endif
`;

const BILLBOARD_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( normal );
#ifdef USE_INSTANCING
{
  mat4 mi = modelMatrix * instanceMatrix;
  vec3 io = (mi * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 d = normalize(uCam - io);
  vec3 wn = normalize(vec3(d.x, d.y * 0.6 + 0.5, d.z));
  objectNormal = normalize(transpose(mat3(mi)) * wn);
}
#endif
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

/** 一种立着的植物的材质（正面、断面），白色打底，颜色走实例色。 */
function plantMaterials(sway: number, scale: number): Material[] {
  const patch = (sh: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }): void => {
    // 镜像的纸片（实例缩放取负）绕向反了，会被当成背面而把法线翻过去、整片发黑：植物一律当正面。
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'),
    );
    Object.assign(sh.uniforms, plantUniforms, { uSway: { value: sway } });
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', `${BILLBOARD}\nvoid main() {`)
      .replace('#include <begin_vertex>', BILLBOARD_BEGIN)
      .replace('#include <beginnormal_vertex>', BILLBOARD_NORMAL);
  };
  const variant = `plant${sway}`;
  return [paperMaterial(0xffffff, { scale, variant, patch }), paperMaterial(0xffffff, { scale, edge: true, variant, patch })];
}

function depthMaterial(sway: number): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, plantUniforms, { uSway: { value: sway } });
    sh.vertexShader = sh.vertexShader.replace('void main() {', `${BILLBOARD}\nvoid main() {`).replace('#include <begin_vertex>', BILLBOARD_BEGIN);
  };
  m.customProgramCacheKey = () => `plantdepth${sway}`;
  return m;
}

/** 一丛灌木的剪影：上半是一圈圆鼓鼓的叶团，底边平。宽 1、高约 0.9，脚在原点。 */
export function bushOutline(seed: number): number[] {
  const pts: number[] = [];
  const lobes = 5 + (seed % 3);
  const ph = seed * 1.7;
  const N = 72;
  for (let i = 0; i <= N; i++) {
    const t = Math.PI * (i / N); // 0 → π：从右边到左边
    const r = 0.5 * (1 + 0.13 * Math.abs(Math.sin(lobes * t * 0.5 + ph)) + 0.04 * Math.sin(13 * t + ph));
    pts.push(Math.cos(t) * r * (1 + 0.04 * Math.sin(7 * t)), Math.sin(t) * r * 1.6 * 0.58 + 0.04);
  }
  pts.push(-0.36, 0, 0.36, 0);
  return pts;
}

/** 一丛草：几片尖叶从一个根上散开，叶尖往两边歪。宽 1、高 1，脚在原点。 */
export function tuftOutline(seed: number, blades = 6): number[] {
  let s = seed * 9301 + 49297;
  const rnd = (): number => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const pts: number[] = [0.12, 0];
  for (let b = blades - 1; b >= 0; b--) {
    const u = blades === 1 ? 0.5 : b / (blades - 1);
    const base = -0.12 + u * 0.24;
    const lean = (u - 0.5) * 0.9 + (rnd() - 0.5) * 0.15;
    const h = 0.55 + rnd() * 0.45 - Math.abs(u - 0.5) * 0.3;
    const w = 0.045 + rnd() * 0.02;
    pts.push(base + w, 0.12 * h, base + lean * h, h, base - w * 0.4, 0.1 * h);
  }
  pts.push(-0.12, 0);
  return pts;
}

export interface PlantSpot {
  x: number;
  y: number;
  z: number;
  /** 宽、高（世界单位）。 */
  w: number;
  h: number;
  color: number;
  flip: boolean;
}

/** 一组同形状的立着的纸片。 */
export function plantField(outline: number[], depth: number, spots: PlantSpot[], sway: number, scale = 0.5): InstancedMesh {
  const geom: BufferGeometry = thinPiece(outline, depth);
  geom.translate(0, 0, -depth / 2);
  return plantMesh(geom, spots, sway, scale);
}

/** 同上，形状已经做好（flora.ts 的一张纸）。 */
export function plantMesh(geom: BufferGeometry, spots: PlantSpot[], sway: number, scale = 0.5): InstancedMesh {
  const mesh = new InstancedMesh(geom, plantMaterials(sway, scale), Math.max(1, spots.length));
  mesh.count = spots.length;
  const m = new Matrix4();
  const c = new Color();
  spots.forEach((p, i) => {
    m.makeScale(p.flip ? -p.w : p.w, p.h, p.w);
    m.setPosition(p.x, p.y, p.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(p.color));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthMaterial(sway);
  mesh.frustumCulled = false;
  return mesh;
}
