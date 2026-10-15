import * as THREE from 'three';
import { RobotDesign } from '../types/robot';
import { PALETTE, box, cyl, glow, part, sphere, toon } from './toon';

export interface TeamPalette {
  main: string;
  dark: string;
  glow: string;
}

/** Animation handles for a unit model. Models face +X. */
export interface RobotRig {
  root: THREE.Group;
  body: THREE.Group;
  turret: THREE.Group | null;
  legs: THREE.Object3D[];
  wheels: THREE.Object3D[];
  saw: THREE.Object3D | null;
  gun: THREE.Object3D | null;
  cargo: THREE.Object3D | null;
  kind: 'biped' | 'tracked' | 'quad' | 'harvester';
  height: number;
}

export class RobotMeshFactory {
  public static createRobot(design: RobotDesign, team: TeamPalette): RobotRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const main = toon(team.main);
    const dark = toon(team.dark);
    const cream = toon(PALETTE.cream);
    const steel = toon(PALETTE.steel);
    const steelDark = toon(PALETTE.steelDark);
    const rubber = toon(PALETTE.rubber);
    const eye = glow(team.glow);
    const legs: THREE.Object3D[] = [];
    const wheels: THREE.Object3D[] = [];
    let turret: THREE.Group | null = null;
    let mountY = 0;
    let kind: RobotRig['kind'];
    let height = 2.6;

    const mods = new Set(design.modules);

    if (design.chassisId === 'light_biped') {
      kind = 'biped';
      for (const side of [-1, 1]) {
        const leg = new THREE.Group();
        leg.position.set(0, 1.15, side * 0.45);
        leg.add(part(box(0.32, 0.75, 0.3), steel, 0, -0.35, 0));
        leg.add(part(box(0.28, 0.7, 0.26), steelDark, 0.05, -0.85, 0));
        leg.add(part(box(0.62, 0.18, 0.4), rubber, 0.12, -1.12, 0, { outline: true }));
        root.add(leg);
        legs.push(leg);
      }
      body.add(part(box(1.05, 0.95, 1.05), main, 0, 1.65, 0, { outline: true }));
      body.add(part(box(0.3, 0.6, 0.85), cream, 0.5, 1.65, 0));
      // Head with glowing visor
      const head = new THREE.Group();
      head.position.set(0.15, 2.32, 0);
      head.add(part(box(0.6, 0.42, 0.62), cream, 0, 0, 0, { outline: true }));
      head.add(part(box(0.06, 0.12, 0.42), eye, 0.31, 0.03, 0, { shadow: false }));
      body.add(head);
      mountY = 1.75;
      height = 2.7;
    } else if (design.chassisId === 'medium_tracked') {
      kind = 'tracked';
      for (const side of [-1, 1]) {
        root.add(part(box(2.3, 0.62, 0.52), rubber, 0, 0.34, side * 0.85, { outline: true }));
        for (let i = -1; i <= 1; i++) {
          const w = part(cyl(0.24, 0.24, 0.56, 10), cream, i * 0.72, 0.34, side * 0.85, { shadow: false });
          w.rotation.x = Math.PI / 2;
          root.add(w);
          wheels.push(w);
        }
      }
      body.add(part(box(2.0, 0.6, 1.3), main, 0, 0.88, 0, { outline: true }));
      body.add(part(box(0.5, 0.35, 1.2), cream, 0.75, 1.0, 0));
      turret = new THREE.Group();
      turret.position.set(-0.1, 1.38, 0);
      turret.add(part(cyl(0.62, 0.72, 0.5, 10), main, 0, 0, 0, { outline: true }));
      turret.add(part(box(0.55, 0.3, 0.5), cream, 0.2, 0.28, 0));
      turret.add(part(box(0.06, 0.1, 0.32), eye, 0.48, 0.3, 0, { shadow: false }));
      body.add(turret);
      mountY = 0.12;
      height = 2.0;
    } else {
      kind = 'quad';
      const corners = [
        [0.95, 0.95],
        [0.95, -0.95],
        [-0.95, 0.95],
        [-0.95, -0.95],
      ];
      for (const [x, z] of corners) {
        const leg = new THREE.Group();
        leg.position.set(x, 1.5, z);
        const upper = part(box(0.42, 1.0, 0.42), steel, x * 0.25, -0.35, z * 0.25);
        upper.rotation.set(z * 0.35, 0, -x * 0.35);
        leg.add(upper);
        leg.add(part(box(0.38, 0.9, 0.38), steelDark, x * 0.45, -1.05, z * 0.45));
        leg.add(part(cyl(0.34, 0.42, 0.2, 8), rubber, x * 0.5, -1.45, z * 0.5, { outline: true }));
        root.add(leg);
        legs.push(leg);
      }
      body.add(part(box(2.3, 1.05, 2.0), main, 0, 1.9, 0, { outline: true }));
      body.add(part(box(0.5, 0.7, 1.7), cream, 1.05, 1.9, 0));
      body.add(part(box(2.0, 0.18, 2.1), toon(PALETTE.yellow), 0, 1.33, 0));
      turret = new THREE.Group();
      turret.position.set(-0.1, 2.6, 0);
      turret.add(part(box(1.3, 0.6, 1.2), main, 0, 0, 0, { outline: true }));
      turret.add(part(box(0.08, 0.14, 0.6), eye, 0.66, 0.08, 0, { shadow: false }));
      body.add(turret);
      mountY = 0.15;
      height = 3.2;
    }

    // ── Armor (visible on the model, brief §7)
    const plateHost = turret && kind === 'quad' ? body : body;
    if (mods.has('sloped_reactive')) {
      const brick = toon(team.dark);
      const baseY = kind === 'biped' ? 1.65 : kind === 'tracked' ? 0.95 : 1.9;
      const frontX = kind === 'biped' ? 0.62 : kind === 'tracked' ? 1.05 : 1.25;
      for (let i = -1; i <= 1; i++) {
        for (let j = 0; j < 2; j++) {
          const b = part(box(0.22, 0.3, 0.36), j === 0 ? brick : toon(PALETTE.yellow), frontX, baseY - 0.18 + j * 0.32, i * 0.38, { outline: true });
          b.rotation.z = -0.35;
          plateHost.add(b);
        }
      }
      for (const side of [-1, 1]) {
        plateHost.add(part(box(kind === 'biped' ? 0.9 : 1.6, 0.5, 0.16), brick, 0, baseY, side * (kind === 'biped' ? 0.6 : kind === 'tracked' ? 0.72 : 1.08), { outline: true }));
      }
    } else if (mods.has('reinforced_steel')) {
      const baseY = kind === 'biped' ? 1.8 : kind === 'tracked' ? 0.95 : 2.0;
      for (const side of [-1, 1]) {
        const plate = part(
          box(kind === 'biped' ? 0.7 : 1.4, 0.45, 0.14),
          steel,
          0,
          baseY,
          side * (kind === 'biped' ? 0.62 : kind === 'tracked' ? 0.7 : 1.06),
          { outline: true },
        );
        plateHost.add(plate);
      }
      const front = part(box(0.14, 0.5, kind === 'biped' ? 0.9 : 1.2), steel, kind === 'biped' ? 0.6 : kind === 'tracked' ? 1.02 : 1.22, baseY - 0.05, 0, { outline: true });
      front.rotation.z = -0.3;
      plateHost.add(front);
    } else if (mods.has('light_composite')) {
      const baseY = kind === 'biped' ? 1.95 : kind === 'tracked' ? 1.0 : 2.15;
      for (const side of [-1, 1]) {
        plateHost.add(part(box(kind === 'biped' ? 0.5 : 1.0, 0.22, 0.1), cream, -0.1, baseY, side * (kind === 'biped' ? 0.58 : kind === 'tracked' ? 0.68 : 1.03)));
      }
    }

    // ── Weapon on the turret / torso
    const mount = turret ?? body;
    const gun = new THREE.Group();
    gun.position.set(kind === 'biped' ? 0.35 : 0.3, mountY + (kind === 'biped' ? 0 : 0.1), kind === 'biped' ? -0.72 : 0);
    let saw: THREE.Object3D | null = null;
    if (mods.has('heavy_siege_cannon')) {
      gun.add(part(box(0.7, 0.45, 0.55), steelDark, 0.2, 0, 0, { outline: true }));
      const barrel = part(cyl(0.16, 0.2, 2.6, 10), steel, 1.6, 0.05, 0, { outline: true });
      barrel.rotation.z = Math.PI / 2;
      gun.add(barrel);
      const brake = part(cyl(0.26, 0.26, 0.35, 10), steelDark, 2.9, 0.05, 0, { outline: true });
      brake.rotation.z = Math.PI / 2;
      gun.add(brake);
    } else if (mods.has('sniper_railgun')) {
      for (const dy of [-0.12, 0.12]) gun.add(part(box(2.8, 0.09, 0.16), steel, 1.3, dy, 0, { outline: true }));
      gun.add(part(box(2.6, 0.05, 0.06), glow(team.glow), 1.3, 0, 0, { shadow: false }));
      gun.add(part(box(0.6, 0.45, 0.45), steelDark, 0, 0, 0, { outline: true }));
    } else if (mods.has('plasma_blasters')) {
      for (const dz of [-0.24, 0.24]) {
        const coil = part(cyl(0.13, 0.17, 1.2, 8), steelDark, 0.65, 0, dz, { outline: true });
        coil.rotation.z = Math.PI / 2;
        gun.add(coil);
        const g = part(cyl(0.15, 0.15, 0.32, 8), glow(team.glow), 1.0, 0, dz, { shadow: false });
        g.rotation.z = Math.PI / 2;
        gun.add(g);
      }
    } else if (mods.has('autocannon_20mm')) {
      gun.add(part(box(0.5, 0.32, 0.42), cream, 0.1, 0, 0, { outline: true }));
      for (const dz of [-0.1, 0.1]) {
        const b = part(cyl(0.06, 0.07, 1.0, 6), steelDark, 0.75, 0.02, dz);
        b.rotation.z = Math.PI / 2;
        gun.add(b);
      }
    }
    if (mods.has('melee_buzzsaw')) {
      const arm = new THREE.Group();
      arm.position.set(kind === 'biped' ? 0.3 : 0.8, kind === 'biped' ? 1.5 : mountY + 0.9, kind === 'biped' ? 0.75 : 0.6);
      arm.add(part(box(0.9, 0.16, 0.16), steelDark, 0.4, 0, 0));
      const disc = new THREE.Group();
      disc.position.set(0.95, 0, 0);
      disc.add(part(cyl(0.55, 0.55, 0.06, 14), steel, 0, 0, 0, { outline: true }));
      disc.add(part(cyl(0.18, 0.18, 0.1, 8), toon(PALETTE.yellow), 0, 0, 0));
      disc.rotation.x = Math.PI / 2;
      arm.add(disc);
      saw = disc;
      (turret && kind !== 'biped' ? body : body).add(arm);
    }
    mount.add(gun);

    // ── Engines & systems
    const rearX = kind === 'biped' ? -0.6 : kind === 'tracked' ? -1.0 : -1.2;
    const topY = kind === 'biped' ? 1.9 : kind === 'tracked' ? 1.1 : 2.3;
    if (mods.has('micro_turbine')) {
      for (const dz of [-0.25, 0.25]) {
        const pipe = part(cyl(0.14, 0.18, 0.55, 8), steelDark, rearX - 0.1, topY, dz, { outline: true });
        pipe.rotation.z = Math.PI / 2.4;
        body.add(pipe);
        body.add(part(sphere(0.11, 6), glow('#ffb347'), rearX - 0.38, topY - 0.12, dz, { shadow: false }));
      }
    }
    if (mods.has('diesel_electric')) {
      body.add(part(box(0.45, 0.5, 0.6), steel, rearX, topY, 0, { outline: true }));
      body.add(part(cyl(0.08, 0.1, 0.6, 6), steelDark, rearX - 0.05, topY + 0.5, 0.18));
    }
    if (mods.has('heat_radiator')) {
      for (let i = 0; i < 4; i++) body.add(part(box(0.06, 0.4, 0.55), toon(PALETTE.creamDark), rearX + 0.1 + i * 0.12, topY + 0.32, 0));
    }
    if (mods.has('radar_sensor')) {
      const dish = new THREE.Group();
      dish.position.set(-0.2, (turret ? turret.position.y + 0.55 : topY + 0.55), 0.3);
      dish.add(part(cyl(0.04, 0.04, 0.4, 6), steelDark, 0, -0.15, 0));
      const d = part(cyl(0.35, 0.08, 0.12, 10), cream, 0, 0.1, 0, { outline: true });
      d.rotation.z = 0.6;
      dish.add(d);
      body.add(dish);
    }

    const scale = kind === 'quad' ? 1.45 : kind === 'tracked' ? 1.4 : 1.35;
    root.scale.setScalar(scale);
    return { root, body, turret, legs, wheels, saw, gun, cargo: null, kind, height: height * scale };
  }

  public static createHarvester(team: TeamPalette): RobotRig {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const wheels: THREE.Object3D[] = [];
    for (const x of [-0.55, 0.55]) {
      for (const z of [-0.55, 0.55]) {
        const w = part(cyl(0.26, 0.26, 0.22, 10), toon(PALETTE.rubber), x, 0.26, z, { outline: true });
        w.rotation.x = Math.PI / 2;
        root.add(w);
        wheels.push(w);
      }
    }
    body.add(part(box(1.6, 0.3, 1.0), toon(PALETTE.steel), 0, 0.5, 0));
    body.add(part(box(0.65, 0.65, 0.9), toon(team.main), 0.45, 0.95, 0, { outline: true }));
    body.add(part(box(0.06, 0.16, 0.5), glow(team.glow), 0.79, 1.05, 0, { shadow: false }));
    // Yellow cargo bed
    const bed = toon(PALETTE.yellow);
    body.add(part(box(0.8, 0.12, 0.95), bed, -0.35, 0.7, 0, { outline: true }));
    for (const z of [-0.45, 0.45]) body.add(part(box(0.8, 0.35, 0.06), bed, -0.35, 0.88, z));
    const cargo = new THREE.Group();
    cargo.position.set(-0.35, 0.95, 0);
    const crystalMat = toon('#9fb3c8');
    for (let i = 0; i < 3; i++) {
      const c = part(geoCrystal(), crystalMat, (i - 1) * 0.22, 0.1, (i % 2) * 0.2 - 0.1, { outline: true });
      c.rotation.set(0.3 * i, i, 0.2);
      cargo.add(c);
    }
    cargo.visible = false;
    body.add(cargo);
    root.scale.setScalar(1.3);
    return { root, body, turret: null, legs: [], wheels, saw: null, gun: null, cargo, kind: 'harvester', height: 1.8 };
  }
}

let crystalGeo: THREE.BufferGeometry | null = null;
export function geoCrystal(): THREE.BufferGeometry {
  if (!crystalGeo) crystalGeo = new THREE.OctahedronGeometry(0.22, 0);
  return crystalGeo;
}
