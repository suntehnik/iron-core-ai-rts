import React from 'react';
import { AICoinTelemetry } from '../types/game';
import { Coins, Activity, Mic, Sparkles, Cpu } from 'lucide-react';

interface AICoinTrackerProps {
  telemetry: AICoinTelemetry;
}

export const AICoinTracker: React.FC<AICoinTrackerProps> = ({ telemetry }) => {
  return (
    <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 shadow-xl backdrop-blur-md pointer-events-auto flex items-center gap-5 text-xs">
      {/* Coin Balance */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400">
          <Coins className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-400 tracking-wider font-semibold">
            AI-Монеты
          </div>
          <div className="text-sm font-bold text-amber-300 font-heading">
            {telemetry.coinBalance} <span className="text-[10px] text-slate-500 font-normal">/ {telemetry.matchLimit}</span>
          </div>
        </div>
      </div>

      {/* Tokens / Costs breakdown */}
      <div className="hidden sm:flex items-center gap-4 border-l border-slate-700/70 pl-4">
        {/* Tokens In/Out */}
        <div className="flex items-center gap-1.5 text-slate-300">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            Токены: <strong className="text-slate-100">{telemetry.totalTokensIn + telemetry.totalTokensOut}</strong>
          </span>
        </div>

        {/* Latency */}
        <div className="flex items-center gap-1.5 text-slate-300">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span>
            Отклик: <strong className="text-slate-100">{telemetry.lastRequestLatencyMs} мс</strong>
          </span>
        </div>

        {/* ASR / TTS Activity */}
        <div className="flex items-center gap-1.5 text-slate-300">
          <Mic className="w-3.5 h-3.5 text-purple-400" />
          <span>
            ASR/TTS: <strong className="text-slate-100">{(telemetry.asrSecondsTotal + telemetry.ttsSecondsTotal).toFixed(1)}с</strong>
          </span>
        </div>
      </div>
    </div>
  );
};
