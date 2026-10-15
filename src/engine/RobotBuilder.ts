import { CHASSIS_CATALOG, MODULES_CATALOG } from '../config/catalog';
import { CalculatedRobotStats, ChassisType, DesignBars, RobotDesign, RobotModule, TacticalRole } from '../types/robot';

const CHASSIS_ORDER: ChassisType[] = ['light_biped', 'medium_tracked', 'heavy_quad'];
const ROLES: TacticalRole[] = ['frontline', 'skirmisher', 'artillery', 'anti_armor', 'balanced'];

/**
 * The game system — not the model — computes stats and validates designs (brief §5).
 * The LLM only picks parts from the catalog; everything here is deterministic.
 */
export class RobotBuilder {
  public static calculateStats(design: RobotDesign): CalculatedRobotStats {
    const chassis = CHASSIS_CATALOG[design.chassisId];
    if (!chassis) {
      return this.createErrorStats(['Неизвестное шасси: ' + design.chassisId]);
    }

    const errors: string[] = [];
    const modules = design.modules.map(id => MODULES_CATALOG[id]).filter(Boolean) as RobotModule[];
    const weapons = modules.filter(m => m.category === 'weapon' && m.weaponDamage && m.weaponFireRate);

    // 1. Volume: limited slots for engine, ammo, battery and cooling
    if (modules.length > chassis.maxSlots) {
      errors.push(`Не хватает места в корпусе: ${modules.length} модулей при ${chassis.maxSlots} слотах`);
    }
    if (weapons.length === 0) {
      errors.push('Нет ни одного оружия — робот бесполезен в бою');
    }

    // 2. Mass
    let totalMass = chassis.baseMass;
    for (const mod of modules) totalMass += mod.mass;
    if (totalMass > chassis.maxMass) {
      errors.push(`Перегруз: ${Math.round(totalMass)} кг при допустимых ${chassis.maxMass} кг`);
    }

    // 3. Power of the robot's own source (not the base grid)
    let powerGen = chassis.basePowerOutput;
    let powerDraw = 0;
    for (const mod of modules) {
      if (mod.powerDraw > 0) powerDraw += mod.powerDraw;
      else if (mod.powerDraw < 0) powerGen += Math.abs(mod.powerDraw);
      if (mod.powerOutput) powerGen += mod.powerOutput;
    }
    const isPowerSurplus = powerGen >= powerDraw;
    if (!isPowerSurplus) {
      errors.push(`Дефицит бортовой энергии: нужно ${powerDraw} кВт, источник даёт ${powerGen} кВт`);
    }

    // 4. Survivability
    let hp = chassis.baseHp;
    let armorRating = 0;
    for (const mod of modules) {
      if (mod.hpBonus) hp += mod.hpBonus;
      if (mod.armorRating) armorRating += mod.armorRating;
    }
    armorRating = Math.min(0.7, armorRating);

    // 5. Mobility: heavier machines are slower and accelerate worse with the same drive
    const massRatio = totalMass / chassis.maxMass;
    let speedMult = 1.0;
    let accelBonus = 0;
    for (const mod of modules) {
      if (mod.speedMultiplier) speedMult *= mod.speedMultiplier;
      if (mod.accelBonus) accelBonus += mod.accelBonus;
    }
    const massPenalty = 1.0 - Math.max(0, massRatio - 0.35) * 0.75;
    const effectiveSpeed = Math.max(0.9, chassis.baseSpeed * massPenalty * speedMult);
    const accel = Math.max(1, (chassis.baseAccel + accelBonus) * (1 - massRatio * 0.5));

    // 6. Heat
    let heatGen = 0;
    let heatDissipation = 10; // natural chassis cooling
    for (const mod of modules) {
      heatGen += mod.heatGen;
      heatDissipation += mod.heatDissipation;
    }
    const heatDissipationNet = heatDissipation - heatGen;

    // 7. Weapons, range and recoil stability
    let rangeMult = 1;
    for (const mod of modules) if (mod.rangeMultiplier) rangeMult *= mod.rangeMultiplier;

    let dps = 0;
    let totalRecoil = 0;
    let pierceWeighted = 0;
    let primary: RobotModule | null = null;
    for (const w of weapons) {
      const wDps = (w.weaponDamage || 0) * (w.weaponFireRate || 0);
      dps += wDps;
      pierceWeighted += wDps * (w.armorPierce || 0);
      totalRecoil += w.weaponRecoil || 0;
      if (!primary || (w.weaponRange || 0) > (primary.weaponRange || 0)) primary = w;
    }
    const armorPierce = dps > 0 ? pierceWeighted / dps : 0;

    let recoilStability = 1.0;
    if (weapons.length > 0 && totalRecoil > chassis.recoilResistance) {
      recoilStability = Math.max(0.3, chassis.recoilResistance / totalRecoil);
      dps *= 0.6 + 0.4 * recoilStability;
      if (recoilStability < 0.55) {
        errors.push(
          `Нестабильная платформа: отдача ${totalRecoil.toFixed(2)} превышает жёсткость шасси ${chassis.recoilResistance}`,
        );
      }
    }

    const effectiveRange = primary ? (primary.weaponRange || 10) * rangeMult : 0;
    const fireInterval = primary ? Math.min(3.2, Math.max(0.28, 1 / (primary.weaponFireRate || 1))) : 1;
    const volleyDamage = dps * fireInterval;

    // 8. Production cost & time
    let metalCost = chassis.metalCost;
    let componentCost = chassis.componentCost;
    let buildTimeSec = chassis.buildTimeSec;
    for (const mod of modules) {
      metalCost += mod.metalCost;
      componentCost += mod.componentCost;
      buildTimeSec += mod.buildTimeSec;
    }

    const stats: CalculatedRobotStats = {
      hp: Math.round(hp),
      mass: Math.round(totalMass),
      maxMass: chassis.maxMass,
      slotsUsed: modules.length,
      maxSlots: chassis.maxSlots,
      speed: chassis.baseSpeed,
      effectiveSpeed: Number(effectiveSpeed.toFixed(2)),
      accel: Number(accel.toFixed(2)),
      powerDraw,
      powerOutput: powerGen,
      isPowerSurplus,
      heatGenFiring: heatGen,
      heatDissipation,
      heatDissipationNet,
      dps: Math.round(dps),
      effectiveRange: Number(effectiveRange.toFixed(1)),
      fireInterval: Number(fireInterval.toFixed(2)),
      volleyDamage: Number(volleyDamage.toFixed(1)),
      weaponKind: primary?.weaponType || null,
      requiresDeploy: !!primary?.requiresDeploy,
      splashRadius: primary?.splashRadius || 0,
      armorPierce: Number(armorPierce.toFixed(2)),
      armorRating: Number(armorRating.toFixed(2)),
      recoilStability: Number(recoilStability.toFixed(2)),
      metalCost,
      componentCost,
      buildTimeSec,
      isValid: errors.length === 0,
      validationErrors: errors,
      tradeoffsSummaryRu: '',
    };
    stats.tradeoffsSummaryRu = this.describeTradeoffs(stats);
    return stats;
  }

  private static describeTradeoffs(s: CalculatedRobotStats): string {
    const parts: string[] = [];
    parts.push(s.armorRating >= 0.35 ? 'тяжёлая броня' : s.armorRating >= 0.2 ? 'средняя броня' : 'лёгкая броня');
    if (s.effectiveSpeed >= 4.5) parts.push('высокая мобильность');
    else if (s.effectiveSpeed <= 2.4) parts.push('медленный ход');
    if (s.effectiveRange >= 26) parts.push('дальнобойное орудие');
    else if (s.effectiveRange <= 5) parts.push('только ближний бой');
    if (s.requiresDeploy) parts.push('стреляет после развёртывания');
    if (s.heatDissipationNet < 0) parts.push('перегревается при долгой стрельбе');
    return `${parts.join(', ')}. ${s.metalCost} металла, ${s.componentCost} компонентов, сборка ${s.buildTimeSec} с.`;
  }

  /** 0..1 bars for the constructor panel. */
  public static bars(s: CalculatedRobotStats): DesignBars {
    const ehp = s.hp / Math.max(0.3, 1 - s.armorRating);
    return {
      armor: clamp01(ehp / 2400),
      power: clamp01(s.dps / 150),
      speed: clamp01(s.effectiveSpeed / 7),
      range: clamp01(s.effectiveRange / 36),
    };
  }

  /** Human-readable before/after comparison (brief §5, §7). */
  public static diff(prev: CalculatedRobotStats, next: CalculatedRobotStats): string[] {
    const out: string[] = [];
    const line = (label: string, a: number, b: number, unit = '', digits = 0) => {
      if (Math.abs(a - b) < 0.05) return;
      const fa = a.toFixed(digits);
      const fb = b.toFixed(digits);
      out.push(`${label}: ${fa}${unit} → ${fb}${unit}`);
    };
    line('Прочность', prev.hp, next.hp);
    line('Броня', prev.armorRating * 100, next.armorRating * 100, '%');
    line('Огневая мощь', prev.dps, next.dps, ' DPS');
    line('Дальность', prev.effectiveRange, next.effectiveRange, ' м', 1);
    line('Скорость', prev.effectiveSpeed, next.effectiveSpeed, ' м/с', 1);
    const costDelta = prev.metalCost > 0 ? Math.round(((next.metalCost - prev.metalCost) / prev.metalCost) * 100) : 0;
    if (next.metalCost !== prev.metalCost) {
      out.push(`Стоимость: ${prev.metalCost} → ${next.metalCost} металла (${costDelta >= 0 ? '+' : ''}${costDelta}%)`);
    }
    line('Сборка', prev.buildTimeSec, next.buildTimeSec, ' с');
    return out;
  }

  /**
   * Builds a design from loosely-typed model output. Unknown parts are dropped,
   * chassis names are matched fuzzily. Never trusts arbitrary bonuses.
   */
  public static normalizeDesign(
    raw: unknown,
    base: RobotDesign,
    idPrefix: string,
  ): { design: RobotDesign; dropped: string[] } | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const chassisRaw = String(r.chassis ?? r.chassisId ?? base.chassisId).toLowerCase();
    const chassisId =
      (CHASSIS_ORDER.find(c => c === chassisRaw) ??
        (chassisRaw.includes('heavy') || chassisRaw.includes('тяж') || chassisRaw.includes('quad')
          ? 'heavy_quad'
          : chassisRaw.includes('light') || chassisRaw.includes('лёг') || chassisRaw.includes('лег') || chassisRaw.includes('biped')
            ? 'light_biped'
            : chassisRaw.includes('medium') || chassisRaw.includes('сред') || chassisRaw.includes('track')
              ? 'medium_tracked'
              : base.chassisId)) as ChassisType;

    const modulesRaw = Array.isArray(r.modules) ? r.modules : [];
    const modules: string[] = [];
    const dropped: string[] = [];
    for (const m of modulesRaw) {
      const id = String(m).trim();
      if (MODULES_CATALOG[id]) {
        modules.push(id);
        continue;
      }
      const lower = id.toLowerCase();
      const fuzzy = Object.keys(MODULES_CATALOG).find(k => lower.includes(k) || k.includes(lower));
      if (fuzzy && lower.length >= 4) modules.push(fuzzy);
      else dropped.push(id);
    }

    const roleRaw = String(r.role ?? r.tacticalRole ?? base.tacticalRole) as TacticalRole;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : `${base.name.replace(/ Mk-.*$/, '')} Mk-${base.version + 1}`;

    return {
      design: {
        id: `${idPrefix}_${Date.now().toString(36)}`,
        name,
        chassisId,
        modules: modules.slice(0, 9),
        color: base.color,
        version: base.version + 1,
        createdAt: Date.now(),
        tacticalRole: ROLES.includes(roleRaw) ? roleRaw : base.tacticalRole,
      },
      dropped,
    };
  }

  /**
   * Turns an invalid design into the closest valid one and explains the compromise.
   * Used when the model ignores a physical limit — the player still gets a working
   * robot and an honest explanation instead of an error.
   */
  public static repairDesign(input: RobotDesign): { design: RobotDesign; notes: string[] } {
    const design: RobotDesign = { ...input, modules: input.modules.filter(m => MODULES_CATALOG[m]) };
    const notes: string[] = [];
    if (!CHASSIS_CATALOG[design.chassisId]) {
      design.chassisId = 'medium_tracked';
      notes.push('неизвестное шасси заменено на средний гусеничный');
    }

    for (let iter = 0; iter < 14; iter++) {
      const s = this.calculateStats(design);
      if (s.isValid) break;
      const chassis = CHASSIS_CATALOG[design.chassisId];
      const mods = design.modules.map(id => MODULES_CATALOG[id]);
      const hasWeapon = mods.some(m => m.category === 'weapon');

      if (!hasWeapon) {
        if (design.modules.length >= chassis.maxSlots) design.modules.pop();
        design.modules.push('autocannon_20mm');
        notes.push('добавлена автопушка: без оружия робот бесполезен');
        continue;
      }

      if (design.modules.length > chassis.maxSlots) {
        const idx = this.leastImportantIndex(design.modules);
        notes.push(`снят модуль «${MODULES_CATALOG[design.modules[idx]].nameRu}» — не хватает места`);
        design.modules.splice(idx, 1);
        continue;
      }

      // Recoil instability or overweight weapon → heavier chassis is the honest fix
      const unstable = s.validationErrors.some(e => e.startsWith('Нестабильная'));
      const heaviestWeapon = Math.max(...mods.filter(m => m.category === 'weapon').map(m => m.mass));
      const weaponTooHeavy = chassis.baseMass + heaviestWeapon > chassis.maxMass;
      if ((unstable || weaponTooHeavy) && design.chassisId !== 'heavy_quad') {
        const next = CHASSIS_ORDER[CHASSIS_ORDER.indexOf(design.chassisId) + 1];
        notes.push(`шасси усилено до «${CHASSIS_CATALOG[next].nameRu}» — иначе орудие не удержать`);
        design.chassisId = next;
        continue;
      }

      if (s.mass > s.maxMass) {
        const downgrade = this.downgradeArmor(design.modules);
        if (downgrade) {
          notes.push(downgrade);
          continue;
        }
        const idx = this.leastImportantIndex(design.modules);
        notes.push(`снят модуль «${MODULES_CATALOG[design.modules[idx]].nameRu}» из-за перегруза`);
        design.modules.splice(idx, 1);
        continue;
      }

      if (!s.isPowerSurplus) {
        if (!design.modules.includes('diesel_electric') && design.modules.length < chassis.maxSlots) {
          design.modules.push('diesel_electric');
          notes.push('добавлен дизель-генератор — иначе не хватает энергии');
          continue;
        }
        const hungry = ['radar_sensor', 'micro_turbine', 'heat_radiator'].find(id => design.modules.includes(id));
        if (hungry) {
          design.modules.splice(design.modules.indexOf(hungry), 1);
          notes.push(`снят «${MODULES_CATALOG[hungry].nameRu}» ради энергии`);
          continue;
        }
        if (!design.modules.includes('diesel_electric')) {
          const idx = this.leastImportantIndex(design.modules);
          design.modules[idx] = 'diesel_electric';
          notes.push('модуль заменён дизель-генератором ради энергии');
          continue;
        }
        if (design.chassisId !== 'heavy_quad') {
          const next = CHASSIS_ORDER[CHASSIS_ORDER.indexOf(design.chassisId) + 1];
          design.chassisId = next;
          notes.push(`шасси усилено до «${CHASSIS_CATALOG[next].nameRu}» ради мощности`);
          continue;
        }
      }

      // Last resort: drop the least important module
      if (design.modules.length > 1) {
        const idx = this.leastImportantIndex(design.modules);
        notes.push(`снят модуль «${MODULES_CATALOG[design.modules[idx]].nameRu}»`);
        design.modules.splice(idx, 1);
      } else {
        design.chassisId = 'light_biped';
        design.modules = ['light_composite', 'autocannon_20mm'];
        notes.push('проект сброшен к базовой конфигурации');
      }
    }
    return { design, notes };
  }

  private static leastImportantIndex(modules: string[]): number {
    const priority = (id: string, idx: number): number => {
      const m = MODULES_CATALOG[id];
      const firstWeapon = modules.findIndex(x => MODULES_CATALOG[x]?.category === 'weapon');
      if (m.category === 'weapon') return idx === firstWeapon ? 100 : 40;
      if (m.category === 'utility') return 10;
      if (m.category === 'engine') return id === 'diesel_electric' ? 30 : 20;
      const firstArmor = modules.findIndex(x => MODULES_CATALOG[x]?.category === 'armor');
      return idx === firstArmor ? 50 : 15;
    };
    let best = 0;
    let bestScore = Infinity;
    modules.forEach((id, idx) => {
      const p = priority(id, idx);
      if (p < bestScore) {
        bestScore = p;
        best = idx;
      }
    });
    return best;
  }

  private static downgradeArmor(modules: string[]): string | null {
    const chain: Record<string, string> = { sloped_reactive: 'reinforced_steel', reinforced_steel: 'light_composite' };
    for (const heavy of ['sloped_reactive', 'reinforced_steel']) {
      const idx = modules.indexOf(heavy);
      if (idx >= 0) {
        modules[idx] = chain[heavy];
        return `броня «${MODULES_CATALOG[heavy].nameRu}» заменена на «${MODULES_CATALOG[chain[heavy]].nameRu}» из-за массы`;
      }
    }
    return null;
  }

  private static createErrorStats(errors: string[]): CalculatedRobotStats {
    return {
      hp: 100,
      mass: 0,
      maxMass: 100,
      slotsUsed: 0,
      maxSlots: 0,
      speed: 0,
      effectiveSpeed: 0,
      accel: 1,
      powerDraw: 0,
      powerOutput: 0,
      isPowerSurplus: false,
      heatGenFiring: 0,
      heatDissipation: 0,
      heatDissipationNet: 0,
      dps: 0,
      effectiveRange: 0,
      fireInterval: 1,
      volleyDamage: 0,
      weaponKind: null,
      requiresDeploy: false,
      splashRadius: 0,
      armorPierce: 0,
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
