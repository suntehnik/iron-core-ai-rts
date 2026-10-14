import { GAME_BALANCE, INITIAL_ENEMY_DESIGN, INITIAL_PLAYER_DESIGN } from '../config/balance';
import {
  Building,
  CombatUnit,
  HarvesterUnit,
  Projectile,
  ResourcePatch,
  ScrapWreckage,
  TacticalDoctrine,
  Team,
  TeamEconomy,
  Vector2D,
} from '../types/game';
import { RobotDesign } from '../types/robot';
import { RobotBuilder } from './RobotBuilder';
import { sounds } from './SoundEffects';

export interface CombatEvent {
  type: 'kill' | 'factory_complete' | 'base_attack' | 'design_changed' | 'overheat';
  text: string;
  timestamp: number;
}

export class GameState {
  public playerEconomy: TeamEconomy;
  public enemyEconomy: TeamEconomy;

  public playerDesign: RobotDesign;
  public enemyDesign: RobotDesign;

  public playerDoctrine: TacticalDoctrine;
  public enemyDoctrine: TacticalDoctrine;

  public units: (CombatUnit | HarvesterUnit)[] = [];
  public buildings: Building[] = [];
  public resourcePatches: ResourcePatch[] = [];
  public scrapPiles: ScrapWreckage[] = [];
  public projectiles: Projectile[] = [];

  public gameTime: number = 0;
  public isPaused: boolean = false;
  public gameOver: 'player_won' | 'enemy_won' | null = null;
  public events: CombatEvent[] = [];

  private nextUnitId: number = 1;
  private nextProjId: number = 1;
  private nextScrapId: number = 1;

  public playerBatchNumber: number = 1;
  public enemyBatchNumber: number = 1;

  constructor() {
    this.playerEconomy = {
      metal: GAME_BALANCE.INITIAL_METAL,
      components: GAME_BALANCE.INITIAL_COMPONENTS,
      powerAvailable: GAME_BALANCE.POWER_PLANT_KW,
      powerConsumed: 120,
      harvestersCount: 2,
      combatBotsCount: 0,
      totalMetalMined: 0,
      totalScrapReclaimed: 0,
    };

    this.enemyEconomy = {
      metal: GAME_BALANCE.INITIAL_METAL,
      components: GAME_BALANCE.INITIAL_COMPONENTS,
      powerAvailable: GAME_BALANCE.POWER_PLANT_KW,
      powerConsumed: 120,
      harvestersCount: 2,
      combatBotsCount: 0,
      totalMetalMined: 0,
      totalScrapReclaimed: 0,
    };

    this.playerDesign = { ...INITIAL_PLAYER_DESIGN };
    this.enemyDesign = { ...INITIAL_ENEMY_DESIGN };

    this.playerDoctrine = {
      engagementRange: 'balanced',
      targetPriority: 'closest',
      retreatHpThreshold: 0,
    };

    this.enemyDoctrine = {
      engagementRange: 'balanced',
      targetPriority: 'closest',
      retreatHpThreshold: 0,
    };

    this.initMap();
  }

  public initMap() {
    this.units = [];
    this.buildings = [];
    this.resourcePatches = [];
    this.scrapPiles = [];
    this.projectiles = [];
    this.events = [];
    this.gameOver = null;
    this.gameTime = 0;

    // Player Base (Left side, X: 10, Y: 30)
    this.buildings.push({
      id: 'p_hq',
      team: 'player',
      type: 'command_center',
      pos: { x: 10, y: 30 },
      hp: GAME_BALANCE.COMMAND_CENTER_HP,
      maxHp: GAME_BALANCE.COMMAND_CENTER_HP,
      radius: 5,
      productionQueue: null,
    });
    this.buildings.push({
      id: 'p_factory',
      team: 'player',
      type: 'factory',
      pos: { x: 14, y: 22 },
      hp: GAME_BALANCE.FACTORY_HP,
      maxHp: GAME_BALANCE.FACTORY_HP,
      radius: 4,
      productionQueue: null,
    });
    this.buildings.push({
      id: 'p_power',
      team: 'player',
      type: 'power_plant',
      pos: { x: 12, y: 40 },
      hp: GAME_BALANCE.POWER_PLANT_HP,
      maxHp: GAME_BALANCE.POWER_PLANT_HP,
      radius: 3.5,
      productionQueue: null,
    });

    // Enemy Base (Right side, X: 90, Y: 30)
    this.buildings.push({
      id: 'e_hq',
      team: 'enemy',
      type: 'command_center',
      pos: { x: 90, y: 30 },
      hp: GAME_BALANCE.COMMAND_CENTER_HP,
      maxHp: GAME_BALANCE.COMMAND_CENTER_HP,
      radius: 5,
      productionQueue: null,
    });
    this.buildings.push({
      id: 'e_factory',
      team: 'enemy',
      type: 'factory',
      pos: { x: 86, y: 22 },
      hp: GAME_BALANCE.FACTORY_HP,
      maxHp: GAME_BALANCE.FACTORY_HP,
      radius: 4,
      productionQueue: null,
    });
    this.buildings.push({
      id: 'e_power',
      team: 'enemy',
      type: 'power_plant',
      pos: { x: 88, y: 40 },
      hp: GAME_BALANCE.POWER_PLANT_HP,
      maxHp: GAME_BALANCE.POWER_PLANT_HP,
      radius: 3.5,
      productionQueue: null,
    });

    // Resource Nodes (Metal Ore patches)
    // Safe base nodes + contested center nodes
    this.resourcePatches.push(
      { id: 'res_p_safe', pos: { x: 14, y: 12 }, metalRemaining: 3000, maxMetal: 3000, radius: 3 },
      { id: 'res_e_safe', pos: { x: 86, y: 12 }, metalRemaining: 3000, maxMetal: 3000, radius: 3 },
      { id: 'res_mid_top', pos: { x: 50, y: 16 }, metalRemaining: 4500, maxMetal: 4500, radius: 4 },
      { id: 'res_mid_center', pos: { x: 50, y: 30 }, metalRemaining: 6000, maxMetal: 6000, radius: 4.5 },
      { id: 'res_mid_bot', pos: { x: 50, y: 44 }, metalRemaining: 4500, maxMetal: 4500, radius: 4 },
    );

    // Initial Harvesters
    this.spawnHarvester('player', { x: 12, y: 28 });
    this.spawnHarvester('player', { x: 12, y: 32 });

    this.spawnHarvester('enemy', { x: 88, y: 28 });
    this.spawnHarvester('enemy', { x: 88, y: 32 });

    // Initial production queues
    this.queueBatch('player');
    this.queueBatch('enemy');
  }

  public spawnHarvester(team: Team, pos: Vector2D) {
    const id = `harv_${this.nextUnitId++}_${team}`;
    const harv: HarvesterUnit = {
      id,
      team,
      kind: 'harvester',
      pos: { ...pos },
      targetPos: null,
      hp: GAME_BALANCE.HARVESTER_HP,
      maxHp: GAME_BALANCE.HARVESTER_HP,
      speed: GAME_BALANCE.HARVESTER_SPEED,
      radius: 1.4,
      state: 'idle',
      carryingMetal: 0,
      maxCarryCapacity: GAME_BALANCE.HARVESTER_MAX_CARRY,
      harvestTargetId: null,
      targetType: null,
    };
    this.units.push(harv);
  }

  public spawnCombatBot(team: Team, pos: Vector2D, design: RobotDesign, batchNumber: number) {
    const id = `bot_${this.nextUnitId++}_${team}`;
    const stats = RobotBuilder.calculateStats(design);

    const bot: CombatUnit = {
      id,
      team,
      kind: 'combat',
      design: { ...design },
      stats,
      pos: { ...pos },
      targetPos: null,
      hp: stats.hp,
      maxHp: stats.hp,
      speed: stats.effectiveSpeed,
      radius: design.chassisId === 'heavy_quad' ? 2.2 : design.chassisId === 'medium_tracked' ? 1.8 : 1.4,
      state: 'moving',
      targetUnitId: null,
      lastShotTime: 0,
      currentHeat: 0,
      isOverheated: false,
      kills: 0,
      batchNumber,
    };
    this.units.push(bot);
  }

  public queueBatch(team: Team) {
    const factory = this.buildings.find(b => b.team === team && b.type === 'factory');
    if (!factory || factory.productionQueue) return false;

    const design = team === 'player' ? this.playerDesign : this.enemyDesign;
    const stats = RobotBuilder.calculateStats(design);
    const econ = team === 'player' ? this.playerEconomy : this.enemyEconomy;

    const totalBatchMetalCost = stats.metalCost * GAME_BALANCE.BATCH_SIZE_DEFAULT;
    if (econ.metal < totalBatchMetalCost) {
      return false; // Not enough metal
    }

    econ.metal -= totalBatchMetalCost;

    factory.productionQueue = {
      design: { ...design },
      stats,
      progressSec: 0,
      totalTimeSec: stats.buildTimeSec,
      batchSize: GAME_BALANCE.BATCH_SIZE_DEFAULT,
      batchRemaining: GAME_BALANCE.BATCH_SIZE_DEFAULT,
    };

    if (team === 'player') {
      this.events.unshift({
        type: 'design_changed',
        text: `Завод заложил партию #${this.playerBatchNumber} (${design.name}, x${GAME_BALANCE.BATCH_SIZE_DEFAULT})`,
        timestamp: this.gameTime,
      });
    }

    return true;
  }

  public update(dt: number) {
    if (this.isPaused || this.gameOver) return;

    this.gameTime += dt;

    // 1. Update Factory Production
    this.updateProduction(dt);

    // 2. Update Harvesters
    this.updateHarvesters(dt);

    // 3. Update Combat Units & Frontline AI
    this.updateCombatUnits(dt);

    // 4. Update Projectiles
    this.updateProjectiles(dt);

    // 5. Check Victory / Defeat Conditions
    this.checkVictory();

    // 6. Clean dead units and decayed scrap
    this.cleanup();
  }

  private updateProduction(dt: number) {
    for (const b of this.buildings) {
      if (b.type === 'factory' && b.productionQueue) {
        const q = b.productionQueue;
        q.progressSec += dt;

        if (q.progressSec >= q.totalTimeSec) {
          // Spawn one bot from the batch
          const offset = (Math.random() - 0.5) * 4;
          const spawnPos = {
            x: b.team === 'player' ? b.pos.x + 4 : b.pos.x - 4,
            y: b.pos.y + offset,
          };
          const batchNum = b.team === 'player' ? this.playerBatchNumber : this.enemyBatchNumber;
          this.spawnCombatBot(b.team, spawnPos, q.design, batchNum);

          q.batchRemaining--;
          q.progressSec = 0;

          if (q.batchRemaining <= 0) {
            b.productionQueue = null;
            if (b.team === 'player') {
              sounds.playBatchReady();
              this.events.unshift({
                type: 'factory_complete',
                text: `Партия #${this.playerBatchNumber} [${q.design.name}] вышла на передовую!`,
                timestamp: this.gameTime,
              });
              this.playerBatchNumber++;
              // Auto-queue next batch if resources permit
              this.queueBatch('player');
            } else {
              this.enemyBatchNumber++;
              this.queueBatch('enemy');
            }
          }
        }
      }
    }
  }

  private updateHarvesters(dt: number) {
    const hqPlayer = this.buildings.find(b => b.team === 'player' && b.type === 'command_center');
    const hqEnemy = this.buildings.find(b => b.team === 'enemy' && b.type === 'command_center');

    for (const u of this.units) {
      if (u.kind !== 'harvester' || u.state === 'dead') continue;

      const baseHQ = u.team === 'player' ? hqPlayer : hqEnemy;
      const econ = u.team === 'player' ? this.playerEconomy : this.enemyEconomy;

      // Full capacity -> Return to base
      if (u.carryingMetal >= u.maxCarryCapacity) {
        u.state = 'delivering';
        if (baseHQ) {
          const dx = baseHQ.pos.x - u.pos.x;
          const dy = baseHQ.pos.y - u.pos.y;
          const dist = Math.hypot(dx, dy);

          if (dist < baseHQ.radius + u.radius) {
            // Offload metal at base
            econ.metal += u.carryingMetal;
            if (u.targetType === 'scrap') {
              econ.totalScrapReclaimed += u.carryingMetal;
            } else {
              econ.totalMetalMined += u.carryingMetal;
            }
            u.carryingMetal = 0;
            u.state = 'idle';
            u.harvestTargetId = null;
          } else {
            // Move toward HQ
            u.pos.x += (dx / dist) * u.speed * dt;
            u.pos.y += (dy / dist) * u.speed * dt;
          }
        }
        continue;
      }

      // Find target: Check for scrap first if nearby, otherwise mining patch
      if (!u.harvestTargetId) {
        // Find nearest scrap pile
        let nearestScrap: ScrapWreckage | null = null;
        let minScrapDist = 35; // Scrap search radius
        for (const s of this.scrapPiles) {
          const d = Math.hypot(s.pos.x - u.pos.x, s.pos.y - u.pos.y);
          if (d < minScrapDist) {
            minScrapDist = d;
            nearestScrap = s;
          }
        }

        if (nearestScrap) {
          u.harvestTargetId = nearestScrap.id;
          u.targetType = 'scrap';
        } else {
          // Find safe or nearest resource patch
          let bestPatch: ResourcePatch | null = null;
          let bestDist = Infinity;
          for (const p of this.resourcePatches) {
            if (p.metalRemaining <= 0) continue;
            const d = Math.hypot(p.pos.x - u.pos.x, p.pos.y - u.pos.y);
            if (d < bestDist) {
              bestDist = d;
              bestPatch = p;
            }
          }
          if (bestPatch) {
            u.harvestTargetId = bestPatch.id;
            u.targetType = 'ore';
          }
        }
      }

      // Harvest scrap
      if (u.targetType === 'scrap' && u.harvestTargetId) {
        const scrap = this.scrapPiles.find(s => s.id === u.harvestTargetId);
        if (!scrap) {
          u.harvestTargetId = null;
          continue;
        }

        const dx = scrap.pos.x - u.pos.x;
        const dy = scrap.pos.y - u.pos.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 1.5) {
          u.pos.x += (dx / dist) * u.speed * dt;
          u.pos.y += (dy / dist) * u.speed * dt;
          u.state = 'moving';
        } else {
          u.state = 'harvesting';
          const gather = Math.min(scrap.metalAmount, GAME_BALANCE.HARVEST_RATE_PER_SEC * dt * 1.5);
          scrap.metalAmount -= gather;
          u.carryingMetal += gather;

          if (scrap.metalAmount <= 0) {
            this.scrapPiles = this.scrapPiles.filter(s => s.id !== scrap.id);
            u.harvestTargetId = null;
          }
        }
        continue;
      }

      // Harvest ore
      if (u.targetType === 'ore' && u.harvestTargetId) {
        const patch = this.resourcePatches.find(p => p.id === u.harvestTargetId);
        if (!patch || patch.metalRemaining <= 0) {
          u.harvestTargetId = null;
          continue;
        }

        const dx = patch.pos.x - u.pos.x;
        const dy = patch.pos.y - u.pos.y;
        const dist = Math.hypot(dx, dy);

        if (dist > patch.radius * 0.7) {
          u.pos.x += (dx / dist) * u.speed * dt;
          u.pos.y += (dy / dist) * u.speed * dt;
          u.state = 'moving';
        } else {
          u.state = 'harvesting';
          const gather = Math.min(patch.metalRemaining, GAME_BALANCE.HARVEST_RATE_PER_SEC * dt);
          patch.metalRemaining -= gather;
          u.carryingMetal += gather;
        }
      }
    }
  }

  private updateCombatUnits(dt: number) {
    const oppTeam = (team: Team): Team => (team === 'player' ? 'enemy' : 'player');

    for (const u of this.units) {
      if (u.kind !== 'combat' || u.state === 'dead') continue;

      // Handle Heat Dissipation
      if (u.stats.heatDissipationNet > 0) {
        u.currentHeat = Math.max(0, u.currentHeat - u.stats.heatDissipationNet * dt);
      }
      if (u.currentHeat > 100) {
        u.isOverheated = true;
      } else if (u.currentHeat < 30) {
        u.isOverheated = false;
      }

      const enemyTeam = oppTeam(u.team);
      const doctrine = u.team === 'player' ? this.playerDoctrine : this.enemyDoctrine;

      // Target Acquisition
      let target: (CombatUnit | HarvesterUnit | Building) | null = null;
      let minScore = Infinity;

      // 1. Scan enemy units
      for (const enemy of this.units) {
        if (enemy.team !== enemyTeam || enemy.state === 'dead') continue;
        const dist = Math.hypot(enemy.pos.x - u.pos.x, enemy.pos.y - u.pos.y);

        let priorityScore = dist;
        if (doctrine.targetPriority === 'high_threat_heavies' && enemy.kind === 'combat' && enemy.stats.dps > 50) {
          priorityScore -= 12; // Favor heavy hitters
        } else if (doctrine.targetPriority === 'scouts_harvesters' && enemy.kind === 'harvester') {
          priorityScore -= 18; // Favor harvesters
        }

        if (priorityScore < minScore) {
          minScore = priorityScore;
          target = enemy;
        }
      }

      // 2. If no units in sight, target enemy buildings (frontline assault)
      if (!target || minScore > u.stats.effectiveRange * 1.5) {
        for (const b of this.buildings) {
          if (b.team === enemyTeam) {
            const dist = Math.hypot(b.pos.x - u.pos.x, b.pos.y - u.pos.y);
            if (dist < minScore) {
              minScore = dist;
              target = b;
            }
          }
        }
      }

      if (target) {
        const dx = target.pos.x - u.pos.x;
        const dy = target.pos.y - u.pos.y;
        const dist = Math.hypot(dx, dy);

        // Desired engagement distance from doctrine
        let desiredDist = u.stats.effectiveRange * 0.8;
        if (doctrine.engagementRange === 'max_range') desiredDist = u.stats.effectiveRange * 0.95;
        if (doctrine.engagementRange === 'close_brawl') desiredDist = Math.min(6, u.stats.effectiveRange * 0.4);

        if (dist > desiredDist) {
          // Advance toward target
          u.pos.x += (dx / dist) * u.speed * dt;
          u.pos.y += (dy / dist) * u.speed * dt;
          u.state = 'moving';
        } else if (dist < desiredDist * 0.7 && doctrine.engagementRange === 'max_range') {
          // Kite backwards
          u.pos.x -= (dx / dist) * u.speed * 0.6 * dt;
          u.pos.y -= (dy / dist) * u.speed * 0.6 * dt;
          u.state = 'moving';
        } else {
          u.state = 'attacking';
        }

        // Fire Weapons if in range
        if (dist <= u.stats.effectiveRange && !u.isOverheated) {
          const fireInterval = u.stats.dps > 0 ? 1.0 / (u.stats.dps / 30) : 1.0;
          if (this.gameTime - u.lastShotTime >= fireInterval) {
            u.lastShotTime = this.gameTime;
            this.fireProjectile(u, target);

            // Heat buildup
            u.currentHeat += 12;
          }
        }
      } else {
        // Idle march toward enemy side of map
        const forwardDir = u.team === 'player' ? 1 : -1;
        u.pos.x += forwardDir * u.speed * 0.4 * dt;
      }
    }
  }

  private fireProjectile(shooter: CombatUnit, target: CombatUnit | HarvesterUnit | Building) {
    const projId = `proj_${this.nextProjId++}`;
    const damage = shooter.stats.dps * 0.8; // Burst slice

    this.projectiles.push({
      id: projId,
      sourceId: shooter.id,
      targetId: target.id,
      team: shooter.team,
      startPos: { ...shooter.pos },
      currentPos: { ...shooter.pos },
      targetPos: { ...target.pos },
      speed: 38,
      damage,
      type: shooter.stats.effectiveRange > 25 ? 'explosive' : 'kinetic',
      progress: 0,
    });

    if (shooter.stats.effectiveRange > 25) {
      sounds.playCannon();
    } else {
      sounds.playLaser();
    }
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      const dx = p.targetPos.x - p.startPos.x;
      const dy = p.targetPos.y - p.startPos.y;
      const totalDist = Math.hypot(dx, dy);

      if (totalDist < 0.1) {
        p.progress = 1;
        continue;
      }

      p.progress += (p.speed * dt) / totalDist;

      p.currentPos.x = p.startPos.x + dx * p.progress;
      p.currentPos.y = p.startPos.y + dy * p.progress;

      if (p.progress >= 1.0) {
        this.applyDamage(p);
      }
    }

    this.projectiles = this.projectiles.filter(p => p.progress < 1.0);
  }

  private applyDamage(proj: Projectile) {
    // Find target (unit or building)
    const unitTarget = this.units.find(u => u.id === proj.targetId);
    if (unitTarget && unitTarget.state !== 'dead') {
      let finalDamage = proj.damage;
      if (unitTarget.kind === 'combat') {
        // Apply armor mitigation
        finalDamage *= (1.0 - unitTarget.stats.armorRating);
      }
      unitTarget.hp -= Math.max(2, finalDamage);

      if (unitTarget.hp <= 0) {
        unitTarget.state = 'dead';
        sounds.playExplosion();

        // Spawn scrap pile on battlefield! (Section 3 of brief)
        const metalValue = unitTarget.kind === 'combat'
          ? Math.round(unitTarget.stats.metalCost * GAME_BALANCE.SCRAP_SALVAGE_PERCENT)
          : 25;

        this.scrapPiles.push({
          id: `scrap_${this.nextScrapId++}`,
          pos: { ...unitTarget.pos },
          metalAmount: metalValue,
          sourceDesignName: unitTarget.kind === 'combat' ? unitTarget.design.name : 'Сборщик',
          createdAt: this.gameTime,
        });

        if (unitTarget.team === 'enemy') {
          this.events.unshift({
            type: 'kill',
            text: `Уничтожен вражеский робот! Образовались обломки (${metalValue} металла).`,
            timestamp: this.gameTime,
          });
        }
      }
      return;
    }

    const buildingTarget = this.buildings.find(b => b.id === proj.targetId);
    if (buildingTarget) {
      buildingTarget.hp -= proj.damage;
      if (buildingTarget.hp <= 0) {
        sounds.playExplosion();
      }
    }
  }

  private checkVictory() {
    const pCenter = this.buildings.find(b => b.id === 'p_hq');
    const eCenter = this.buildings.find(b => b.id === 'e_hq');

    if (eCenter && eCenter.hp <= 0) {
      this.gameOver = 'player_won';
    } else if (pCenter && pCenter.hp <= 0) {
      this.gameOver = 'enemy_won';
    }
  }

  private cleanup() {
    this.units = this.units.filter(u => u.state !== 'dead');
  }
}
