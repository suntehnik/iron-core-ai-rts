import { chassisName } from '../config/catalog';
import { LevelConfig } from '../config/levels';
import { MessageKey, t } from '../i18n';

/** "Marsh", or "Endless 9" past the campaign. */
export function levelName(cfg: LevelConfig): string {
  const name = t(`level.${cfg.id}.name` as MessageKey);
  return cfg.id === 'endless' ? `${name} ${cfg.n}` : name;
}

export function levelDescription(cfg: LevelConfig): string {
  return t(`level.${cfg.id}.desc` as MessageKey);
}

/** The enemy's edge on the level in one line: economy, chassis, buildings, garrison, doctrine. */
export function enemyEdge(cfg: LevelConfig): string {
  const e = cfg.enemy;
  const parts = [t('campaign.edge.income', { k: e.incomeMul.toFixed(2).replace(/0$/, '') })];
  if (e.chassis.length < 3) parts.push(t('campaign.edge.chassis', { list: e.chassis.map(c => chassisName(c).toLocaleLowerCase()).join(', ') }));
  if (e.extraFactory) parts.push(t('campaign.edge.factory'));
  if (e.extraHarvesters) parts.push(t('campaign.edge.harvesters', { count: e.extraHarvesters }));
  if (e.garrison) parts.push(t('campaign.edge.army', { n: e.garrison }));
  if (e.hqHpMul && e.hqHpMul > 1) parts.push(t('campaign.edge.hq', { n: Math.round((e.hqHpMul - 1) * 100) }));
  parts.push(t(`campaign.doctrine.${cfg.doctrine}` as MessageKey));
  return t('campaign.enemyEdge', { edge: parts.join(', ') });
}
