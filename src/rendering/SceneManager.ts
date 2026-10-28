import * as THREE from 'three';
import { GAME_BALANCE, TEAM_COLORS } from '../config/balance';
import { GameState } from '../engine/GameState';
import { TerrainGrid } from '../engine/terrain/TerrainGrid';
import { Building, GameUnit, Projectile, ResourcePatch, ScrapWreckage, Team, Vector2D } from '../types/game';
import { BuildingMeshFactory, BuildingRig } from './BuildingMeshFactory';
import { Effects } from './Effects';
import { RobotMeshFactory, RobotRig } from './RobotMeshFactory';
import { TerrainView } from './TerrainView';
import { FogView } from './FogView';
import { FOG_CELL } from '../engine/Vision';
import { box, glow, sphere } from './toon';

interface UnitView {
  rig: RobotRig;
  hpBg: THREE.Sprite;
  hpFill: THREE.Sprite;
  phase: number;
}

interface BuildingView {
  rig: BuildingRig;
  hpBg: THREE.Sprite;
  hpFill: THREE.Sprite;
}

const W = GAME_BALANCE.MAP_WIDTH;
const H = GAME_BALANCE.MAP_HEIGHT;
const YAW = THREE.MathUtils.degToRad(35);
const PITCH = THREE.MathUtils.degToRad(42);
/** Half-height of the view in world units: closest and farthest zoom (wheel and pinch). */
const clampZoom = (z: number) => Math.max(10, Math.min(46, z));

/** Cartoon isometric renderer (brief §7): sand field with groves and rocks, faction colours, readable silhouettes. */
export class SceneManager {
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private effects: Effects;
  private sun!: THREE.DirectionalLight;

  private units = new Map<string, UnitView>();
  private buildings = new Map<string, BuildingView>();
  private patches = new Map<string, { root: THREE.Group; crystals: THREE.Object3D[] }>();
  private scraps = new Map<string, THREE.Group>();
  private projectiles = new Map<string, THREE.Object3D>();
  private rallyMarkers: Record<Team, THREE.Group> = {} as Record<Team, THREE.Group>;
  private padMarkers = new Map<string, THREE.Object3D>();
  private terrainView: TerrainView | null = null;
  private terrainRef: TerrainGrid | null = null;
  private fog: FogView;
  /** The side whose eyes the camera uses (fog of war); null — the spectator sees everything. */
  private fogTeam: Team | null = 'player';

  private target = new THREE.Vector3(30, 0, 33);
  private zoom = 30; // half-height of the view in world units
  private dragging = false;
  private dragStart: THREE.Vector3 | null = null;
  /** Fingers (or the mouse) on the canvas: one drags the map, two pinch to zoom. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { spread: number; zoom: number } | null = null;
  private keys = new Set<string>();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  private time = 0;
  private disposed = false;

  constructor(private container: HTMLElement) {
    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.OrthographicCamera(-this.zoom * aspect, this.zoom * aspect, this.zoom, -this.zoom, 0.1, 600);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = 'block';
    // the game handles touch itself: no page scroll, pinch-zoom or pointercancel over the map
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#e9d6aa');
    this.setupLights();
    this.setupGround();
    this.setupRallyMarkers();
    this.fog = new FogView(Math.ceil(W / FOG_CELL), Math.ceil(H / FOG_CELL), W, H);
    this.scene.add(this.fog.mesh);
    this.effects = new Effects(this.scene);
    this.updateCamera();
    this.bindControls();
  }

  // ───────────────────────────── Setup ─────────────────────────────

  private setupLights() {
    this.scene.add(new THREE.HemisphereLight('#fff6e0', '#c8a878', 1.6));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(W / 2 - 40, 90, H / 2 - 50);
    sun.target.position.set(W / 2, 0, H / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = 75;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  private setupGround() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e7d1a1';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 30 + Math.random() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() > 0.5;
      g.addColorStop(0, dark ? 'rgba(196,164,112,0.35)' : 'rgba(250,232,190,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);
    }
    for (let i = 0; i < 2500; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(170,140,95,0.35)' : 'rgba(255,245,215,0.4)';
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 160, H + 160),
      new THREE.MeshLambertMaterial({ map: tex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Subtle map border so the playable area reads clearly
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.01, H)),
      new THREE.LineBasicMaterial({ color: '#b89a68', transparent: true, opacity: 0.6 }),
    );
    border.position.set(W / 2, 0.02, H / 2);
    this.scene.add(border);
  }

  private setupRallyMarkers() {
    for (const team of ['player', 'enemy'] as Team[]) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 32), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team].main, transparent: true, opacity: 0.35 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      this.scene.add(g);
      this.rallyMarkers[team] = g;
    }
  }

  // ───────────────────────────── Camera & controls ─────────────────────────────

  private updateCamera() {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    this.camera.left = -this.zoom * aspect;
    this.camera.right = this.zoom * aspect;
    this.camera.top = this.zoom;
    this.camera.bottom = -this.zoom;
    const dist = 150;
    const offset = new THREE.Vector3(-Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).multiplyScalar(dist);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  private groundPointAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, p) ? p : null;
  }

  private clampTarget() {
    this.target.x = Math.max(-5, Math.min(W + 5, this.target.x));
    this.target.z = Math.max(-5, Math.min(H + 5, this.target.z));
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.renderer.domElement.setPointerCapture(e.pointerId);
    if (this.pointers.size >= 2) {
      // a second finger turns the drag into a pinch
      this.dragging = false;
      this.dragStart = null;
      this.pinch = { spread: this.pointerSpread(), zoom: this.zoom };
      return;
    }
    this.dragging = true;
    this.dragStart = this.groundPointAt(e.clientX, e.clientY);
  };

  /** Distance between the first two fingers on the canvas, in CSS pixels. */
  private pointerSpread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) {
      const spread = this.pointerSpread();
      if (spread > 0 && this.pinch.spread > 0) {
        this.zoom = clampZoom((this.pinch.zoom * this.pinch.spread) / spread);
        this.updateCamera();
      }
      return;
    }
    if (!this.dragging || !this.dragStart) return;
    const now = this.groundPointAt(e.clientX, e.clientY);
    if (!now) return;
    this.target.add(this.dragStart.clone().sub(now));
    this.clampTarget();
    this.updateCamera();
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    try {
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.pinch && this.pointers.size === 1) {
      // one finger left after a pinch: it drags the map on from where it is
      const [rest] = [...this.pointers.values()];
      this.pinch = null;
      this.dragging = true;
      this.dragStart = this.groundPointAt(rest.x, rest.y);
      return;
    }
    if (this.pointers.size > 0) return;
    this.pinch = null;
    this.dragging = false;
    this.dragStart = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom = clampZoom(this.zoom * (1 + Math.sign(e.deltaY) * 0.1));
    this.updateCamera();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    this.keys.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onContext = (e: Event) => e.preventDefault();

  private onResize = () => {
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.updateCamera();
  };

  private bindControls() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('resize', this.onResize);
  }

  private applyKeyboardPan(dt: number) {
    if (!this.keys.size) return;
    const right = new THREE.Vector3(Math.cos(YAW), 0, Math.sin(YAW));
    const forward = new THREE.Vector3(Math.sin(YAW), 0, -Math.cos(YAW));
    const v = new THREE.Vector3();
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft') || k.has('ф')) v.sub(right);
    if (k.has('d') || k.has('arrowright') || k.has('в')) v.add(right);
    if (k.has('w') || k.has('arrowup') || k.has('ц')) v.add(forward);
    if (k.has('s') || k.has('arrowdown') || k.has('ы')) v.sub(forward);
    if (v.lengthSq() === 0) return;
    v.normalize().multiplyScalar(this.zoom * 1.6 * dt);
    this.target.add(v);
    this.clampTarget();
    this.updateCamera();
  }

  /** Fog of war for this side's view, or none (AI vs AI spectating). */
  setFogTeam(team: Team | null) {
    this.fogTeam = team;
  }

  /** Centre the camera on a map position (minimap clicks). */
  /** Whole battlefield in view (AI-vs-AI spectating). */
  overview() {
    this.zoom = 38;
    this.focus(GAME_BALANCE.MAP_WIDTH / 2, GAME_BALANCE.MAP_HEIGHT / 2);
  }

  focus(x: number, y: number) {
    this.target.set(x, 0, y);
    this.clampTarget();
    this.updateCamera();
  }

  /** Ground-plane corners of the current view, for the minimap frame. */
  viewportCorners(): Vector2D[] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pts = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
    ];
    return pts
      .map(([x, y]) => this.groundPointAt(x, y))
      .filter((p): p is THREE.Vector3 => !!p)
      .map(p => ({ x: p.x, y: p.z }));
  }

  // ───────────────────────────── Frame ─────────────────────────────

  render(state: GameState, dt: number) {
    if (this.disposed) return;
    this.time += dt;
    this.applyKeyboardPan(dt);
    const lookup = new Map<string, GameUnit | Building>();
    for (const u of state.units) lookup.set(u.id, u);
    for (const b of state.buildings) lookup.set(b.id, b);

    if (state.terrain !== this.terrainRef) this.syncTerrain(state.terrain);
    this.syncPatches(state.resourcePatches);
    this.syncPads(state);
    this.syncScrap(state.scrapPiles);
    this.syncBuildings(state, dt);
    const fogTeam = state.vision.enabled ? this.fogTeam : null;
    // enemy machines out of sight are not drawn, nor are their shots and flashes in the fog
    const hidden = (u: GameUnit) => !!fogTeam && u.team !== fogTeam && !state.vision.sees(fogTeam, u.id);
    const fogged = (team: Team | 'neutral', x: number, y: number) =>
      !!fogTeam && team !== fogTeam && !state.vision.pointVisible(state, fogTeam, x, y);
    this.fog.update(fogTeam ? state.vision.fogGrid(state, fogTeam) : null, dt);
    this.syncUnits(state.units, lookup, state.gameTime, dt, hidden);
    this.syncProjectiles(state.projectiles, fogged);
    for (const team of ['player', 'enemy'] as Team[]) {
      const m = this.rallyMarkers[team];
      const p = state.rallyPoint(team);
      m.position.set(p.x, 0, p.y);
      m.visible = team === 'player' && state.teams.player.plan.stance === 'advance';
      m.scale.setScalar(1 + Math.sin(this.time * 3) * 0.06);
    }
    this.effects.ingest(state.effects, e => !fogged(e.team, e.pos.x, e.pos.y));
    this.effects.update(state.isPaused ? 0 : dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Clears all world objects when a new match starts. */
  reset() {
    for (const v of this.units.values()) this.scene.remove(v.rig.root, v.hpBg, v.hpFill);
    for (const v of this.buildings.values()) this.scene.remove(v.rig.root, v.hpBg, v.hpFill);
    for (const v of this.patches.values()) this.scene.remove(v.root);
    for (const v of this.scraps.values()) this.scene.remove(v);
    for (const v of this.projectiles.values()) this.scene.remove(v);
    this.units.clear();
    this.buildings.clear();
    this.patches.clear();
    this.scraps.clear();
    this.projectiles.clear();
    this.effects.reset();
    this.target.set(30, 0, 33);
    this.updateCamera();
  }

  private makeBar(color: string): { bg: THREE.Sprite; fill: THREE.Sprite } {
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#2b2622', depthTest: false, transparent: true, opacity: 0.85 }));
    const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false }));
    bg.center.set(0, 0.5);
    fill.center.set(0, 0.5);
    bg.renderOrder = 10;
    fill.renderOrder = 11;
    this.scene.add(bg, fill);
    return { bg, fill };
  }

  private placeBar(bg: THREE.Sprite, fill: THREE.Sprite, x: number, y: number, z: number, width: number, ratio: number, visible: boolean) {
    bg.visible = fill.visible = visible;
    if (!visible) return;
    const h = Math.max(0.28, this.zoom * 0.012);
    bg.scale.set(width + 0.16, h + 0.14, 1);
    fill.scale.set(Math.max(0.01, width * ratio), h, 1);
    // Offset left so bars are centred over the object (sprites are anchored at their left edge)
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    bg.position.set(x, y, z).addScaledVector(right, -(width + 0.16) / 2);
    fill.position.set(x, y, z).addScaledVector(right, -width / 2);
    const c = ratio > 0.55 ? '#5bd36a' : ratio > 0.28 ? '#f2c14e' : '#ef5b4c';
    (fill.material as THREE.SpriteMaterial).color.set(c);
  }

  private syncUnits(
    units: GameUnit[],
    lookup: Map<string, GameUnit | Building>,
    gameTime: number,
    dt: number,
    hidden: (u: GameUnit) => boolean,
  ) {
    const alive = new Set<string>();
    for (const u of units) {
      if (u.state === 'dead') continue;
      alive.add(u.id);
      let view = this.units.get(u.id);
      if (!view) {
        const palette = TEAM_COLORS[u.team];
        const rig = u.kind === 'combat' ? RobotMeshFactory.createRobot(u.design, palette) : RobotMeshFactory.createHarvester(palette);
        this.scene.add(rig.root);
        const bar = this.makeBar('#5bd36a');
        view = { rig, hpBg: bar.bg, hpFill: bar.fill, phase: Math.random() * 6 };
        this.units.set(u.id, view);
      }
      const { rig } = view;
      rig.root.visible = !hidden(u);
      if (!rig.root.visible) {
        view.hpBg.visible = view.hpFill.visible = false;
        continue;
      }
      rig.root.position.set(u.pos.x, 0, u.pos.y);
      rig.root.rotation.y = -u.facing;

      // Locomotion
      const moving = u.vel > 0.2;
      if (moving) view.phase += dt * (2.5 + u.vel * 1.4);
      const swing = moving ? Math.sin(view.phase) : 0;
      if (rig.kind === 'biped') {
        rig.legs.forEach((leg, i) => (leg.rotation.z = swing * 0.55 * (i === 0 ? 1 : -1)));
        rig.body.position.y = moving ? Math.abs(Math.sin(view.phase)) * 0.12 : 0;
      } else if (rig.kind === 'quad') {
        rig.legs.forEach((leg, i) => (leg.rotation.z = swing * 0.25 * (i === 0 || i === 3 ? 1 : -1)));
        rig.body.position.y = moving ? Math.abs(Math.sin(view.phase * 2)) * 0.06 : 0;
      } else {
        rig.body.position.y = moving ? Math.sin(view.phase * 3) * 0.03 : 0;
      }
      for (const w of rig.wheels) w.rotation.y += u.vel * dt * 3;
      if (rig.cargo && u.kind === 'harvester') rig.cargo.visible = u.carrying > 5;

      if (u.kind === 'combat') {
        const target = u.targetId ? lookup.get(u.targetId) : undefined;
        if (rig.turret) {
          const desired = target ? Math.atan2(target.pos.y - u.pos.y, target.pos.x - u.pos.x) - u.facing : 0;
          rig.turret.rotation.y += (-desired - rig.turret.rotation.y) * Math.min(1, dt * 8);
        }
        if (rig.saw) rig.saw.rotation.y += dt * (u.state === 'attacking' ? 30 : 4);
        if (rig.gun) {
          const since = gameTime - u.lastShotAt;
          rig.gun.position.x = (rig.kind === 'biped' ? 0.35 : 0.3) - (since < 0.12 ? (0.12 - since) * 2.5 : 0);
        }
      }

      const damaged = u.hp < u.maxHp - 0.5;
      const width = u.kind === 'combat' ? 1.4 + u.radius * 0.6 : 1.4;
      this.placeBar(view.hpBg, view.hpFill, u.pos.x, rig.height + 0.9, u.pos.y, width, u.hp / u.maxHp, damaged);
    }
    for (const [id, view] of this.units) {
      if (!alive.has(id)) {
        this.scene.remove(view.rig.root, view.hpBg, view.hpFill);
        this.units.delete(id);
      }
    }
  }

  private syncBuildings(state: GameState, dt: number) {
    const alive = new Set<string>();
    for (const b of state.buildings) {
      alive.add(b.id);
      let view = this.buildings.get(b.id);
      if (!view) {
        const rig = BuildingMeshFactory.create(b.type, b.team, TEAM_COLORS[b.team]);
        rig.root.position.set(b.pos.x, 0, b.pos.y);
        this.scene.add(rig.root);
        const bar = this.makeBar('#5bd36a');
        view = { rig, hpBg: bar.bg, hpFill: bar.fill };
        this.buildings.set(b.id, view);
      }
      const { rig } = view;
      const built = b.built;
      rig.scaffold.visible = built < 1;
      rig.model.scale.set(1, 0.2 + 0.8 * built, 1);
      for (const s of rig.spinners) s.rotation.y += dt * 0.6;
      for (const [i, p] of rig.pulse.entries()) {
        const k = 1 + Math.sin(this.time * 4 + i) * 0.04 * state.teams[b.team].economy.powerEfficiency;
        p.scale.set(k, 1, k);
      }
      const producing = (!!b.job || !!b.harvesterBuild) && built >= 1 && !b.paused;
      for (const r of rig.conveyor) {
        if (producing) r.position.x = ((r.position.x + 1.5 + dt * 1.2) % 3.6) - 1.5;
      }
      if (rig.turret) {
        let best: GameUnit | null = null;
        let bestD = GAME_BALANCE.HQ_TURRET_RANGE + b.radius;
        for (const u of state.units) {
          if (u.team === b.team) continue;
          // an HQ turret of ours must not point at an enemy hidden by the fog
          if (this.fogTeam && state.vision.enabled && u.team !== this.fogTeam && !state.vision.sees(this.fogTeam, u.id)) continue;
          const d = Math.hypot(u.pos.x - b.pos.x, u.pos.y - b.pos.y);
          if (d < bestD) {
            bestD = d;
            best = u;
          }
        }
        if (best) rig.turret.rotation.y = -Math.atan2(best.pos.y - b.pos.y, best.pos.x - b.pos.x);
        else rig.turret.rotation.y += dt * 0.3;
      }
      const showBar = b.hp < b.maxHp - 1 || built < 1;
      this.placeBar(view.hpBg, view.hpFill, b.pos.x, rig.height * (0.2 + 0.8 * built) + 1.2, b.pos.y, b.radius * 1.4, b.hp / b.maxHp, showBar);
    }
    for (const [id, view] of this.buildings) {
      if (!alive.has(id)) {
        this.scene.remove(view.rig.root, view.hpBg, view.hpFill);
        this.buildings.delete(id);
      }
    }
  }

  /** Rebuilds trees and rocks when a match starts on another map. */
  private syncTerrain(grid: TerrainGrid) {
    if (this.terrainView) {
      this.scene.remove(this.terrainView.root);
      this.terrainView.dispose();
    }
    this.terrainRef = grid;
    this.terrainView = new TerrainView(grid);
    this.scene.add(this.terrainView.root);
  }

  /** Free building pads of the player's side: faint rings that show where turrets, docks and radars go. */
  private syncPads(state: GameState) {
    const taken = new Set(state.buildings.map(b => b.padId).filter(Boolean));
    const live = new Set<string>();
    for (const pad of state.pads) {
      if (pad.team !== 'player') continue;
      live.add(pad.id);
      let m = this.padMarkers.get(pad.id);
      if (!m) {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.1, 28), new THREE.MeshBasicMaterial({ color: TEAM_COLORS.player.main, transparent: true, opacity: 0.35, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.06;
        g.add(ring);
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), new THREE.MeshBasicMaterial({ color: TEAM_COLORS.player.light, transparent: true, opacity: 0.45, depthWrite: false }));
        dot.rotation.x = -Math.PI / 2;
        dot.position.y = 0.07;
        g.add(dot);
        g.position.set(pad.pos.x, 0, pad.pos.y);
        this.scene.add(g);
        this.padMarkers.set(pad.id, g);
        m = g;
      }
      m.visible = !taken.has(pad.id);
    }
    for (const [id, m] of this.padMarkers) {
      if (!live.has(id)) {
        this.scene.remove(m);
        this.padMarkers.delete(id);
      }
    }
  }

  private syncPatches(patches: ResourcePatch[]) {
    for (const p of patches) {
      let v = this.patches.get(p.id);
      if (!v) {
        v = BuildingMeshFactory.createResourcePatch(p.radius, p.resource === 'crystal');
        v.root.position.set(p.pos.x, 0, p.pos.y);
        this.scene.add(v.root);
        this.patches.set(p.id, v);
      }
      const ratio = p.metalRemaining / p.maxMetal;
      const visibleCount = Math.ceil(v.crystals.length * ratio);
      v.crystals.forEach((c, i) => (c.visible = i < visibleCount));
    }
  }

  private syncScrap(scraps: ScrapWreckage[]) {
    const alive = new Set<string>();
    for (const s of scraps) {
      alive.add(s.id);
      if (!this.scraps.has(s.id)) {
        const g = BuildingMeshFactory.createScrap(TEAM_COLORS.player);
        g.position.set(s.pos.x, 0, s.pos.y);
        this.scene.add(g);
        this.scraps.set(s.id, g);
      }
      const g = this.scraps.get(s.id)!;
      g.scale.setScalar(Math.max(0.45, Math.min(1.3, s.metal / 60)));
    }
    for (const [id, g] of this.scraps) {
      if (!alive.has(id)) {
        this.scene.remove(g);
        this.scraps.delete(id);
      }
    }
  }

  private syncProjectiles(list: Projectile[], fogged: (team: Team, x: number, y: number) => boolean) {
    const alive = new Set<string>();
    for (const p of list) {
      alive.add(p.id);
      let mesh = this.projectiles.get(p.id);
      const color = p.kind === 'turret' ? '#ffd24a' : p.team === 'player' ? '#62e8ff' : '#ff6a3d';
      if (!mesh) {
        if (p.kind === 'explosive') mesh = new THREE.Mesh(sphere(0.32, 8), glow('#3a3530'));
        else if (p.kind === 'energy') mesh = new THREE.Mesh(sphere(0.38, 10), glow(color));
        else mesh = new THREE.Mesh(box(1.4, 0.14, 0.14), glow(color));
        this.scene.add(mesh);
        this.projectiles.set(p.id, mesh);
      }
      const arc = p.kind === 'explosive' ? Math.sin(p.progress * Math.PI) * 4 : 0;
      mesh.position.set(p.pos.x, 1.6 + arc, p.pos.y);
      mesh.rotation.y = -Math.atan2(p.to.y - p.from.y, p.to.x - p.from.x);
      mesh.visible = !fogged(p.team, p.pos.x, p.pos.y);
    }
    for (const [id, m] of this.projectiles) {
      if (!alive.has(id)) {
        this.scene.remove(m);
        this.projectiles.delete(id);
      }
    }
  }

  dispose() {
    this.disposed = true;
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('resize', this.onResize);
    this.terrainView?.dispose();
    this.fog.dispose();
    this.renderer.dispose();
    // Remove the canvas: a stale canvas left in the DOM covered the live scene (black screen bug)
    if (el.parentElement) el.parentElement.removeChild(el);
    void this.sun;
  }
}
