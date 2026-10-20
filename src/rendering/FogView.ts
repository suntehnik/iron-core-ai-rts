import * as THREE from 'three';
import { FogGrid } from '../engine/Vision';

/** Darkness of the fogged ground (0..255). */
const FOG_ALPHA = 120;
const FOG_RGB = [16, 22, 34];

/**
 * Fog of war on the ground: a low-resolution texture over the map, dark where the player's side
 * sees nothing. Linear filtering softens the edges and the darkness fades in and out.
 */
export class FogView {
  readonly mesh: THREE.Mesh;
  private tex: THREE.DataTexture;
  private data: Uint8Array;
  private alpha: Float32Array;
  private geom: THREE.PlaneGeometry;
  private mat: THREE.MeshBasicMaterial;

  constructor(
    private cols: number,
    private rows: number,
    width: number,
    height: number,
  ) {
    const data = new Uint8Array(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) {
      data[i * 4] = FOG_RGB[0];
      data[i * 4 + 1] = FOG_RGB[1];
      data[i * 4 + 2] = FOG_RGB[2];
    }
    this.data = data;
    this.alpha = new Float32Array(cols * rows);
    this.tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.needsUpdate = true;
    this.geom = new THREE.PlaneGeometry(width, height);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mesh = new THREE.Mesh(this.geom, this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(width / 2, 0.12, height / 2);
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /** Eases the darkness toward the grid (null — no fog, e.g. AI vs AI spectating). */
  update(grid: FogGrid | null, dt: number) {
    const k = Math.min(1, dt * 6);
    let any = false;
    for (let fy = 0; fy < this.rows; fy++) {
      for (let fx = 0; fx < this.cols; fx++) {
        const i = fy * this.cols + fx;
        const target = grid && grid.cols === this.cols && !grid.cells[i] ? FOG_ALPHA : 0;
        const a = this.alpha[i] + (target - this.alpha[i]) * k;
        this.alpha[i] = Math.abs(a - target) < 0.5 ? target : a;
        if (this.alpha[i] > 0) any = true;
        // texture row 0 is the far edge of the plane (world y = height)
        this.data[((this.rows - 1 - fy) * this.cols + fx) * 4 + 3] = this.alpha[i];
      }
    }
    this.mesh.visible = any;
    if (any) this.tex.needsUpdate = true;
  }

  dispose() {
    this.tex.dispose();
    this.geom.dispose();
    this.mat.dispose();
  }
}
