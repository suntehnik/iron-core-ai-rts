import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../engine/terrain/MapGenerator';
import { TERRAIN_CODE, TerrainGrid } from '../engine/terrain/TerrainGrid';
import { INK, toon } from './toon';

const PX_PER_CELL = 8;
const PINE_GREENS = ['#3f7d4a', '#4b8a50', '#356f45', '#447f3e'];
const LEAF_GREENS = ['#5e9a48', '#6aa64f', '#4f8a40', '#73a955'];
const ROCK_COLORS = ['#a8835c', '#94704d', '#b8936a', '#8a6a4c'];

/**
 * Forest, rocks and swamp of the battlefield in the cartoon style: instanced toon trees and
 * boulders with ink outlines over a painted ground layer. Built once per map.
 */
export class TerrainView {
  readonly root = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  constructor(grid: TerrainGrid) {
    this.root.name = 'terrain';
    if (!hasFeatures(grid)) return;
    this.root.add(this.groundLayer(grid));
    this.addTrees(grid);
    this.addRocks(grid);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  /** Darker forest floor, rocky ground and swamp water painted under the props. */
  private groundLayer(grid: TerrainGrid): THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = grid.cols * PX_PER_CELL;
    canvas.height = grid.rows * PX_PER_CELL;
    const ctx = canvas.getContext('2d')!;
    const paint: Record<number, [string, number]> = {
      [TERRAIN_CODE.forest]: ['rgba(92,120,58,0.55)', 1.5],
      [TERRAIN_CODE.rock]: ['rgba(150,128,96,0.5)', 1.3],
      [TERRAIN_CODE.swamp]: ['rgba(88,112,84,0.6)', 1.25],
    };
    for (let cy = 0; cy < grid.rows; cy++) {
      for (let cx = 0; cx < grid.cols; cx++) {
        const p = paint[grid.cells[grid.index(cx, cy)]];
        if (!p) continue;
        const x = (cx + 0.5) * PX_PER_CELL;
        const y = (cy + 0.5) * PX_PER_CELL;
        const r = p[1] * PX_PER_CELL;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, p[0]);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        if (grid.cells[grid.index(cx, cy)] === TERRAIN_CODE.swamp && (cx * 7 + cy * 13) % 5 === 0) {
          ctx.fillStyle = 'rgba(126,170,176,0.55)';
          ctx.beginPath();
          ctx.ellipse(x, y, PX_PER_CELL * 0.9, PX_PER_CELL * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geom = new THREE.PlaneGeometry(grid.cols, grid.rows);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(grid.cols / 2, 0.02, grid.rows / 2);
    mesh.receiveShadow = true;
    this.disposables.push(tex, geom, mat);
    return mesh;
  }

  private addTrees(grid: TerrainGrid) {
    const rnd = mulberry32(grid.cols * 7919 + grid.rows);
    const pines: THREE.Matrix4[] = [];
    const leafy: THREE.Matrix4[] = [];
    const trunks: THREE.Matrix4[] = [];
    const pineColors: THREE.Color[] = [];
    const leafColors: THREE.Color[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== TERRAIN_CODE.forest) continue;
      const cx = i % grid.cols;
      const cy = (i - cx) / grid.cols;
      const x = cx + 0.5 + (rnd() - 0.5) * 0.6;
      const z = cy + 0.5 + (rnd() - 0.5) * 0.6;
      const s = 0.85 + rnd() * 0.45;
      q.setFromAxisAngle(up, rnd() * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s));
      trunks.push(m);
      if (rnd() < 0.65) {
        pines.push(m);
        pineColors.push(new THREE.Color(PINE_GREENS[Math.floor(rnd() * PINE_GREENS.length)]));
      } else {
        leafy.push(m);
        leafColors.push(new THREE.Color(LEAF_GREENS[Math.floor(rnd() * LEAF_GREENS.length)]));
      }
    }
    if (!trunks.length) return;

    const trunkGeo = new THREE.CylinderGeometry(0.11, 0.16, 0.9, 6).translate(0, 0.45, 0);
    this.instanced(trunkGeo, toon('#7a5232'), trunks, null, null);

    const pineGeo = mergeGeometries([
      new THREE.ConeGeometry(0.85, 1.3, 7).translate(0, 1.25, 0),
      new THREE.ConeGeometry(0.6, 1.05, 7).translate(0, 1.95, 0),
    ])!;
    this.instanced(pineGeo, toon('#ffffff'), pines, pineColors, 1.6);

    const leafGeo = new THREE.IcosahedronGeometry(0.8, 0).scale(1, 1.1, 1).translate(0, 1.45, 0);
    this.instanced(leafGeo, toon('#ffffff'), leafy, leafColors, 1.45);
  }

  private addRocks(grid: TerrainGrid) {
    const rnd = mulberry32(grid.cols * 104729 + grid.rows * 31);
    const rocks: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const e = new THREE.Euler();
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] !== TERRAIN_CODE.rock) continue;
      const cx = i % grid.cols;
      const cy = (i - cx) / grid.cols;
      e.set(rnd() * 0.6, rnd() * Math.PI * 2, rnd() * 0.6);
      const s = 0.8 + rnd() * 0.5;
      rocks.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(cx + 0.5 + (rnd() - 0.5) * 0.4, 0.25, cy + 0.5 + (rnd() - 0.5) * 0.4),
          new THREE.Quaternion().setFromEuler(e),
          new THREE.Vector3(s, s * (0.6 + rnd() * 0.5), s),
        ),
      );
      colors.push(new THREE.Color(ROCK_COLORS[Math.floor(rnd() * ROCK_COLORS.length)]));
    }
    if (!rocks.length) return;
    const geo = new THREE.DodecahedronGeometry(0.7, 0);
    this.instanced(geo, toon('#ffffff'), rocks, colors, 0);
  }

  /**
   * One instanced mesh, plus an instanced ink hull for the cartoon outline when `outlinePivotY`
   * is given (the hull is grown around that height, the middle of the crown or boulder).
   */
  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, matrices: THREE.Matrix4[], colors: THREE.Color[] | null, outlinePivotY: number | null) {
    if (!matrices.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      if (colors) mesh.setColorAt(i, colors[i]);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    this.root.add(mesh);
    this.disposables.push(mesh, geo);
    if (outlinePivotY === null) return;
    const ink = new THREE.InstancedMesh(geo, INK, matrices.length);
    const grow = new THREE.Matrix4()
      .makeTranslation(0, outlinePivotY, 0)
      .multiply(new THREE.Matrix4().makeScale(1.08, 1.08, 1.08))
      .multiply(new THREE.Matrix4().makeTranslation(0, -outlinePivotY, 0));
    const tmp = new THREE.Matrix4();
    matrices.forEach((m, i) => ink.setMatrixAt(i, tmp.multiplyMatrices(m, grow)));
    ink.castShadow = false;
    this.root.add(ink);
    this.disposables.push(ink);
  }
}

function hasFeatures(grid: TerrainGrid): boolean {
  for (const c of grid.cells) if (c !== TERRAIN_CODE.open) return true;
  return false;
}
