import React from 'react';
import { Factory, Minus, Pause, Pickaxe, Play, Plus, Zap } from 'lucide-react';
import { GAME_BALANCE } from '../config/balance';
import { GameController } from '../game/GameController';
import { Panel, ProgressBar, cx } from './ui';

/** Mining, factory queues and base construction (brief §3, §7). */
export const ProductionPanel: React.FC<{ ctrl: GameController }> = ({ ctrl }) => {
  const s = ctrl.state;
  const econ = s.teams.player.economy;
  const factories = s.buildings.filter(b => b.team === 'player' && b.type === 'factory');
  const plants = s.buildings.filter(b => b.team === 'player' && b.type === 'power_plant');
  const harvesters = s.units.filter(u => u.team === 'player' && u.kind === 'harvester');
  const mining = harvesters.filter(h => h.kind === 'harvester' && (h.state === 'harvesting' || h.carrying > 0)).length;
  const harvInProduction = s.harvestersInProduction('player');
  const allPaused = factories.length > 0 && factories.every(f => f.paused);
  const canPlant = s.canBuild('player', 'power_plant');
  const canFactory = s.canBuild('player', 'factory');

  return (
    <Panel
      className="w-[264px]"
      title={<><Factory className="w-3.5 h-3.5 text-teal-300" /> Производство</>}
      right={
        factories.length > 1 ? (
          <button
            type="button"
            onClick={() => ctrl.economyAction({ type: 'set_production', paused: !allPaused })}
            className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1"
            title={allPaused ? 'Запустить все заводы' : 'Остановить все заводы'}
          >
            {allPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />} {allPaused ? 'все' : 'стоп все'}
          </button>
        ) : undefined
      }
    >
      <div className="p-2.5 flex flex-col gap-2 text-[11px]">
        {factories.length === 0 && (
          <div className="text-rose-300">
            Завод уничтожен — постройте новый!
            {s.getHQ('player')?.harvesterBuild && (
              <div className="text-[10px] text-amber-200 mt-0.5">
                Цех штаба собирает добытчика: {Math.round((s.getHQ('player')!.harvesterBuild!.progressSec / s.getHQ('player')!.harvesterBuild!.totalSec) * 100)}%
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
                <span className="font-semibold text-slate-100">Завод {i + 1}</span>
                <span className="flex items-center gap-1.5">
                  <span className={cx('text-[10px]', status === 'Сборка' || status === 'Добытчик' ? 'text-teal-300' : 'text-amber-300')}>{status}</span>
                  {f.built >= 1 && (
                    <button
                      type="button"
                      onClick={() => ctrl.toggleFactory(f.id)}
                      title={f.paused ? 'Возобновить производство' : 'Остановить производство: завод не тратит металл и энергию'}
                      aria-label={f.paused ? `Запустить завод ${i + 1}` : `Остановить завод ${i + 1}`}
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
                    Добытчик{job ? <> · затем партия #{job.batchNumber}</> : null}
                  </div>
                  <ProgressBar value={hb.progressSec / hb.totalSec} color="#f2b134" className={cx('mt-1', f.paused && 'opacity-50')} />
                </>
              ) : job ? (
                <>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                    Партия #{job.batchNumber}: <span className="text-slate-200">{job.design.name}</span> · {job.batchSize - job.remaining + 1}/{job.batchSize}
                  </div>
                  <ProgressBar value={job.progressSec / job.unitTimeSec} className={cx('mt-1', f.paused && 'opacity-50')} />
                </>
              ) : f.paused ? (
                <div className="text-[10px] text-amber-200/80 mt-0.5">Металл копится, энергия свободна</div>
              ) : (
                <div className="text-[10px] text-slate-400 mt-0.5">Нужно {s.teams.player.design.name}: металл и компоненты</div>
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between">
          <span className="text-slate-300">Размер партии</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="w-6 h-6 rounded bg-slate-800 border border-white/10 flex items-center justify-center hover:bg-slate-700"
              onClick={() => ctrl.economyAction({ type: 'set_batch_size', size: econ.batchSize - 1 })}
              aria-label="Меньше"
            >
              <Minus className="w-3 h-3" />
            </button>
            <span className="w-5 text-center font-bold tabular-nums">{econ.batchSize}</span>
            <button
              type="button"
              className="w-6 h-6 rounded bg-slate-800 border border-white/10 flex items-center justify-center hover:bg-slate-700"
              onClick={() => ctrl.economyAction({ type: 'set_batch_size', size: econ.batchSize + 1 })}
              aria-label="Больше"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-300 flex items-center gap-1">
            <Pickaxe className="w-3.5 h-3.5 text-amber-300" /> Добытчики {harvesters.length}/{GAME_BALANCE.MAX_HARVESTERS}
          </span>
          <span className="text-[10px] text-slate-400">
            в работе {mining}
            {harvInProduction > 0 && <span className="text-amber-200"> · на заводе {harvInProduction}</span>}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-1.5">
          <BuildButton
            label={factories.length ? 'Добытчик (на заводе)' : 'Добытчик (цех штаба)'}
            cost={
              harvesters.length + harvInProduction === 0
                ? 'аварийный · бесплатно'
                : `${GAME_BALANCE.HARVESTER_COST_METAL} М · ${GAME_BALANCE.HARVESTER_BUILD_SEC * (factories.length ? 1 : GAME_BALANCE.HQ_EMERGENCY_HARVESTER_FACTOR)} с`
            }
            title={factories.length ? 'Собирается на заводе вместо боевой машины' : 'Завода нет — аварийный цех штаба собирает вдвое дольше'}
            disabled={
              (econ.metal < GAME_BALANCE.HARVESTER_COST_METAL && harvesters.length + harvInProduction > 0) ||
              harvesters.length + harvInProduction >= GAME_BALANCE.MAX_HARVESTERS
            }
            onClick={() => ctrl.economyAction({ type: 'build_harvester', count: 1 })}
            icon={<Pickaxe className="w-3.5 h-3.5" />}
          />
          <BuildButton
            label={`Электростанция (${plants.length}/${GAME_BALANCE.MAX_POWER_PLANTS})`}
            cost={`${GAME_BALANCE.POWER_PLANT_COST_METAL} М`}
            disabled={!canPlant.ok}
            title={canPlant.reason}
            onClick={() => ctrl.economyAction({ type: 'build_power_plant' })}
            icon={<Zap className="w-3.5 h-3.5" />}
          />
          <BuildButton
            label={`Завод (${factories.length}/${GAME_BALANCE.MAX_FACTORIES})`}
            cost={`${GAME_BALANCE.FACTORY_COST_METAL} М · ${GAME_BALANCE.FACTORY_COST_COMPONENTS} К`}
            disabled={!canFactory.ok}
            title={canFactory.reason}
            onClick={() => ctrl.economyAction({ type: 'build_factory' })}
            icon={<Factory className="w-3.5 h-3.5" />}
          />
        </div>
      </div>
    </Panel>
  );
};

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
