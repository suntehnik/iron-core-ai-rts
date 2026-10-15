import React from 'react';
import { Cpu, Mic, Play, Settings, Swords, Wrench } from 'lucide-react';
import { GameController } from '../game/GameController';
import { EngineerPortrait } from './Portraits';
import { cx } from './ui';

export const BriefingOverlay: React.FC<{ ctrl: GameController; onOpenSettings: () => void }> = ({ ctrl, onOpenSettings }) => {
  const cloud = ctrl.director.cloudEnabled();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#1b1712]/55 backdrop-blur-[2px]">
      <div className="hud-panel w-full max-w-[640px] p-6 text-slate-100">
        <div className="flex items-start gap-4">
          <EngineerPortrait size={72} />
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-teal-300 font-bold">Iron Core · AI Commander</div>
            <h1 className="font-heading text-2xl font-bold mt-1">Прорвите оборону и разрушьте вражеский штаб</h1>
            <p className="text-sm text-slate-300 mt-1">
              Вы не ведёте каждого робота — вы ставите задачи GenAI-агентам. Они проектируют машины и планируют бой, а игра считает физику и
              исполняет план.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-5 text-xs">
          <Step icon={<Wrench className="w-4 h-4" />} title="Конструктор Болт" text="«Больше брони, меньше скорости» — проект, сравнение характеристик, «в серию»." />
          <Step icon={<Swords className="w-4 h-4" />} title="Тактик Кобра" text="«Держите центр, раненых на ремонт» — план армии, пересмотры по событиям боя." />
          <Step icon={<Mic className="w-4 h-4" />} title="Голос или текст" text="Микрофон — распознавание речи; любой приказ можно напечатать." />
        </div>

        <div className="mt-4 text-[11px] text-slate-300 leading-relaxed">
          Цикл: добыча → партия роботов → наблюдайте столкновение → найдите слабость → поручите изменение → новая партия продвигает фронт.
          Изменения применяются к следующим партиям. Добытчики, электростанции и второй завод — в панели «Производство».
        </div>

        <div className={cx('mt-4 flex items-center gap-2 p-2.5 rounded-lg border text-xs', cloud ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-amber-500/10 border-amber-400/30')}>
          <Cpu className={cx('w-4 h-4 shrink-0', cloud ? 'text-emerald-300' : 'text-amber-300')} />
          <div className="flex-1">
            {cloud ? (
              <>
                Боты подключены к LLM: <b>{ctrl.director.providerLabel()}</b>. Вражеский генерал тоже думает облачной моделью.
              </>
            ) : (
              <>Облачный LLM не настроен — агенты будут отвечать локальными эвристиками. Укажите провайдера и ключ в настройках.</>
            )}
          </div>
          <button type="button" onClick={onOpenSettings} className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 font-semibold">
            <Settings className="w-3.5 h-3.5" /> Настроить
          </button>
        </div>

        <button
          type="button"
          onClick={() => ctrl.start()}
          className="mt-5 w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-teal-900/40"
        >
          <Play className="w-5 h-5" /> Начать матч
        </button>
        <div className="text-[10px] text-slate-400 text-center mt-2">Камера: перетаскивание мышью, колесо — масштаб, WASD/стрелки, клик по мини-карте.</div>
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
