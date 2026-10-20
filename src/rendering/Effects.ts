import * as THREE from 'three';
import { VisualEffect } from '../types/game';
import { box, sphere } from './toon';

interface Particle {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  gravity: number;
  grow: number;
  baseScale: number;
  fade: boolean;
}

const TEAM_FX: Record<string, string> = { player: '#7ef0ff', enemy: '#ff8a4c', neutral: '#ffd27a' };

/** Lightweight particle effects: muzzle flashes, sparks, explosions, smoke, debris. */
export class Effects {
  private particles: Particle[] = [];
  private lastEffectId = 0;

  constructor(private scene: THREE.Scene) {}

  /** Spawns new effects; `show` filters out the ones the viewer must not see (fog of war). */
  ingest(effects: VisualEffect[], show: (e: VisualEffect) => boolean = () => true) {
    for (const e of effects) {
      if (e.id <= this.lastEffectId) continue;
      this.lastEffectId = e.id;
      if (show(e)) this.spawn(e);
    }
  }

  reset() {
    for (const p of this.particles) this.remove(p);
    this.particles = [];
    this.lastEffectId = 0;
  }

  private spawn(e: VisualEffect) {
    const pos = new THREE.Vector3(e.pos.x, 1.2, e.pos.y);
    const teamColor = TEAM_FX[e.team] ?? TEAM_FX.neutral;
    switch (e.type) {
      case 'muzzle':
        this.add(sphere(0.35, 8), teamColor, pos.clone().setY(1.6), 0.09, new THREE.Vector3(), 0, 1.8 * e.size, 1, true);
        break;
      case 'hit':
        for (let i = 0; i < 4; i++) {
          this.add(box(0.12, 0.12, 0.12), '#fff3c4', pos.clone(), 0.25, rand(5), 9, 0, 1, true);
        }
        this.add(sphere(0.3, 8), teamColor, pos.clone(), 0.12, new THREE.Vector3(), 0, 1.2, 1, true);
        break;
      case 'melee':
        for (let i = 0; i < 6; i++) this.add(box(0.1, 0.1, 0.1), '#ffe08a', pos.clone(), 0.3, rand(7), 12, 0, 1, true);
        break;
      case 'explosion':
      case 'big_explosion': {
        const big = e.type === 'big_explosion';
        const s = Math.max(1, e.size) * (big ? 1.6 : 1);
        this.add(sphere(0.6, 12), '#fff1b0', pos.clone(), 0.18, new THREE.Vector3(), 0, 3.5 * s, 1, true);
        this.add(sphere(0.7, 12), '#ff9a3c', pos.clone(), 0.45, new THREE.Vector3(0, 1.5, 0), 0, 2.6 * s, 1, true);
        for (let i = 0; i < (big ? 10 : 5); i++) {
          const v = rand(2.5 * s);
          v.y = 1.5 + Math.random() * 2.5;
          this.add(sphere(0.45, 8), '#b8afa3', pos.clone(), 1.1 + Math.random() * 0.6, v, -0.8, 1.4 * s, 0.4, true);
        }
        for (let i = 0; i < (big ? 12 : 6); i++) {
          const v = rand(6 * s);
          v.y = 4 + Math.random() * 5;
          this.add(box(0.25, 0.25, 0.25), '#3a3f47', pos.clone(), 0.9, v, 18, 0, 1, false);
        }
        break;
      }
      case 'build_complete':
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const v = new THREE.Vector3(Math.cos(a) * 7, 1.5, Math.sin(a) * 7);
          this.add(box(0.25, 0.25, 0.25), '#ffd27a', pos.clone(), 0.7, v, 4, 0, 1, true);
        }
        break;
    }
  }

  private add(
    geometry: THREE.BufferGeometry,
    color: string,
    pos: THREE.Vector3,
    life: number,
    vel: THREE.Vector3,
    gravity: number,
    grow: number,
    opacity: number,
    fade: boolean,
  ) {
    if (this.particles.length > 600) return;
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.particles.push({ mesh, life, maxLife: life, vel, gravity, grow, baseScale: 1, fade });
  }

  update(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.1) {
        p.mesh.position.y = 0.1;
        p.vel.multiplyScalar(0.3);
      }
      const t = 1 - Math.max(0, p.life) / p.maxLife;
      const s = p.baseScale + p.grow * t;
      p.mesh.scale.setScalar(Math.max(0.05, s));
      if (p.fade) (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
    }
    const alive: Particle[] = [];
    for (const p of this.particles) {
      if (p.life > 0) alive.push(p);
      else this.remove(p);
    }
    this.particles = alive;
  }

  private remove(p: Particle) {
    this.scene.remove(p.mesh);
    (p.mesh.material as THREE.Material).dispose();
  }
}

function rand(mag: number): THREE.Vector3 {
  return new THREE.Vector3((Math.random() - 0.5) * 2 * mag, Math.random() * mag, (Math.random() - 0.5) * 2 * mag);
}
