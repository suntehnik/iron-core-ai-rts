import { GAME_BALANCE } from '../config/balance';
import { GameState } from '../engine/GameState';
import { RobotDesign } from '../types/robot';

export class EnemyAIAgent {
  private lastAdaptTime = 0;
  private adaptIntervalSec = 35; // Re-evaluates every 35 seconds

  public update(state: GameState) {
    if (state.gameOver || state.isPaused) return;

    // 1. Maintain Harvesters
    const enemyHarvesters = state.units.filter(u => u.team === 'enemy' && u.kind === 'harvester');
    if (enemyHarvesters.length < 3 && state.enemyEconomy.metal >= GAME_BALANCE.HARVESTER_COST_METAL) {
      state.enemyEconomy.metal -= GAME_BALANCE.HARVESTER_COST_METAL;
      state.spawnHarvester('enemy', { x: 88, y: 30 });
      state.enemyEconomy.harvestersCount++;
    }

    // 2. Auto-queue batches if factory is idle
    const factory = state.buildings.find(b => b.team === 'enemy' && b.type === 'factory');
    if (factory && !factory.productionQueue) {
      state.queueBatch('enemy');
    }

    // 3. Counter-Build Adaptation against Player Design
    if (state.gameTime - this.lastAdaptTime >= this.adaptIntervalSec) {
      this.lastAdaptTime = state.gameTime;
      this.adaptDesign(state);
    }
  }

  private adaptDesign(state: GameState) {
    const playerDesign = state.playerDesign;
    const enemyCurrent = state.enemyDesign;
    let newDesign: RobotDesign = { ...enemyCurrent, version: enemyCurrent.version + 1 };

    // Counter strategy
    if (playerDesign.chassisId === 'heavy_quad' || playerDesign.modules.includes('heavy_siege_cannon')) {
      // Player is slow & heavy artillery -> Counter with Fast flanking buzzsaw / plasma swarm
      newDesign.name = 'Красная Гончая Mk-' + newDesign.version;
      newDesign.chassisId = 'light_biped';
      newDesign.modules = ['light_composite', 'melee_buzzsaw', 'micro_turbine'];
      newDesign.tacticalRole = 'skirmisher';
      state.enemyDoctrine.engagementRange = 'close_brawl';

    } else if (playerDesign.chassisId === 'light_biped') {
      // Player is fast light swarm -> Counter with Reinforced Autocannon shredder
      newDesign.name = 'Красный Страж Mk-' + newDesign.version;
      newDesign.chassisId = 'medium_tracked';
      newDesign.modules = ['reinforced_steel', 'autocannon_20mm', 'heat_radiator'];
      newDesign.tacticalRole = 'frontline';
      state.enemyDoctrine.engagementRange = 'balanced';

    } else if (playerDesign.modules.includes('sloped_reactive')) {
      // Player has extreme armor -> Counter with Armor-melting Railgun / Plasma
      newDesign.name = 'Красный Палач Mk-' + newDesign.version;
      newDesign.chassisId = 'medium_tracked';
      newDesign.modules = ['reinforced_steel', 'sniper_railgun', 'diesel_electric'];
      newDesign.tacticalRole = 'anti_armor';
      state.enemyDoctrine.engagementRange = 'max_range';
    }

    state.enemyDesign = newDesign;
  }
}
