import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { CalculatedRobotStats, RobotDesign } from '../types/robot';

export class RobotBuilder {
  public static calculateStats(design: RobotDesign): CalculatedRobotStats {
    const chassis = CHASSIS_CATALOG[design.chassisId];
    if (!chassis) {
      return this.createErrorStats(['Неизвестное шасси: ' + design.chassisId]);
    }

    const errors: string[] = [];
    const modules = design.modules
      .map(id => MODULES_CATALOG[id])
      .filter(Boolean);

    // 1. Slots check
    if (modules.length > chassis.maxSlots) {
      errors.push(`Превышен лимит слотов шасси: установлено ${modules.length} из ${chassis.maxSlots}`);
    }

    // 2. Mass calculation
    let totalMass = chassis.maxMass * 0.3; // Chassis base mass
    for (const mod of modules) {
      totalMass += mod.mass;
    }

    if (totalMass > chassis.maxMass) {
      errors.push(`Перегруз по массе: ${Math.round(totalMass)} кг при максимуме ${chassis.maxMass} кг`);
    }

    // 3. Power balance
    let powerGen = chassis.basePowerOutput;
    let powerDraw = 0;
    for (const mod of modules) {
      if (mod.powerDraw > 0) {
        powerDraw += mod.powerDraw;
      } else if (mod.powerDraw < 0) {
        powerGen += Math.abs(mod.powerDraw);
      }
      if (mod.powerOutput) {
        powerGen += mod.powerOutput;
      }
    }

    const isPowerSurplus = powerGen >= powerDraw;
    if (!isPowerSurplus) {
      errors.push(`Дефицит энергии: требуется ${powerDraw} кВт, доступно только ${powerGen} кВт`);
    }

    // 4. Hit Points & Armor
    let hp = chassis.baseHp;
    let armorRating = 0;
    for (const mod of modules) {
      if (mod.hpBonus) hp += mod.hpBonus;
      if (mod.armorRating) armorRating += mod.armorRating;
    }
    armorRating = Math.min(0.75, armorRating); // Cap at 75% damage mitigation

    // 5. Mobility & Speed
    // Heavier machines travel slower; turbine increases speed
    const massRatio = totalMass / chassis.maxMass;
    let speedMult = 1.0;
    for (const mod of modules) {
      if (mod.speedMultiplier) speedMult *= mod.speedMultiplier;
    }
    // Mass penalty curve
    const massPenalty = 1.0 - Math.max(0, (massRatio - 0.4) * 0.6);
    const effectiveSpeed = Math.max(1.0, chassis.baseSpeed * massPenalty * speedMult);

    // 6. Heat balance
    let heatGen = 0;
    let heatDissipation = 10; // Base natural chassis heat dissipation
    for (const mod of modules) {
      heatGen += mod.heatGen;
      heatDissipation += mod.heatDissipation;
    }
    const heatDissipationNet = heatDissipation - heatGen;

    // 7. Weapon DPS, Range & Recoil Stability
    let dps = 0;
    let maxRange = 0;
    let totalRecoil = 0;
    let weaponCount = 0;
    let hasRadar = modules.some(m => m.id === 'radar_sensor');

    for (const mod of modules) {
      if (mod.category === 'weapon' && mod.weaponDamage && mod.weaponFireRate) {
        weaponCount++;
        dps += mod.weaponDamage * mod.weaponFireRate;
        const range = (mod.weaponRange || 15) * (hasRadar ? 1.2 : 1.0);
        if (range > maxRange) maxRange = range;
        if (mod.weaponRecoil) totalRecoil += mod.weaponRecoil;
      }
    }

    // Recoil stability
    let recoilStability = 1.0;
    if (weaponCount > 0 && totalRecoil > chassis.recoilResistance) {
      recoilStability = Math.max(0.3, chassis.recoilResistance / totalRecoil);
      // Reduce DPS due to recoil bloom and shaking
      dps *= (0.7 + 0.3 * recoilStability);
      if (recoilStability < 0.6) {
        errors.push(`Нестабильная платформа: отдача оружия (${totalRecoil.toFixed(2)}) превышает жесткость шасси (${chassis.recoilResistance})`);
      }
    }

    // 8. Cost & Build Time
    let metalCost = chassis.metalCost;
    let componentCost = 0;
    let buildTimeSec = chassis.buildTimeSec;

    for (const mod of modules) {
      metalCost += mod.metalCost;
      componentCost += mod.componentCost;
      buildTimeSec += mod.buildTimeSec;
    }

    // Generate Tradeoff Explanation in Russian
    const tradeoffs: string[] = [];
    if (armorRating > 0.35) {
      tradeoffs.push('Высокая бронезащита');
    } else {
      tradeoffs.push('Легкое бронирование');
    }

    if (effectiveSpeed >= 4.5) {
      tradeoffs.push('высокая мобильность');
    } else if (effectiveSpeed <= 2.2) {
      tradeoffs.push('медленное передвижение');
    }

    if (maxRange >= 26) {
      tradeoffs.push('дальнобойное осадное орудие');
    } else if (maxRange <= 10) {
      tradeoffs.push('ориентация на ближний бой');
    }

    if (heatDissipationNet < 0) {
      tradeoffs.push('возможен перегрев при непрерывной стрельбе');
    }

    const tradeoffsSummaryRu = `Конструкция: ${tradeoffs.join(', ')}. Стоимость: ${metalCost} металла, ${componentCost} деталей, сборка ${buildTimeSec}с.`;

    return {
      hp: Math.round(hp),
      mass: Math.round(totalMass),
      maxMass: chassis.maxMass,
      speed: chassis.baseSpeed,
      effectiveSpeed: Number(effectiveSpeed.toFixed(2)),
      powerDraw,
      powerOutput: powerGen,
      isPowerSurplus,
      heatDissipationNet,
      dps: Math.round(dps),
      effectiveRange: Math.round(maxRange),
      armorRating: Number(armorRating.toFixed(2)),
      recoilStability: Number(recoilStability.toFixed(2)),
      metalCost,
      componentCost,
      buildTimeSec,
      isValid: errors.length === 0,
      validationErrors: errors,
      tradeoffsSummaryRu,
    };
  }

  private static createErrorStats(errors: string[]): CalculatedRobotStats {
    return {
      hp: 100,
      mass: 0,
      maxMass: 100,
      speed: 0,
      effectiveSpeed: 0,
      powerDraw: 0,
      powerOutput: 0,
      isPowerSurplus: false,
      heatDissipationNet: 0,
      dps: 0,
      effectiveRange: 0,
      armorRating: 0,
      recoilStability: 1,
      metalCost: 999,
      componentCost: 999,
      buildTimeSec: 99,
      isValid: false,
      validationErrors: errors,
      tradeoffsSummaryRu: 'Ошибка конфигурации',
    };
  }
}
