import { GAME_BALANCE } from '../config/balance';
import { EngagementRange, ProductionAction, Stance, TacticalPlan, TargetPriority } from '../types/game';
import { MessageKey, t } from '../i18n';

export const STANCES: Stance[] = ['advance', 'hold_center', 'defend_base', 'raid_economy'];
export const RANGES: EngagementRange[] = ['max_range', 'balanced', 'close_brawl'];
export const PRIORITIES: TargetPriority[] = ['closest', 'high_threat_heavies', 'scouts_harvesters', 'focus_fire', 'buildings'];

/** Plan labels in the game language: full for summaries and hints, short for the plan chips. */
export const stanceLabel = (k: Stance, short = false) => t(`stance.${k}${short ? '.short' : ''}` as MessageKey);
export const rangeLabel = (k: EngagementRange, short = false) => t(`range.${k}${short ? '.short' : ''}` as MessageKey);
export const priorityLabel = (k: TargetPriority, short = false) => t(`priority.${k}${short ? '.short' : ''}` as MessageKey);

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
  const parts = [
    stanceLabel(p.stance),
    rangeLabel(p.engagementRange).toLowerCase(),
    t('plan.targets', { x: priorityLabel(p.targetPriority).toLowerCase() }),
  ];
  if (p.retreatHpThreshold > 0) parts.push(t('plan.repairBelow', { n: p.retreatHpThreshold }));
  if (p.guardHarvesters) parts.push(t('plan.guard'));
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
      return t('action.harvesters', { n: a.count, metal: GAME_BALANCE.HARVESTER_COST_METAL, sec: GAME_BALANCE.HARVESTER_BUILD_SEC });
    case 'build_power_plant':
      return t('action.powerPlant', { metal: GAME_BALANCE.POWER_PLANT_COST_METAL, kw: GAME_BALANCE.POWER_PLANT_KW });
    case 'build_factory':
      return t('action.factory', { metal: GAME_BALANCE.FACTORY_COST_METAL, comp: GAME_BALANCE.FACTORY_COST_COMPONENTS });
    case 'set_batch_size':
      return t('action.batch', { n: a.size });
    case 'set_component_reserve':
      return t('action.reserve', { n: a.amount });
    case 'set_production':
      return t(a.paused ? 'action.stopAll' : 'action.resumeAll');
  }
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}
