import * as THREE from 'three';
import { RobotDesign } from '../types/robot';

export class RobotMeshFactory {
  private static materialsCache: Map<string, THREE.Material> = new Map();

  private static getToonMaterial(color: string | number, roughness = 0.4): THREE.MeshStandardMaterial {
    const key = `${color}_${roughness}`;
    if (!this.materialsCache.has(key)) {
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: 0.3,
      });
      this.materialsCache.set(key, mat);
    }
    return this.materialsCache.get(key) as THREE.MeshStandardMaterial;
  }

  public static createRobotMesh(design: RobotDesign, teamColor: string): THREE.Group {
    const group = new THREE.Group();
    const darkMetal = this.getToonMaterial('#2b303c', 0.6);
    const factionMat = this.getToonMaterial(teamColor, 0.3);
    const gunMetal = this.getToonMaterial('#1f2937', 0.2);
    const glowEnergy = new THREE.MeshBasicMaterial({ color: teamColor === '#ef4444' ? 0xff4444 : 0x00f0ff });

    // 1. Chassis Base
    const chassisGroup = new THREE.Group();

    if (design.chassisId === 'light_biped') {
      // Bipedal scout legs
      const legGeo = new THREE.BoxGeometry(0.3, 1.2, 0.4);
      const leftLeg = new THREE.Mesh(legGeo, darkMetal);
      leftLeg.position.set(-0.6, 0.6, 0);
      leftLeg.rotation.x = 0.2;
      const rightLeg = leftLeg.clone();
      rightLeg.position.set(0.6, 0.6, 0);
      chassisGroup.add(leftLeg, rightLeg);

      // Foot pads
      const footGeo = new THREE.BoxGeometry(0.5, 0.2, 0.8);
      const leftFoot = new THREE.Mesh(footGeo, darkMetal);
      leftFoot.position.set(-0.6, 0.1, 0.2);
      const rightFoot = leftFoot.clone();
      rightFoot.position.set(0.6, 0.1, 0.2);
      chassisGroup.add(leftFoot, rightFoot);

      // Main Scout Body
      const bodyGeo = new THREE.CylinderGeometry(0.7, 0.9, 1.1, 6);
      const body = new THREE.Mesh(bodyGeo, factionMat);
      body.position.y = 1.6;
      chassisGroup.add(body);

    } else if (design.chassisId === 'medium_tracked') {
      // Tank Treads
      const treadGeo = new THREE.BoxGeometry(0.5, 0.6, 2.2);
      const leftTread = new THREE.Mesh(treadGeo, darkMetal);
      leftTread.position.set(-0.9, 0.3, 0);
      const rightTread = leftTread.clone();
      rightTread.position.set(0.9, 0.3, 0);
      chassisGroup.add(leftTread, rightTread);

      // Tank Hull
      const hullGeo = new THREE.BoxGeometry(1.4, 0.7, 2.0);
      const hull = new THREE.Mesh(hullGeo, factionMat);
      hull.position.y = 0.65;
      chassisGroup.add(hull);

      // Turret ring
      const ringGeo = new THREE.CylinderGeometry(0.65, 0.75, 0.5, 8);
      const ring = new THREE.Mesh(ringGeo, darkMetal);
      ring.position.y = 1.2;
      chassisGroup.add(ring);

    } else {
      // Heavy Quad-Walker (Spider fortress)
      const legPositions = [
        [-1.2, 0, -1.2],
        [1.2, 0, -1.2],
        [-1.2, 0, 1.2],
        [1.2, 0, 1.2],
      ];
      legPositions.forEach(([x, , z]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.4, 6), darkMetal);
        leg.position.set(x, 0.7, z);
        leg.rotation.z = x > 0 ? -0.3 : 0.3;
        leg.rotation.x = z > 0 ? 0.3 : -0.3;
        chassisGroup.add(leg);
      });

      // Heavy Armored Hull
      const hullGeo = new THREE.BoxGeometry(2.2, 1.1, 2.2);
      const hull = new THREE.Mesh(hullGeo, factionMat);
      hull.position.y = 1.3;
      chassisGroup.add(hull);
    }

    group.add(chassisGroup);

    // 2. Armor Add-ons
    const hasReinforced = design.modules.includes('reinforced_steel');
    const hasReactive = design.modules.includes('sloped_reactive');

    if (hasReactive) {
      // Frontal sloped heavy reactive plates
      const plateGeo = new THREE.BoxGeometry(1.6, 0.6, 0.3);
      const plate = new THREE.Mesh(plateGeo, darkMetal);
      plate.position.set(0, 1.1, 1.1);
      plate.rotation.x = 0.4;
      group.add(plate);
    } else if (hasReinforced) {
      // Shoulder armor guards
      const guardGeo = new THREE.BoxGeometry(0.3, 0.7, 0.8);
      const leftGuard = new THREE.Mesh(guardGeo, darkMetal);
      leftGuard.position.set(-1.1, 1.3, 0);
      const rightGuard = leftGuard.clone();
      rightGuard.position.set(1.1, 1.3, 0);
      group.add(leftGuard, rightGuard);
    }

    // 3. Weapons
    const hasCannon = design.modules.includes('heavy_siege_cannon');
    const hasPlasma = design.modules.includes('plasma_blasters');
    const hasAutocannon = design.modules.includes('autocannon_20mm');
    const hasRailgun = design.modules.includes('sniper_railgun');
    const hasSaw = design.modules.includes('melee_buzzsaw');

    const weaponGroup = new THREE.Group();
    weaponGroup.position.set(0, 1.5, 0);

    if (hasCannon) {
      // Massive Siege Cannon Barrel
      const barrelGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.6, 8);
      const barrel = new THREE.Mesh(barrelGeo, gunMetal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.1, 1.3);

      const muzzleGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 8);
      const muzzle = new THREE.Mesh(muzzleGeo, darkMetal);
      muzzle.rotation.x = Math.PI / 2;
      muzzle.position.set(0, 0.1, 2.5);

      weaponGroup.add(barrel, muzzle);
    } else if (hasPlasma) {
      // Dual plasma coils
      [-0.45, 0.45].forEach(x => {
        const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.6, 8), gunMetal);
        coil.rotation.x = Math.PI / 2;
        coil.position.set(x, 0, 0.8);

        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 8), glowEnergy);
        glow.rotation.x = Math.PI / 2;
        glow.position.set(x, 0, 0.9);

        weaponGroup.add(coil, glow);
      });
    } else if (hasRailgun) {
      // Ultra-long railgun with dual rails
      const railGeo = new THREE.BoxGeometry(0.08, 0.08, 3.2);
      const topRail = new THREE.Mesh(railGeo, gunMetal);
      topRail.position.set(0, 0.1, 1.6);
      const botRail = topRail.clone();
      botRail.position.set(0, -0.1, 1.6);
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 3.0), glowEnergy);
      core.position.set(0, 0, 1.5);
      weaponGroup.add(topRail, botRail, core);
    } else if (hasSaw) {
      // Rotating saw blade
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.4), darkMetal);
      arm.position.set(0.6, 0, 0.7);
      const sawGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.06, 12);
      const saw = new THREE.Mesh(sawGeo, gunMetal);
      saw.rotation.z = Math.PI / 2;
      saw.position.set(0.6, 0, 1.4);
      weaponGroup.add(arm, saw);
    } else {
      // Default autocannon
      [-0.35, 0.35].forEach(x => {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 6), gunMetal);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(x, 0, 0.7);
        weaponGroup.add(barrel);
      });
    }

    group.add(weaponGroup);

    // 4. Utility accessories (Radar dish, Exhaust pipes)
    if (design.modules.includes('radar_sensor')) {
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.1, 0.1, 8), glowEnergy);
      dish.position.set(-0.5, 2.2, -0.4);
      dish.rotation.x = -0.4;
      group.add(dish);
    }

    if (design.modules.includes('micro_turbine')) {
      [-0.4, 0.4].forEach(x => {
        const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 6), darkMetal);
        exhaust.position.set(x, 1.6, -0.9);
        exhaust.rotation.x = -0.3;
        group.add(exhaust);
      });
    }

    // Cast and receive shadows
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }

  public static createHarvesterMesh(teamColor: string): THREE.Group {
    const group = new THREE.Group();
    const yellowMat = this.getToonMaterial('#eab308', 0.4);
    const darkMetal = this.getToonMaterial('#334155', 0.6);
    const teamMat = this.getToonMaterial(teamColor, 0.3);

    // Tread base
    const tread = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 1.6), darkMetal);
    tread.position.y = 0.2;
    group.add(tread);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.0), yellowMat);
    cabin.position.set(0, 0.8, -0.2);
    group.add(cabin);

    // Decal
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.2, 0.3), teamMat);
    stripe.position.set(0, 0.8, 0.1);
    group.add(stripe);

    // Front mining drills
    [-0.35, 0.35].forEach(x => {
      const drill = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 6), darkMetal);
      drill.rotation.x = Math.PI / 2;
      drill.position.set(x, 0.5, 0.8);
      group.add(drill);
    });

    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return group;
  }
}
