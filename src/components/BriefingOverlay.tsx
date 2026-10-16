import React, { useState } from 'react';
import { Cpu, Eye, MessageSquarePlus, Mic, Play, Settings, Swords, Wrench } from 'lucide-react';
import { COMMANDER_INSTRUCTIONS_MAX } from '../ai/prompts';
import { LLM_PROVIDERS } from '../config/llmProviders';
import { GameController } from '../game/GameController';
import { CommanderPortrait, EngineerPortrait } from './Portraits';
import { cx, useCompactHud } from './ui';

export const BriefingOverlay: React.FC<{ ctrl: GameController; onOpenSettings: () => void }> = ({ ctrl, onOpenSettings }) => {
  const cloud = ctrl.director.cloudEnabled();
  const onDevice = LLM_PROVIDERS[ctrl.settings.provider].protocol === 'native';
  const modelWord = onDevice ? 'моделью на устройстве' : 'облачной моделью';
  const [instructionsOpen, setInstructionsOpen] = useState(!!ctrl.allyInstructions);
  // Short screens (a phone in landscape): no tutorial cards, both modes side by side, so nothing hides below the edge
  const compact = useCompactHud();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#1b1712]/55 backdrop-blur-[2px]">
      <div className={cx('hud-panel w-full max-w-[640px] max-h-full overflow-y-auto text-slate-100', compact ? 'p-4' : 'p-6')}>
        <div className="flex items-start gap-4">
          <EngineerPortrait size={compact ? 52 : 72} />
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-teal-300 font-bold">Iron Core · AI Commander</div>
            <h1 className={cx('font-heading font-bold mt-1', compact ? 'text-xl' : 'text-2xl')}>Прорвите оборону и разрушьте вражеский штаб</h1>
            <p className={cx('text-slate-300 mt-1', compact ? 'text-xs' : 'text-sm')}>
              Вы не ведёте каждого робота — вы ставите задачи GenAI-агентам. Они проектируют машины и планируют бой, а игра считает физику и
              исполняет план.
            </p>
          </div>
        </div>

        {!compact && (
          <>
          <div className="grid grid-cols-3 gap-2 mt-5 text-xs">
            <Step icon={<Wrench className="w-4 h-4" />} title="Конструктор Болт" text="«Больше брони, меньше скорости» — проект, сравнение характеристик, «в серию»." />
            <Step icon={<Swords className="w-4 h-4" />} title="Тактик Кобра" text="«Держите центр, раненых на ремонт» — план армии, пересмотры по событиям боя." />
            <Step icon={<Mic className="w-4 h-4" />} title="Голос или текст" text="Микрофон — распознавание речи; любой приказ можно напечатать." />
          </div>

          <div className="mt-4 text-[11px] text-slate-300 leading-relaxed">
            Цикл: добыча → партия роботов → наблюдайте столкновение → найдите слабость → поручите изменение → новая партия продвигает фронт.
            Изменения применяются к следующим партиям. Добытчики, электростанции и второй завод — в панели «Производство».
          </div>
          </>
        )}

        <div className={cx(compact ? 'mt-3' : 'mt-4', 'flex items-center gap-2 p-2.5 rounded-lg border text-xs', cloud ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-amber-500/10 border-amber-400/30')}>
          <Cpu className={cx('w-4 h-4 shrink-0', cloud ? 'text-emerald-300' : 'text-amber-300')} />
          <div className="flex-1">
            {cloud ? (
              <>
                Боты подключены к LLM: <b>{ctrl.director.providerLabel()}</b>. Вражеский генерал тоже думает {modelWord}.
              </>
            ) : (
              <>Облачный LLM не настроен — агенты будут отвечать локальными эвристиками. Укажите провайдера и ключ в настройках.</>
            )}
          </div>
          <button type="button" onClick={onOpenSettings} className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 font-semibold">
            <Settings className="w-3.5 h-3.5" /> Настроить
          </button>
        </div>

        <div className={cx(compact ? 'mt-3 grid grid-cols-2 gap-2' : 'mt-5 flex flex-col gap-2')}>
          <button
            type="button"
            onClick={() => ctrl.start('human')}
            className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-teal-900/40"
          >
            <Play className="w-5 h-5" /> Начать матч
          </button>
          <button
            type="button"
            onClick={() => ctrl.start('spectator')}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-slate-100 flex items-center gap-3 text-left transition"
          >
            <span className="flex -space-x-2 shrink-0">
              <CommanderPortrait team="player" size={compact ? 28 : 34} />
              <CommanderPortrait team="enemy" size={compact ? 28 : 34} />
            </span>
            <span className="flex-1">
              <span className="font-heading font-bold text-sm flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-cyan-300" /> {compact ? 'ИИ против ИИ' : 'ИИ против ИИ — режим наблюдения'}
              </span>
              {compact ? (
                <span className="block text-[11px] text-slate-400 leading-snug">Бирюзов против Ржавого, вы наблюдаете</span>
              ) : (
                <span className="block text-[11px] text-slate-400 leading-snug">
                  Командор Бирюзов и Генерал Ржавый воюют без вашего участия: оба проектируют роботов и планируют бой{' '}
                  {cloud ? modelWord : 'на локальных правилах'}. Можно ускорить до ×4.
                </span>
              )}
            </span>
          </button>
        </div>
        {instructionsOpen ? (
          <div className="mt-1.5 rounded-lg bg-slate-800/60 border border-teal-400/20 p-2">
            <label htmlFor="ally-instructions" className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-200">
              <CommanderPortrait team="player" size={18} /> Указания Командору Бирюзову
              <span className="font-normal text-slate-400">— необязательно</span>
            </label>
            <textarea
              id="ally-instructions"
              rows={compact ? 2 : 3}
              maxLength={COMMANDER_INSTRUCTIONS_MAX}
              value={ctrl.allyInstructions}
              onChange={e => ctrl.setAllyInstructions(e.target.value)}
              placeholder="Например: играй от обороны, копи на тяжёлые машины с осадными пушками, в рейды не ходи"
              className="mt-1.5 w-full resize-none rounded-md bg-slate-900/80 border border-white/10 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-teal-400/60"
            />
            <div className="flex justify-between gap-2 text-[10px] text-slate-400">
              <span>
                {cloud
                  ? 'Попадут в промпт Бирюзова: и в плановые сводки, и в быстрые пересмотры плана. Генерал Ржавый их не видит.'
                  : 'Работают только с LLM: без неё командиры играют по локальным правилам.'}
              </span>
              <span className="tabular-nums shrink-0">
                {ctrl.allyInstructions.length}/{COMMANDER_INSTRUCTIONS_MAX}
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setInstructionsOpen(true)}
            className="mt-1.5 flex items-center gap-1 text-[11px] text-teal-300 hover:text-teal-200"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" /> Дать указания Командору Бирюзову
          </button>
        )}
        {!compact && (
          <div className="text-[10px] text-slate-400 text-center mt-2">Камера: перетаскивание мышью, колесо — масштаб, WASD/стрелки, клик по мини-карте.</div>
        )}
      </div>
    </div>
  );
};

const Step: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <div className="rounded-lg bg-slate-800/60 border border-white/10 p-2.5">
    <div className="flex items-center gap-1.5 font-semibold text-teal-200">
      {icon} {title}
    </div>
    <div className="text-slate-300 mt-1 leading-snug">{text}</div>
  </div>
);
