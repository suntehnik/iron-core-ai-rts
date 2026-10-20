import * as THREE from 'three';
import { PAD_BUILDINGS } from '../config/balance';
import { BuildingType, PadBuildingType, Team } from '../types/game';
import { TeamPalette, geoCrystal } from './RobotMeshFactory';
import { PALETTE, box, cyl, glow, part, toon } from './toon';

export interface BuildingRig {
  root: THREE.Group;
  model: THREE.Group;
  scaffold: THREE.Group;
  turret: THREE.Group | null;
  spinners: THREE.Object3D[];
  pulse: THREE.Object3D[];
  conveyor: THREE.Object3D[];
  height: number;
}

function hazardStripe(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    g.add(part(box(w / n, 0.22, d), toon(i % 2 ? PALETTE.yellow : PALETTE.rubber), -w / 2 + (i + 0.5) * (w / n), 0, 0, { shadow: false }));
  }
  return g;
}

function flag(team: TeamPalette, height: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(cyl(0.06, 0.06, height, 6), toon(PALETTE.steelDark), 0, height / 2, 0));
  const cloth = part(box(0.05, 0.9, 1.2), toon(team.main), 0, height - 0.55, 0.62, { outline: true });
  g.add(cloth);
  g.add(part(box(0.06, 0.3, 0.3), toon(PALETTE.cream), 0, height - 0.55, 0.62));
  return g;
}

export class BuildingMeshFactory {
  public static create(type: BuildingType, team: Team, palette: TeamPalette): BuildingRig {
    const root = new THREE.Group();
    const model = new THREE.Group();
    root.add(model);
    const main = toon(palette.main);
    const dark = toon(palette.dark);
    const cream = toon(PALETTE.cream);
    const steel = toon(PALETTE.steel);
    const steelDark = toon(PALETTE.steelDark);
    const spinners: THREE.Object3D[] = [];
    const pulse: THREE.Object3D[] = [];
    const conveyor: THREE.Object3D[] = [];
    let turret: THREE.Group | null = null;
    let height = 6;
    const front = team === 'player' ? 1 : -1; // doors face the enemy side

    // Concrete foundation pad
    const padSpec = type in PAD_BUILDINGS ? PAD_BUILDINGS[type as PadBuildingType] : null;
    const padR = padSpec ? padSpec.radius + 0.7 : type === 'command_center' ? 6.2 : type === 'factory' ? 5 : 4;
    const pad = new THREE.Mesh(cyl(padR, padSpec ? padR + 0.2 : type === 'command_center' ? 6.5 : 5.2, 0.2, 24), toon('#cbb68b'));
    pad.position.y = 0.1;
    pad.receiveShadow = true;
    root.add(pad);

    if (type === 'command_center') {
      model.add(part(box(7.2, 2.2, 7.2), steelDark, 0, 1.2, 0, { outline: true }));
      const stripe = hazardStripe(7.3, 7.3);
      stripe.position.y = 0.35;
      model.add(stripe);
      model.add(part(box(6.2, 2.0, 6.2), main, 0, 3.2, 0, { outline: true }));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          model.add(part(box(1.5, 3.2, 1.5), cream, sx * 3.0, 2.6, sz * 3.0, { outline: true }));
          model.add(part(box(1.0, 0.3, 1.0), toon(PALETTE.yellow), sx * 3.0, 4.3, sz * 3.0));
        }
      }
      model.add(part(box(4.2, 1.6, 4.2), cream, 0, 4.9, 0, { outline: true }));
      // Glowing door facing the battlefield
      model.add(part(box(0.2, 1.6, 2.2), glow('#ffcf5a'), front * 3.62, 1.1, 0, { shadow: false }));
      model.add(part(box(0.4, 0.3, 2.6), steel, front * 3.65, 2.05, 0));
      // Radar dish
      const dish = new THREE.Group();
      dish.position.set(-1.2 * front, 5.9, -1.2);
      dish.add(part(cyl(0.12, 0.12, 1.2, 6), steelDark, 0, 0.3, 0));
      const d = part(cyl(1.1, 0.25, 0.35, 14), cream, 0, 1.1, 0, { outline: true });
      d.rotation.z = 0.7;
      dish.add(d);
      model.add(dish);
      spinners.push(dish);
      const f = flag(palette, 4.2);
      f.position.set(1.6 * front, 5.7, 1.6);
      model.add(f);
      // Defence turret on the roof
      turret = new THREE.Group();
      turret.position.set(0.8 * front, 6.0, 1.0);
      turret.add(part(cyl(0.7, 0.85, 0.6, 10), steel, 0, 0, 0, { outline: true }));
      const barrel = part(cyl(0.12, 0.14, 1.6, 8), steelDark, 0.8, 0.15, 0, { outline: true });
      barrel.rotation.z = Math.PI / 2;
      turret.add(barrel);
      turret.add(part(box(0.1, 0.12, 0.5), glow(palette.glow), 0.62, 0.35, 0, { shadow: false }));
      model.add(turret);
      // Ore crates by the HQ (delivered metal)
      for (let i = 0; i < 3; i++) {
        const crate = new THREE.Group();
        crate.position.set(-front * (4.6 + (i % 2) * 1.2), 0.5, -3 + i * 1.6);
        crate.add(part(box(1.1, 0.8, 1.1), toon(PALETTE.yellow), 0, 0, 0, { outline: true }));
        for (let k = 0; k < 2; k++) {
          const c = part(geoCrystal(), toon('#9fb3c8'), (k - 0.5) * 0.4, 0.55, 0, { outline: true });
          c.scale.setScalar(1.6);
          crate.add(c);
        }
        model.add(crate);
      }
      height = 9;
    } else if (type === 'factory') {
      model.add(part(box(6.2, 3.2, 5.2), main, 0, 1.6, 0, { outline: true }));
      const roof = part(cyl(2.6, 2.6, 6.0, 12, ), cream, 0, 3.2, 0, { outline: true });
      roof.rotation.z = Math.PI / 2;
      roof.scale.set(1, 1, 0.55);
      model.add(roof);
      model.add(part(box(0.25, 2.4, 3.0), glow('#ffcf5a'), front * 3.12, 1.3, 0, { shadow: false }));
      model.add(part(box(0.5, 0.4, 3.6), steelDark, front * 3.2, 2.7, 0, { outline: true }));
      const stripe = hazardStripe(6.3, 5.3);
      stripe.position.y = 0.3;
      model.add(stripe);
      // Conveyor belt leading out of the door
      const belt = new THREE.Group();
      belt.position.set(front * 5.0, 0.45, 0);
      belt.add(part(box(3.6, 0.3, 1.6), steelDark, 0, 0, 0, { outline: true }));
      for (let i = 0; i < 6; i++) {
        const roller = part(box(0.3, 0.06, 1.5), toon(PALETTE.yellow), -1.5 + i * 0.6, 0.18, 0, { shadow: false });
        belt.add(roller);
        conveyor.push(roller);
      }
      model.add(belt);
      // Yellow crane arm
      const crane = new THREE.Group();
      crane.position.set(front * 4.2, 0, -2.2);
      crane.add(part(box(0.35, 4.0, 0.35), toon(PALETTE.yellow), 0, 2.0, 0, { outline: true }));
      crane.add(part(box(2.4, 0.3, 0.3), toon(PALETTE.yellow), front * 0.9, 3.9, 0, { outline: true }));
      crane.add(part(box(0.1, 1.0, 0.1), steelDark, front * 1.9, 3.3, 0));
      model.add(crane);
      spinners.push(crane);
      model.add(part(cyl(0.45, 0.6, 2.4, 10), steel, -front * 2.2, 4.0, 1.6, { outline: true }));
      height = 6;
    } else if (type === 'turret') {
      model.add(part(cyl(1.4, 1.6, 0.9, 12), steelDark, 0, 0.45, 0, { outline: true }));
      model.add(part(cyl(1.1, 1.25, 0.8, 12), main, 0, 1.3, 0, { outline: true }));
      const stripe = hazardStripe(2.2, 2.2);
      stripe.position.y = 0.95;
      stripe.scale.set(0.9, 0.5, 0.9);
      model.add(stripe);
      turret = new THREE.Group();
      turret.position.set(0, 1.95, 0);
      turret.add(part(box(1.3, 0.7, 1.1), cream, 0, 0.2, 0, { outline: true }));
      for (const z of [-0.25, 0.25]) {
        const barrel = part(cyl(0.11, 0.13, 1.7, 8), steelDark, 1.1, 0.3, z, { outline: true });
        barrel.rotation.z = Math.PI / 2;
        turret.add(barrel);
      }
      turret.add(part(box(0.1, 0.14, 0.6), glow(palette.glow), 0.68, 0.45, 0, { shadow: false }));
      model.add(turret);
      height = 3.2;
    } else if (type === 'repair_dock') {
      model.add(part(box(4.4, 0.45, 4.4), steelDark, 0, 0.25, 0, { outline: true }));
      const stripe = hazardStripe(4.5, 4.5);
      stripe.position.y = 0.4;
      model.add(stripe);
      const ring = part(cyl(1.6, 1.6, 0.06, 20), glow('#5bd36a', 0.8), 0, 0.52, 0, { shadow: false });
      model.add(ring);
      pulse.push(ring);
      // green cross on a post
      const sign = new THREE.Group();
      sign.position.set(-front * 1.9, 0, -1.9);
      sign.add(part(cyl(0.12, 0.12, 2.6, 6), steel, 0, 1.3, 0));
      sign.add(part(box(0.9, 0.28, 0.12), glow('#5bd36a'), 0, 2.7, 0, { shadow: false }));
      sign.add(part(box(0.28, 0.9, 0.12), glow('#5bd36a'), 0, 2.7, 0, { shadow: false }));
      model.add(sign);
      // service crane
      const crane = new THREE.Group();
      crane.position.set(front * 1.8, 0, 1.8);
      crane.add(part(box(0.3, 3.0, 0.3), toon(PALETTE.yellow), 0, 1.5, 0, { outline: true }));
      crane.add(part(box(0.3, 0.25, 2.2), toon(PALETTE.yellow), 0, 2.95, -0.9, { outline: true }));
      crane.add(part(box(0.08, 0.8, 0.08), steelDark, 0, 2.4, -1.8));
      model.add(crane);
      spinners.push(crane);
      height = 3.6;
    } else if (type === 'radar') {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = part(cyl(0.1, 0.14, 4.2, 6), steel, sx * 0.8, 2.1, sz * 0.8);
          leg.rotation.set(sz * 0.12, 0, -sx * 0.12);
          model.add(leg);
        }
      }
      model.add(part(box(1.8, 0.3, 1.8), main, 0, 4.2, 0, { outline: true }));
      model.add(part(box(1.0, 0.8, 1.0), cream, 0, 4.75, 0, { outline: true }));
      const dish = new THREE.Group();
      dish.position.set(0, 5.3, 0);
      dish.add(part(cyl(0.14, 0.14, 0.8, 6), steelDark, 0, 0.3, 0));
      const d = part(cyl(1.5, 0.3, 0.4, 16), cream, 0, 0.9, 0, { outline: true });
      d.rotation.z = 0.8;
      dish.add(d);
      dish.add(part(box(0.12, 0.12, 0.12), glow(palette.glow), 0.9, 1.4, 0, { shadow: false }));
      model.add(dish);
      spinners.push(dish);
      height = 6.8;
    } else if (type === 'depot') {
      model.add(part(box(4.6, 0.5, 4.0), steelDark, 0, 0.25, 0, { outline: true }));
      const stripe = hazardStripe(4.7, 4.1);
      stripe.position.y = 0.42;
      model.add(stripe);
      // ore hopper
      model.add(part(cyl(1.3, 0.6, 1.4, 10), main, 0, 1.3, 0, { outline: true }));
      model.add(part(cyl(1.4, 1.4, 0.25, 10), cream, 0, 2.05, 0, { outline: true }));
      for (let i = 0; i < 2; i++) {
        const crate = new THREE.Group();
        crate.position.set(-front * 1.6, 0.85, -1.2 + i * 2.4);
        crate.add(part(box(1.0, 0.7, 1.0), toon(PALETTE.yellow), 0, 0, 0, { outline: true }));
        const c = part(geoCrystal(), toon('#9fb3c8'), 0, 0.5, 0, { outline: true });
        c.scale.setScalar(1.6);
        crate.add(c);
        model.add(crate);
      }
      const f = flag(palette, 3.2);
      f.position.set(front * 1.9, 0.5, 1.6);
      model.add(f);
      height = 3.4;
    } else {
      model.add(part(cyl(2.6, 2.9, 1.6, 14), steelDark, 0, 0.8, 0, { outline: true }));
      model.add(part(cyl(2.0, 2.2, 2.6, 14), main, 0, 2.6, 0, { outline: true }));
      for (const y of [1.9, 2.7, 3.5]) {
        const ring = part(cyl(2.25, 2.25, 0.18, 18), glow(palette.glow), 0, y, 0, { shadow: false });
        model.add(ring);
        pulse.push(ring);
      }
      model.add(part(cyl(1.2, 1.6, 1.0, 12), cream, 0, 4.3, 0, { outline: true }));
      // Lightning panel
      const panel = new THREE.Group();
      panel.position.set(front * 2.4, 1.6, 0);
      panel.add(part(box(0.2, 1.6, 1.4), toon(PALETTE.yellow), 0, 0, 0, { outline: true }));
      const bolt = new THREE.Shape();
      bolt.moveTo(0.1, 0.6);
      bolt.lineTo(-0.25, 0.0);
      bolt.lineTo(0.0, 0.0);
      bolt.lineTo(-0.15, -0.6);
      bolt.lineTo(0.3, 0.1);
      bolt.lineTo(0.05, 0.1);
      bolt.closePath();
      const boltMesh = new THREE.Mesh(new THREE.ShapeGeometry(bolt), new THREE.MeshBasicMaterial({ color: PALETTE.rubber, side: THREE.DoubleSide }));
      boltMesh.rotation.y = front > 0 ? Math.PI / 2 : -Math.PI / 2;
      boltMesh.position.x = front * 0.11;
      panel.add(boltMesh);
      model.add(panel);
      for (const z of [-1, 1]) model.add(part(cyl(0.6, 0.6, 2.2, 10), cream, -front * 2.4, 1.1, z * 1.4, { outline: true }));
      height = 5.5;
    }

    // Construction scaffold (shown while building)
    const scaffold = new THREE.Group();
    const s = padSpec ? padSpec.radius * 0.95 : type === 'command_center' ? 3.8 : type === 'factory' ? 3.4 : 2.9;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) scaffold.add(part(box(0.2, height * 0.8, 0.2), toon(PALETTE.yellow), sx * s, height * 0.4, sz * s));
    }
    for (const y of [1.5, 3.2]) {
      scaffold.add(part(box(s * 2, 0.15, 0.15), toon(PALETTE.yellow), 0, y, s));
      scaffold.add(part(box(s * 2, 0.15, 0.15), toon(PALETTE.yellow), 0, y, -s));
    }
    scaffold.visible = false;
    root.add(scaffold);
    void dark;

    return { root, model, scaffold, turret, spinners, pulse, conveyor, height };
  }

  public static createResourcePatch(radius: number): { root: THREE.Group; crystals: THREE.Object3D[] } {
    const root = new THREE.Group();
    const ground = new THREE.Mesh(cyl(radius * 1.25, radius * 1.35, 0.08, 20), toon('#c9b48a'));
    ground.position.y = 0.04;
    ground.receiveShadow = true;
    root.add(ground);
    const crystals: THREE.Object3D[] = [];
    const count = Math.round(radius * 3.2);
    const mats = [toon('#8ea2b8'), toon('#a9bccf'), toon('#7d8fa3')];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const r = Math.random() * radius * 0.9;
      const c = part(geoCrystal(), mats[i % 3], Math.cos(a) * r, 0.5, Math.sin(a) * r, { outline: true });
      const sc = 2.2 + Math.random() * 2.2;
      c.scale.set(sc, sc * (1.2 + Math.random() * 0.8), sc);
      c.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.5);
      root.add(c);
      crystals.push(c);
    }
    return { root, crystals };
  }

  public static createScrap(team: TeamPalette): THREE.Group {
    const g = new THREE.Group();
    const mats = [toon(PALETTE.steel), toon(PALETTE.steelDark), toon(team.dark)];
    for (let i = 0; i < 5; i++) {
      const p = part(box(0.3 + Math.random() * 0.4, 0.2 + Math.random() * 0.3, 0.3 + Math.random() * 0.4), mats[i % 3], (Math.random() - 0.5) * 1.4, 0.15, (Math.random() - 0.5) * 1.4);
      p.rotation.set(Math.random(), Math.random() * 3, Math.random());
      g.add(p);
    }
    return g;
  }
}
