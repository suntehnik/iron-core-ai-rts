import React from 'react';
import { Crosshair, Factory, FlaskConical, Gem, Hourglass, Lock, Minus, Package, Pause, Pickaxe, Play, Plus, Radar, Target, Wrench, X, Zap } from 'lucide-react';
import { GAME_BALANCE, PAD_BUILDINGS } from '../config/balance';
import { PadBuildingType } from '../types/game';
import { GameController } from '../game/GameController';
import { Panel, ProgressBar, cx, usePanelOpen } from './ui';
import { MessageKey, t } from '../i18n';

const PAD_ICONS: Record<PadBuildingType, React.ReactNode> = {
  turret: <Crosshair className="w-3.5 h-3.5" />,
  repair_dock: <Wrench className="w-3.5 h-3.5" />,
  radar: <Radar className="w-3.5 h-3.5" />,
  depot: <Package className="w-3.5 h-3.5" />,
  lab: <FlaskConical className="w-3.5 h-3.5" />,
  artillery: <Target className="w-3.5 h-3.5" />,
};

/** Mining, factory queues and base construction (brief §3, §7). */
export const ProductionPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const s = ctrl.state;
  const econ = s.teams.player.economy;
  const factories = s.buildings.filter(b => b.team === 'player' && b.type === 'factory');
  const plants = s.buildings.filter(b => b.team === 'player' && b.type === 'power_plant');
  const harvesters = s.units.filter(u => u.team === 'player' && u.kind === 'harvester');
  const onSite = harvesters.filter(h => h.kind === 'harvester' && h.buildSiteId).length;
  const mining = harvesters.filter(h => h.kind === 'harvester' && !h.buildSiteId && (h.state === 'harvesting' || h.carrying > 0)).length;
  // sites other than factories (those show in their factory card): power plants and pad buildings
  const otherSites = s.constructionSites('player').filter(b => b.type !== 'factory');
  // agents' orders the base cannot pay for yet (UI buttons never queue)
  const pending = s.pendingOrders.player;
  const harvInProduction = s.harvestersInProduction('player');
  const allPaused = factories.length > 0 && factories.every(f => f.paused);
  const canPlant = s.canBuild('player', 'power_plant');
  const canFactory = s.canBuild('player', 'factory');

  const [open, toggle] = usePanelOpen();

  return (
    <Panel
      className="w-[264px]"
      open={open}
      onToggle={toggle}
      summary={`${factories.map(f => s.factoryStatus(f)).join(' · ') || t('prod.summaryNoFactories')} · ${t('prod.summaryHarvesters', { n: s.harvesterCount('player'), max: GAME_BALANCE.MAX_HARVESTERS })}`}
      title={<><Factory className="w-3.5 h-3.5 text-teal-300" /> {t('prod.title')}</>}
      right={
        factories.length > 1 ? (
          <button
            type="button"
            onClick={() => ctrl.economyAction({ type: 'set_production', paused: !allPaused })}
            className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1"
            title={allPaused ? t('prod.startAll') : t('prod.stopAll')}
          >
            {allPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />} {allPaused ? t('prod.all') : t('prod.stopAllShort')}
          </button>
        ) : undefined
      }
    >
      <div className="p-2.5 flex flex-col gap-2 text-[11px]">
        {factories.length === 0 && (
          <div className="text-rose-300">
            {t('prod.factoryDestroyed')}
            {s.getHQ('player')?.harvesterBuild && (
              <div className="text-[10px] text-amber-200 mt-0.5">
                {t('prod.hqBay', { pct: Math.round((s.getHQ('player')!.harvesterBuild!.progressSec / s.getHQ('player')!.harvesterBuild!.totalSec) * 100) })}
              </div>
            )}
          </div>
        )}
        {factories.map((f, i) => {
          const job = f.job;
          const status = s.factoryStatus(f);
          const hb = f.harvesterBuild;
          return (
            <div key={f.id} className={cx('rounded-lg border p-2', f.paused ? 'bg-slate-900/70 border-amber-400/30' : 'bg-slate-800/60 border-white/5')}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-slate-100">{t('prod.factory', { n: i + 1 })}</span>
                <span className="flex items-center gap-1.5">
                  <span className={cx('text-[10px]', status === t('factory.assembling') || status === t('factory.harvester') ? 'text-teal-300' : 'text-amber-300')}>{status}</span>
                  {f.built < 1 && <CancelButton title={t('prod.cancelSite')} onClick={() => ctrl.cancelSite(f.id)} />}
                  {f.built >= 1 && (
                    <button
                      type="button"
                      onClick={() => ctrl.toggleFactory(f.id)}
                      title={f.paused ? t('prod.resume') : t('prod.stopHint')}
                      aria-label={f.paused ? t('prod.startFactory', { n: i + 1 }) : t('prod.stopFactory', { n: i + 1 })}
                      className={cx(
                        'w-6 h-6 rounded-md border flex items-center justify-center transition',
                        f.paused ? 'bg-amber-500/25 border-amber-300/60 text-amber-100 hover:bg-amber-500/40' : 'bg-slate-700/70 border-white/10 text-slate-200 hover:bg-slate-600',
                      )}
                    >
                      {f.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    </button>
                  )}
                </span>
              </div>
              {f.built < 1 ? (
                <ProgressBar value={f.built} color="#f2b134" className="mt-1.5" />
              ) : hb ? (
                <>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                    {job ? t('prod.harvesterThenBatch', { n: job.batchNumber }) : t('prod.harvesterOnly')}
                  </div>
                  <ProgressBar value={hb.progressSec / hb.totalSec} color="#f2b134" className={cx('mt-1', f.paused && 'opacity-50')} />
                </>
              ) : job ? (
                <>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                    {t('prod.batch', { n: job.batchNumber })} <span className="text-slate-200">{job.design.name}</span> · {job.batchSize - job.remaining + 1}/{job.batchSize}
                  </div>
                  <ProgressBar value={job.progressSec / job.unitTimeSec} className={cx('mt-1', f.paused && 'opacity-50')} />
                </>
              ) : f.paused ? (
                <div className="text-[10px] text-amber-200/80 mt-0.5">{t('prod.pausedHint')}</div>
              ) : (
                <div className="text-[10px] text-slate-400 mt-0.5">{t('prod.needs', { name: s.teams.player.design.name })}</div>
              )}
            </div>
          );
        })}

        {otherSites.map(p => (
          <div key={p.id} className="rounded-lg border p-2 bg-slate-800/60 border-white/5" title={t('prod.workersHint')}>
            <div className="flex items-center justify-between gap-1">
              <span className="font-semibold text-slate-100 flex items-center gap-1">
                {p.type === 'power_plant' ? <Zap className="w-3 h-3 text-amber-300" /> : <span className="text-amber-300">{PAD_ICONS[p.type as PadBuildingType]}</span>}
                {p.type === 'power_plant' ? t('prod.plantSite') : t(`building.${p.type}` as MessageKey)}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] text-amber-300">{s.siteStatus(p)}</span>
                <CancelButton title={t('prod.cancelSite')} onClick={() => ctrl.cancelSite(p.id)} />
              </span>
            </div>
            <ProgressBar value={p.built} color="#f2b134" className="mt-1.5" />
          </div>
        ))}

        {pending.length > 0 && (
          <div className="rounded-lg border border-dashed border-amber-300/30 p-2 bg-slate-900/50" title={t('prod.queueHint')}>
            <div className="text-[10px] text-amber-200/80 flex items-center gap-1">
              <Hourglass className="w-3 h-3" /> {t('prod.queue')}
            </div>
            {pending.map(o => (
              <div key={o.id} className="flex items-center gap-1.5 mt-1">
                <span className="font-semibold text-slate-100 shrink-0">
                  {s.orderName(o.what)}
                  {o.count > 1 ? ` ×${o.count}` : ''}
                </span>
                <span className="flex-1 min-w-0 text-right text-[10px] text-amber-300 truncate" title={o.why}>
                  {o.why}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{t('unit.sec', { n: s.orderTimeLeft(o) })}</span>
                <CancelButton title={t('prod.queueCancel')} onClick={() => ctrl.cancelPendingOrder(o.id)} />
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-slate-300">{t('prod.batchSize')}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="w-6 h-6 rounded bg-slate-800 border border-white/10 flex items-center justify-center hover:bg-slate-700"
              onClick={() => ctrl.economyAction({ type: 'set_batch_size', size: econ.batchSize - 1 })}
              aria-label={t('prod.less')}
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-5 text-center font-bold tabular-nums">{econ.batchSize}</span>
            <button
              type="button"
              className="w-6 h-6 rounded bg-slate-800 border border-white/10 flex items-center justify-center hover:bg-slate-700"
              onClick={() => ctrl.economyAction({ type: 'set_batch_size', size: econ.batchSize + 1 })}
              aria-label={t('prod.more')}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {s.crystals && (
          <div className="flex items-center justify-between" title={t('top.crystals')}>
            <span className="text-slate-300 flex items-center gap-1">
              <Gem className="w-3.5 h-3.5 text-fuchsia-300" /> {t('prod.crystals')}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="w-6 h-6 rounded bg-slate-800 border border-white/10 flex items-center justify-center hover:bg-slate-700"
                onClick={() => ctrl.economyAction({ type: 'set_crystal_reserve', amount: econ.crystalReserve - 20 })}
                aria-label={t('prod.less')}
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-7 text-center font-bold tabular-nums">{econ.crystalReserve}</span>
              <button
                type="button"
                className="w-6 h-6 rounded bg-slate-800 border border-white/10 flex items-center justify-center hover:bg-slate-700"
                onClick={() => ctrl.economyAction({ type: 'set_crystal_reserve', amount: econ.crystalReserve + 20 })}
                aria-label={t('prod.more')}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-slate-300 flex items-center gap-1">
            <Pickaxe className="w-3.5 h-3.5 text-amber-300" /> {t('prod.harvesters', { n: harvesters.length, max: GAME_BALANCE.MAX_HARVESTERS })}
          </span>
          <span className="text-[10px] text-slate-400">
            {t('prod.mining', { n: mining })}
            {onSite > 0 && <span className="text-amber-200"> · {t('prod.onSite', { n: onSite })}</span>}
            {harvInProduction > 0 && <span className="text-amber-200"> · {t('prod.onLine', { n: harvInProduction })}</span>}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1.5">
          <BuildButton
            label={factories.length ? t('prod.harvesterFactory') : t('prod.harvesterHq')}
            cost={
              harvesters.length + harvInProduction === 0
                ? t('prod.emergencyFree')
                : `${GAME_BALANCE.HARVESTER_COST_METAL} ${t('unit.metalShort')} · ${t('unit.sec', { n: GAME_BALANCE.HARVESTER_BUILD_SEC * (factories.length ? 1 : GAME_BALANCE.HQ_EMERGENCY_HARVESTER_FACTOR) })}`
            }
            title={factories.length ? t('prod.harvesterHint') : t('prod.harvesterHqHint')}
            disabled={
              (econ.metal < GAME_BALANCE.HARVESTER_COST_METAL && harvesters.length + harvInProduction > 0) ||
              harvesters.length + harvInProduction >= GAME_BALANCE.MAX_HARVESTERS
            }
            onClick={() => ctrl.economyAction({ type: 'build_harvester', count: 1 })}
            icon={<Pickaxe className="w-3.5 h-3.5" />}
          />
          <BuildButton
            label={t('prod.powerPlant', { n: plants.length, max: GAME_BALANCE.MAX_POWER_PLANTS })}
            cost={`${GAME_BALANCE.POWER_PLANT_COST_METAL} ${t('unit.metalShort')}`}
            disabled={!canPlant.ok}
            title={canPlant.reason}
            onClick={() => ctrl.economyAction({ type: 'build_power_plant' })}
            icon={<Zap className="w-3.5 h-3.5" />}
          />
          <BuildButton
            label={t('prod.factoryBuild', { n: factories.length, max: GAME_BALANCE.MAX_FACTORIES })}
            cost={`${GAME_BALANCE.FACTORY_COST_METAL} ${t('unit.metalShort')} · ${GAME_BALANCE.FACTORY_COST_COMPONENTS} ${t('unit.componentsShort')}`}
            disabled={!canFactory.ok}
            title={canFactory.reason}
            onClick={() => ctrl.economyAction({ type: 'build_factory' })}
            icon={<Factory className="w-3.5 h-3.5" />}
          />
          {(Object.keys(PAD_BUILDINGS) as PadBuildingType[]).map(type => {
            const spec = PAD_BUILDINGS[type];
            const name = t(`building.${type}` as MessageKey);
            if (!s.isUnlocked(type)) {
              return (
                <div key={type} className="flex items-center justify-between px-2 py-1 rounded-md border border-white/5 text-slate-500" title={t(`pad.desc.${type}` as MessageKey)}>
                  <span className="flex items-center gap-1.5">
                    <Lock className="w-3 h-3" /> {name}
                  </span>
                  <span className="text-[10px]">{t('pad.locked', { n: spec.unlockLevel })}</span>
                </div>
              );
            }
            const check = s.canBuildOnPad('player', type);
            return (
              <BuildButton
                key={type}
                label={`${name} (${s.buildingCount('player', type)}/${spec.maxCount})`}
                cost={`${spec.metal} ${t('unit.metalShort')}${spec.components ? ` · ${spec.components} ${t('unit.componentsShort')}` : ''}${s.crystals && spec.crystals ? ` · ${t('console.crystals', { n: spec.crystals })}` : ''}`}
                disabled={!check.ok}
                title={check.ok ? t(`pad.desc.${type}` as MessageKey) : check.reason}
                onClick={() => ctrl.economyAction({ type: 'build', building: type })}
                icon={PAD_ICONS[type]}
              />
            );
          })}
        </div>
      </div>
    </Panel>
  );
};

const CancelButton: React.FC<{ title: string; onClick: () => void }> = ({ title, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={title}
    className="w-6 h-6 shrink-0 rounded-md border flex items-center justify-center transition bg-slate-700/70 border-white/10 text-slate-200 hover:bg-rose-700/60 hover:border-rose-300/50"
  >
    <X className="w-3 h-3" />
  </button>
);

const BuildButton: React.FC<{ label: string; cost: string; disabled?: boolean; title?: string; onClick: () => void; icon: React.ReactNode }> = ({
  label,
  cost,
  disabled,
  title,
  onClick,
  icon,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="flex items-center justify-between px-2 py-1.5 rounded-md bg-slate-800/70 border border-white/10 hover:bg-teal-700/40 hover:border-teal-400/40 disabled:opacity-40 disabled:hover:bg-slate-800/70 transition text-left"
  >
    <span className="flex items-center gap-1.5 text-slate-100">
      {icon} {label}
    </span>
    <span className="text-[10px] text-amber-200 tabular-nums">{cost}</span>
  </button>
);
