import React from 'react';
import { TacticalDoctrine } from '../types/game';
import { Target, Compass, Shield } from 'lucide-react';

interface TacticalPanelProps {
  doctrine: TacticalDoctrine;
  onChangeDoctrine: (updated: Partial<TacticalDoctrine>) => void;
}

export const TacticalPanel: React.FC<TacticalPanelProps> = ({
  doctrine,
  onChangeDoctrine,
}) => {
  return (
    <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 shadow-xl backdrop-blur-md pointer-events-auto flex flex-col gap-2.5 min-w-[280px]">
      <div className="flex items-center justify-between border-b border-slate-700/60 pb-2">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-cyan-400" />
          <span className="font-heading font-bold text-xs uppercase text-slate-200 tracking-wider">
            Боевая доктрина армии
          </span>
        </div>
      </div>

      {/* Engagement Range */}
      <div>
        <div className="text-[11px] text-slate-400 mb-1 font-medium">Дистанция боя:</div>
        <div className="grid grid-cols-3 gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
          <button
            onClick={() => onChangeDoctrine({ engagementRange: 'close_brawl' })}
            className={`py-1 rounded font-medium transition ${
              doctrine.engagementRange === 'close_brawl'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            В упор
          </button>
          <button
            onClick={() => onChangeDoctrine({ engagementRange: 'balanced' })}
            className={`py-1 rounded font-medium transition ${
              doctrine.engagementRange === 'balanced'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Баланс
          </button>
          <button
            onClick={() => onChangeDoctrine({ engagementRange: 'max_range' })}
            className={`py-1 rounded font-medium transition ${
              doctrine.engagementRange === 'max_range'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Кайт (Макс)
          </button>
        </div>
      </div>

      {/* Target Priority */}
      <div>
        <div className="text-[11px] text-slate-400 mb-1 font-medium">Приоритет целей:</div>
        <div className="grid grid-cols-3 gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
          <button
            onClick={() => onChangeDoctrine({ targetPriority: 'closest' })}
            className={`py-1 rounded font-medium transition ${
              doctrine.targetPriority === 'closest'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Ближние
          </button>
          <button
            onClick={() => onChangeDoctrine({ targetPriority: 'high_threat_heavies' })}
            className={`py-1 rounded font-medium transition ${
              doctrine.targetPriority === 'high_threat_heavies'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Тяжелые
          </button>
          <button
            onClick={() => onChangeDoctrine({ targetPriority: 'scouts_harvesters' })}
            className={`py-1 rounded font-medium transition ${
              doctrine.targetPriority === 'scouts_harvesters'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Сборщики
          </button>
        </div>
      </div>
    </div>
  );
};
