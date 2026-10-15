import { GAME_BALANCE } from '../config/balance';
import { EngagementRange, ProductionAction, Stance, TacticalPlan, TargetPriority } from '../types/game';

const STANCES: Stance[] = ['advance', 'hold_center', 'defend_base', 'raid_economy'];
const RANGES: EngagementRange[] = ['max_range', 'balanced', 'close_brawl'];
const PRIORITIES: TargetPriority[] = ['closest', 'high_threat_heavies', 'scouts_harvesters', 'focus_fire', 'buildings'];

export const STANCE_RU: Record<Stance, string> = {
  advance: 'Наступление',
  hold_center: 'Держать центр',
  defend_base: 'Оборона базы',
  raid_economy: 'Рейд на добычу',
};
export const RANGE_RU: Record<EngagementRange, string> = {
  max_range: 'Макс. дистанция',
  balanced: 'Сбалансированно',
  close_brawl: 'Ближний бой',
};
export const PRIORITY_RU: Record<TargetPriority, string> = {
  closest: 'Ближайшие',
  high_threat_heavies: 'Опасные тяжёлые',
  scouts_harvesters: 'Добытчики и скауты',
  focus_fire: 'Фокус огня',
  buildings: 'Постройки',
};

export const STANCE_SHORT: Record<Stance, string> = { advance: 'Наступать', hold_center: 'Центр', defend_base: 'Оборона', raid_economy: 'Рейд' };
export const RANGE_SHORT: Record<EngagementRange, string> = { max_range: 'Макс. дист.', balanced: 'Баланс', close_brawl: 'Вплотную' };
export const PRIORITY_SHORT: Record<TargetPriority, string> = {
  closest: 'Ближние',
  high_threat_heavies: 'Тяжёлые',
  scouts_harvesters: 'Добыча',
  focus_fire: 'Фокус',
  buildings: 'Здания',
};

/** Only whitelisted plan values survive; anything else keeps the previous value. */
export function normalizePlan(raw: unknown, prev: TacticalPlan, source: TacticalPlan['source']): TacticalPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T =>
    typeof v === 'string' && allowed.includes(v as T) ? (v as T) : fallback;
  const threshold = Number(r.retreatHpThreshold);
  const plan: TacticalPlan = {
    stance: pick(r.stance, STANCES, prev.stance),
    engagementRange: pick(r.engagementRange, RANGES, prev.engagementRange),
    targetPriority: pick(r.targetPriority, PRIORITIES, prev.targetPriority),
    retreatHpThreshold: Number.isFinite(threshold) ? Math.max(0, Math.min(60, Math.round(threshold))) : prev.retreatHpThreshold,
    guardHarvesters: typeof r.guardHarvesters === 'boolean' ? r.guardHarvesters : prev.guardHarvesters,
    summaryRu: '',
    source,
    updatedAt: prev.updatedAt,
  };
  plan.summaryRu =
    typeof r.summary === 'string' && r.summary.trim() ? r.summary.trim().slice(0, 120) : describePlan(plan);
  return plan;
}

export function describePlan(p: TacticalPlan): string {
  const parts = [STANCE_RU[p.stance], RANGE_RU[p.engagementRange].toLowerCase(), `цели: ${PRIORITY_RU[p.targetPriority].toLowerCase()}`];
  if (p.retreatHpThreshold > 0) parts.push(`ремонт при <${p.retreatHpThreshold}%`);
  if (p.guardHarvesters) parts.push('прикрытие добычи');
  return parts.join(', ');
}

export function normalizeActions(raw: unknown): ProductionAction[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductionAction[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    switch (a.type) {
      case 'build_harvester':
        out.push({ type: 'build_harvester', count: Math.max(1, Math.min(4, Math.round(Number(a.count) || 1))) });
        break;
      case 'build_power_plant':
        out.push({ type: 'build_power_plant' });
        break;
      case 'build_factory':
        out.push({ type: 'build_factory' });
        break;
      case 'set_batch_size': {
        const size = Math.round(Number(a.size));
        if (Number.isFinite(size)) {
          out.push({
            type: 'set_batch_size',
            size: Math.max(GAME_BALANCE.BATCH_SIZE_MIN, Math.min(GAME_BALANCE.BATCH_SIZE_MAX, size)),
          });
        }
        break;
      }
      case 'set_component_reserve': {
        const amount = Math.round(Number(a.amount));
        if (Number.isFinite(amount)) out.push({ type: 'set_component_reserve', amount: Math.max(0, Math.min(600, amount)) });
        break;
      }
      case 'set_production': {
        const paused = a.paused === true || a.paused === 'true' ? true : a.paused === false || a.paused === 'false' ? false : null;
        if (paused !== null) out.push({ type: 'set_production', paused });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function describeAction(a: ProductionAction): string {
  switch (a.type) {
    case 'build_harvester':
      return `Заказать добытчиков на заводе: ${a.count} (по ${GAME_BALANCE.HARVESTER_COST_METAL} металла, ~${GAME_BALANCE.HARVESTER_BUILD_SEC} с каждый)`;
    case 'build_power_plant':
      return `Построить электростанцию (${GAME_BALANCE.POWER_PLANT_COST_METAL} металла, +${GAME_BALANCE.POWER_PLANT_KW} кВт)`;
    case 'build_factory':
      return `Построить второй завод (${GAME_BALANCE.FACTORY_COST_METAL} металла, ${GAME_BALANCE.FACTORY_COST_COMPONENTS} компонентов)`;
    case 'set_batch_size':
      return `Размер партии: ${a.size}`;
    case 'set_component_reserve':
      return `Резерв компонентов: ${a.amount}`;
    case 'set_production':
      return a.paused ? 'Остановить производство на всех заводах' : 'Возобновить производство на всех заводах';
  }
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}
