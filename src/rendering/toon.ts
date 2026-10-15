import * as THREE from 'three';

/** Shared cartoon-look helpers: 3-tone toon shading, ink outlines, cached geometry. */

let gradientMap: THREE.DataTexture | null = null;
function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  gradientMap = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();
export function toon(color: string | number, emissive?: string | number, emissiveIntensity = 1): THREE.MeshToonMaterial {
  const key = `${color}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap() });
    if (emissive !== undefined) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = emissiveIntensity;
    }
    toonCache.set(key, m);
  }
  return m;
}

const glowCache = new Map<string, THREE.MeshBasicMaterial>();
export function glow(color: string | number, opacity = 1): THREE.MeshBasicMaterial {
  const key = `${color}|${opacity}`;
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
    glowCache.set(key, m);
  }
  return m;
}

export const INK = new THREE.MeshBasicMaterial({ color: '#2b2622', side: THREE.BackSide });

const geoCache = new Map<string, THREE.BufferGeometry>();
export function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

export const box = (w: number, h: number, d: number) => geo(`box_${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cyl = (rt: number, rb: number, h: number, seg = 10) =>
  geo(`cyl_${rt}_${rb}_${h}_${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
export const sphere = (r: number, seg = 10) => geo(`sph_${r}_${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)));

export interface PartOptions {
  outline?: boolean;
  shadow?: boolean;
  outlineScale?: number;
}

/** A mesh with an optional inverted-hull ink outline (cartoon silhouette). */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  opts: PartOptions = {},
): THREE.Object3D {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = opts.shadow ?? true;
  mesh.receiveShadow = false;
  if (!opts.outline) {
    mesh.position.set(x, y, z);
    return mesh;
  }
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(mesh);
  const ink = new THREE.Mesh(geometry, INK);
  const s = opts.outlineScale ?? 1.07;
  ink.scale.set(s, s, s);
  g.add(ink);
  return g;
}

export const PALETTE = {
  cream: '#efe4cc',
  creamDark: '#d6c6a3',
  steel: '#4a4f58',
  steelDark: '#33373e',
  rubber: '#2a2c31',
  yellow: '#f2b134',
  glass: '#1d2a33',
  sand: '#e8d4a6',
};
