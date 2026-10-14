import * as THREE from 'three';
import { GAME_BALANCE } from '../config/balance';
import { GameState } from '../engine/GameState';
import { Building, GameUnit, Projectile, ResourcePatch, ScrapWreckage } from '../types/game';
import { RobotMeshFactory } from './RobotMeshFactory';

export class SceneManager {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;

  private unitMeshes: Map<string, THREE.Group> = new Map();
  private buildingMeshes: Map<string, THREE.Group> = new Map();
  private resourceMeshes: Map<string, THREE.Group> = new Map();
  private scrapMeshes: Map<string, THREE.Group> = new Map();
  private projectileMeshes: Map<string, THREE.Mesh> = new Map();

  private isDragging = false;
  private lastMousePos = { x: 0, y: 0 };
  private cameraTarget = new THREE.Vector3(GAME_BALANCE.MAP_WIDTH / 2, 0, GAME_BALANCE.MAP_HEIGHT / 2);
  private cameraOffset = new THREE.Vector3(0, 42, 38);

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c121e');
    this.scene.fog = new THREE.FogExp2('#0c121e', 0.007);

    // 2. Camera (Isometric Perspective)
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 1, 500);
    this.updateCameraPosition();

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // 4. Lights
    this.setupLighting();

    // 5. World Ground & Grid
    this.setupWorld();

    // 6. Event listeners
    this.setupControls();
  }

  private setupLighting() {
    // Ambient light
    const ambient = new THREE.AmbientLight('#7c8fa6', 1.2);
    this.scene.add(ambient);

    // Sun light (warm cartoon sunlight)
    const sun = new THREE.DirectionalLight('#fff5e6', 2.0);
    sun.position.set(60, 80, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 200;
    const d = 60;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    this.scene.add(sun);

    // Blue fill light
    const fill = new THREE.DirectionalLight('#38bdf8', 0.6);
    fill.position.set(-40, 30, -30);
    this.scene.add(fill);
  }

  private setupWorld() {
    // Ground Terrain (Warcraft cartoon style grid)
    const groundGeo = new THREE.PlaneGeometry(GAME_BALANCE.MAP_WIDTH + 20, GAME_BALANCE.MAP_HEIGHT + 20);
    const groundMat = new THREE.MeshStandardMaterial({
      color: '#1a2233',
      roughness: 0.85,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(GAME_BALANCE.MAP_WIDTH / 2, -0.05, GAME_BALANCE.MAP_HEIGHT / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid Overlay
    const grid = new THREE.GridHelper(GAME_BALANCE.MAP_WIDTH, 50, '#2d3b55', '#1d273a');
    grid.position.set(GAME_BALANCE.MAP_WIDTH / 2, 0.01, GAME_BALANCE.MAP_HEIGHT / 2);
    this.scene.add(grid);

    // Center Frontline demarcation line
    const frontlineGeo = new THREE.BoxGeometry(0.4, 0.1, GAME_BALANCE.MAP_HEIGHT);
    const frontlineMat = new THREE.MeshBasicMaterial({ color: '#f59e0b', transparent: true, opacity: 0.25 });
    const frontline = new THREE.Mesh(frontlineGeo, frontlineMat);
    frontline.position.set(GAME_BALANCE.FRONTLINE_CENTER_X, 0.02, GAME_BALANCE.MAP_HEIGHT / 2);
    this.scene.add(frontline);
  }

  private setupControls() {
    const el = this.renderer.domElement;

    el.addEventListener('mousedown', e => {
      if (e.button === 0 || e.button === 2) {
        this.isDragging = true;
        this.lastMousePos = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    el.addEventListener('mousemove', e => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMousePos.x;
      const dy = e.clientY - this.lastMousePos.y;
      this.lastMousePos = { x: e.clientX, y: e.clientY };

      const panSpeed = 0.08;
      this.cameraTarget.x -= dx * panSpeed;
      this.cameraTarget.z -= dy * panSpeed;

      // Clamp to map bounds
      this.cameraTarget.x = Math.max(10, Math.min(GAME_BALANCE.MAP_WIDTH - 10, this.cameraTarget.x));
      this.cameraTarget.z = Math.max(10, Math.min(GAME_BALANCE.MAP_HEIGHT - 10, this.cameraTarget.z));

      this.updateCameraPosition();
    });

    el.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomSpeed = 0.05;
      const factor = 1 + e.deltaY * zoomSpeed * 0.02;
      this.cameraOffset.multiplyScalar(Math.max(0.6, Math.min(1.6, factor)));
      this.cameraOffset.y = Math.max(18, Math.min(80, this.cameraOffset.y));
      this.cameraOffset.z = Math.max(16, Math.min(75, this.cameraOffset.z));
      this.updateCameraPosition();
    }, { passive: false });

    // Keyboard Pan
    window.addEventListener('keydown', e => {
      const step = 2.5;
      if (e.key === 'a' || e.key === 'ArrowLeft') this.cameraTarget.x -= step;
      if (e.key === 'd' || e.key === 'ArrowRight') this.cameraTarget.x += step;
      if (e.key === 'w' || e.key === 'ArrowUp') this.cameraTarget.z -= step;
      if (e.key === 's' || e.key === 'ArrowDown') this.cameraTarget.z += step;
      this.updateCameraPosition();
    });

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private updateCameraPosition() {
    this.camera.position.copy(this.cameraTarget).add(this.cameraOffset);
    this.camera.lookAt(this.cameraTarget);
  }

  public render(state: GameState) {
    this.syncBuildings(state.buildings);
    this.syncResources(state.resourcePatches);
    this.syncScrap(state.scrapPiles);
    this.syncUnits(state.units);
    this.syncProjectiles(state.projectiles);

    this.renderer.render(this.scene, this.camera);
  }

  private syncBuildings(buildings: Building[]) {
    const currentIds = new Set<string>();

    for (const b of buildings) {
      currentIds.add(b.id);
      let mesh = this.buildingMeshes.get(b.id);

      if (!mesh) {
        mesh = this.createBuildingMesh(b);
        this.scene.add(mesh);
        this.buildingMeshes.set(b.id, mesh);
      }

      mesh.position.set(b.pos.x, 0, b.pos.y);

      // Health scale indicator
      const hpRatio = Math.max(0, b.hp / b.maxHp);
      const hpBar = mesh.getObjectByName('hp_bar');
      if (hpBar) {
        hpBar.scale.x = hpRatio;
      }
    }

    for (const [id, mesh] of this.buildingMeshes.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        this.buildingMeshes.delete(id);
      }
    }
  }

  private createBuildingMesh(b: Building): THREE.Group {
    const group = new THREE.Group();
    const isPlayer = b.team === 'player';
    const factionMat = new THREE.MeshStandardMaterial({
      color: isPlayer ? '#2563eb' : '#dc2626',
      roughness: 0.3,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.6 });

    if (b.type === 'command_center') {
      // Big HQ Fortress
      const base = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 7), darkMat);
      base.position.y = 1.5;
      base.castShadow = true;
      base.receiveShadow = true;

      const dome = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.2, 2.5, 8), factionMat);
      dome.position.y = 4.2;
      dome.castShadow = true;

      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.5, 6), darkMat);
      antenna.position.set(2, 6.5, 2);

      group.add(base, dome, antenna);

    } else if (b.type === 'factory') {
      // Factory with smokestack
      const base = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 5), darkMat);
      base.position.y = 1.3;
      base.castShadow = true;

      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.8, 4.2), factionMat);
      roof.position.y = 2.8;

      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 8), darkMat);
      stack.position.set(-1.8, 3.5, 1);

      group.add(base, roof, stack);

    } else {
      // Power plant
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 2.2, 12), darkMat);
      base.position.y = 1.1;
      base.castShadow = true;

      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(2.2, 0.4, 8, 16),
        new THREE.MeshBasicMaterial({ color: isPlayer ? '#00f0ff' : '#ff4444' })
      );
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 2.4;

      group.add(base, coil);
    }

    // Health Bar overhead
    const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4), new THREE.MeshBasicMaterial({ color: '#000000' }));
    hpBg.position.set(0, 6.5, 0);
    hpBg.rotation.x = -Math.PI / 4;

    const hpBar = new THREE.Mesh(
      new THREE.PlaneGeometry(3.9, 0.3),
      new THREE.MeshBasicMaterial({ color: isPlayer ? '#22c55e' : '#ef4444' })
    );
    hpBar.name = 'hp_bar';
    hpBar.position.set(0, 6.5, 0.01);
    hpBar.rotation.x = -Math.PI / 4;

    group.add(hpBg, hpBar);

    return group;
  }

  private syncResources(patches: ResourcePatch[]) {
    for (const p of patches) {
      let mesh = this.resourceMeshes.get(p.id);
      if (!mesh) {
        mesh = new THREE.Group();
        // Crystal / Ore Clusters
        for (let i = 0; i < 7; i++) {
          const crystal = new THREE.Mesh(
            new THREE.ConeGeometry(0.8 + Math.random() * 0.4, 2.5 + Math.random() * 1.5, 5),
            new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.2, metalness: 0.8 })
          );
          crystal.position.set((Math.random() - 0.5) * p.radius * 1.4, 1.2, (Math.random() - 0.5) * p.radius * 1.4);
          crystal.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
          mesh.add(crystal);
        }
        mesh.position.set(p.pos.x, 0, p.pos.y);
        this.scene.add(mesh);
        this.resourceMeshes.set(p.id, mesh);
      }

      // Scale down when depleted
      const ratio = Math.max(0.2, p.metalRemaining / p.maxMetal);
      mesh.scale.set(ratio, ratio, ratio);
    }
  }

  private syncScrap(scraps: ScrapWreckage[]) {
    const currentIds = new Set<string>();

    for (const s of scraps) {
      currentIds.add(s.id);
      let mesh = this.scrapMeshes.get(s.id);
      if (!mesh) {
        mesh = new THREE.Group();
        const pile = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.9, 0),
          new THREE.MeshStandardMaterial({ color: '#d97706', roughness: 0.8, metalness: 0.5 })
        );
        pile.position.y = 0.4;
        mesh.add(pile);

        mesh.position.set(s.pos.x, 0, s.pos.y);
        this.scene.add(mesh);
        this.scrapMeshes.set(s.id, mesh);
      }
    }

    for (const [id, mesh] of this.scrapMeshes.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        this.scrapMeshes.delete(id);
      }
    }
  }

  private syncUnits(units: GameUnit[]) {
    const currentIds = new Set<string>();

    for (const u of units) {
      if (u.state === 'dead') continue;
      currentIds.add(u.id);

      let mesh = this.unitMeshes.get(u.id);
      const teamColor = u.team === 'player' ? '#3b82f6' : '#ef4444';

      if (!mesh) {
        if (u.kind === 'combat') {
          mesh = RobotMeshFactory.createRobotMesh(u.design, teamColor);
        } else {
          mesh = RobotMeshFactory.createHarvesterMesh(teamColor);
        }

        // Add overhead HP bar
        const hpBg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicMaterial({ color: '#0f172a' }));
        hpBg.position.set(0, 3.2, 0);
        hpBg.rotation.x = -Math.PI / 4;

        const hpBar = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 0.16),
          new THREE.MeshBasicMaterial({ color: u.team === 'player' ? '#22c55e' : '#ef4444' })
        );
        hpBar.name = 'hp_bar';
        hpBar.position.set(0, 3.2, 0.01);
        hpBar.rotation.x = -Math.PI / 4;

        mesh.add(hpBg, hpBar);

        this.scene.add(mesh);
        this.unitMeshes.set(u.id, mesh);
      }

      // Smooth position interpolation
      mesh.position.set(u.pos.x, 0, u.pos.y);

      // Facing orientation (face right for player, left for enemy by default)
      mesh.rotation.y = u.team === 'player' ? Math.PI / 2 : -Math.PI / 2;

      // Update HP bar scale
      const hpRatio = Math.max(0, u.hp / u.maxHp);
      const hpBar = mesh.getObjectByName('hp_bar');
      if (hpBar) {
        hpBar.scale.x = hpRatio;
      }
    }

    for (const [id, mesh] of this.unitMeshes.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        this.unitMeshes.delete(id);
      }
    }
  }

  private syncProjectiles(projectiles: Projectile[]) {
    const currentIds = new Set<string>();

    for (const p of projectiles) {
      currentIds.add(p.id);
      let mesh = this.projectileMeshes.get(p.id);

      if (!mesh) {
        const isExplosive = p.type === 'explosive';
        const geo = isExplosive
          ? new THREE.SphereGeometry(0.35, 8, 8)
          : new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6);

        const color = p.team === 'player' ? '#38bdf8' : '#f87171';
        const mat = new THREE.MeshBasicMaterial({ color });
        mesh = new THREE.Mesh(geo, mat);
        if (!isExplosive) {
          mesh.rotation.z = Math.PI / 2;
        }

        this.scene.add(mesh);
        this.projectileMeshes.set(p.id, mesh);
      }

      mesh.position.set(p.currentPos.x, 1.4, p.currentPos.y);
    }

    for (const [id, mesh] of this.projectileMeshes.entries()) {
      if (!currentIds.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }
  }

  public dispose() {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
