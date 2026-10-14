import React, { useState } from 'react';
import { RobotDesign } from '../types/robot';
import { RobotBuilder } from '../engine/RobotBuilder';
import { ChatMessage } from '../types/agent';
import { RobotVisualizer } from './RobotVisualizer';
import { 
  Mic, 
  MicOff, 
  Send, 
  Wrench, 
  Check, 
  Shield, 
  Gauge, 
  Crosshair, 
  Volume2, 
  VolumeX,
  AlertTriangle,
  Flame,
  Radio
} from 'lucide-react';

interface EngineerPanelProps {
  currentDesign: RobotDesign;
  proposedDesign: RobotDesign | null;
  onApplyDesign: (design: RobotDesign) => void;
  onSendVoiceOrText: (text: string) => void;
  isListening: boolean;
  transcript: string;
  onToggleListen: () => void;
  isLoading: boolean;
  messages: ChatMessage[];
  isSpeaking: boolean;
}

export const EngineerPanel: React.FC<EngineerPanelProps> = ({
  currentDesign,
  proposedDesign,
  onApplyDesign,
  onSendVoiceOrText,
  isListening,
  transcript,
  onToggleListen,
  isLoading,
  messages,
  isSpeaking,
}) => {
  const [inputText, setInputText] = useState('');
  const [activeTab, setActiveTab] = useState<'console' | 'specs'>('console');

  const activeInspectDesign = proposedDesign || currentDesign;
  const stats = RobotBuilder.calculateStats(activeInspectDesign);
  const currentStats = RobotBuilder.calculateStats(currentDesign);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendVoiceOrText(inputText.trim());
    setInputText('');
  };

  const quickPrompts = [
    'Усиль броню и поставь тяжелую пушку 120мм',
    'Сделай быстрых роботов с пилами для фланга',
    'Снайперы: рельсотрон и радар на гусеницах',
    'Сбалансируй против плазменного огня',
  ];

  return (
    <div className="w-[420px] bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden pointer-events-auto max-h-[580px]">
      {/* Header with Avatar & Voice wave */}
      <div className="p-3 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-slate-700/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg border border-blue-400/30 ${isSpeaking ? 'ring-2 ring-cyan-400 animate-pulse' : ''}`}>
              <Wrench className="w-6 h-6" />
            </div>
            {isSpeaking && (
              <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-heading font-bold text-slate-100 tracking-wide">Главный Инженер Болт</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-semibold uppercase">
                GenAI
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-emerald-400" />
              <span>Цех проектирования готов к указаниям</span>
            </div>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
          <button
            onClick={() => setActiveTab('console')}
            className={`px-2.5 py-1 rounded-md transition font-medium ${activeTab === 'console' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Связь
          </button>
          <button
            onClick={() => setActiveTab('specs')}
            className={`px-2.5 py-1 rounded-md transition font-medium ${activeTab === 'specs' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Чертежи
          </button>
        </div>
      </div>

      {/* Main Body */}
      {activeTab === 'console' ? (
        <div className="flex-1 flex flex-col p-3 gap-2 overflow-hidden">
          {/* Chat / Dialogue messages */}
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-[170px] max-h-[220px]">
            {messages.length === 0 ? (
              <div className="text-center text-xs text-slate-500 my-auto py-6">
                Нажмите на микрофон или выберите команду ниже, чтобы отдать приказ инженеру перепроектировать партию роботов.
              </div>
            ) : (
              messages.map(msg => (
                <div
                  key={msg.id}
                  className={`p-2.5 rounded-xl text-xs leading-relaxed max-w-[92%] ${
                    msg.role === 'engineer'
                      ? 'bg-slate-800/90 text-slate-200 border border-slate-700/60 self-start shadow-md'
                      : 'bg-blue-600 text-white self-end shadow'
                  }`}
                >
                  <div className="font-semibold text-[10px] mb-1 opacity-60">
                    {msg.role === 'engineer' ? 'Болт (Конструктор)' : 'Командир (Вы)'}
                  </div>
                  <div>{msg.text}</div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="bg-slate-800/70 p-2 rounded-xl text-xs text-cyan-300 self-start border border-cyan-500/30 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span>Инженер рассчитывает проект и компромиссы...</span>
              </div>
            )}
          </div>

          {/* Proposed Design Bar (if any is pending) */}
          {proposedDesign && (
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-blue-950/70 to-slate-900 border border-blue-500/40 flex items-center justify-between gap-3 shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400 font-bold text-xs">
                  Mk-{proposedDesign.version}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-200">{proposedDesign.name}</div>
                  <div className="text-[11px] text-cyan-300 font-medium">
                    {stats.metalCost} металла • сборка {stats.buildTimeSec}с
                  </div>
                </div>
              </div>
              <button
                onClick={() => onApplyDesign(proposedDesign)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow transition"
              >
                <Check className="w-4 h-4" />
                В серию
              </button>
            </div>
          )}

          {/* Quick Command Pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 pt-1 no-scrollbar">
            {quickPrompts.map((q, idx) => (
              <button
                key={idx}
                onClick={() => onSendVoiceOrText(q)}
                disabled={isLoading}
                className="text-[11px] whitespace-nowrap bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 px-2.5 py-1 rounded-full border border-slate-700 transition"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Live speech-to-text transcript banner */}
          {isListening && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-center gap-2 animate-pulse">
              <Mic className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">
                {transcript || 'Слушаю ваш голосовой приказ...'}
              </span>
            </div>
          )}

          {/* Voice & Input Controls */}
          <form onSubmit={handleSubmit} className="flex gap-2 items-center pt-1">
            <button
              type="button"
              onClick={onToggleListen}
              className={`p-2.5 rounded-xl border transition shadow flex items-center justify-center ${
                isListening
                  ? 'bg-red-600 hover:bg-red-500 text-white border-red-400 animate-bounce'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title={isListening ? 'Остановить запись' : 'Голосовой ввод'}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Приказ инженеру (голосом или текстом)..."
              disabled={isLoading}
              className="flex-1 bg-slate-800/90 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
            />
            <button
              type="submit"
              disabled={isLoading || !inputText.trim()}
              className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white border border-blue-400/30 transition shadow"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        /* Specs & 3D Visualizer Tab */
        <div className="p-3 flex flex-col gap-3 overflow-y-auto max-h-[380px]">
          <div className="flex gap-3 items-center">
            <RobotVisualizer design={activeInspectDesign} width={160} height={140} />
            <div className="flex-1">
              <div className="text-xs text-blue-400 uppercase font-bold tracking-wider">
                {activeInspectDesign === proposedDesign ? 'Предлагаемый проект' : 'Текущая серия'}
              </div>
              <div className="text-sm font-bold text-slate-100 font-heading">
                {activeInspectDesign.name}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Шасси: <span className="text-slate-200">{activeInspectDesign.chassisId}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Модули: <span className="text-slate-200">{activeInspectDesign.modules.length} шт</span>
              </div>
              <div className="text-[11px] text-cyan-300 font-semibold mt-1">
                Стоимость: {stats.metalCost} M / {stats.buildTimeSec}с
              </div>
            </div>
          </div>

          {/* Engineering Tradeoffs Summary */}
          <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/70 text-xs text-slate-300 leading-relaxed">
            <span className="font-semibold text-slate-200">Вывод инженера: </span>
            {stats.tradeoffsSummaryRu}
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Shield className="w-3.5 h-3.5 text-emerald-400" /> Прочность (HP)
              </span>
              <span className="font-bold text-slate-100 font-heading">{stats.hp}</span>
            </div>

            <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Скорость
              </span>
              <span className="font-bold text-slate-100 font-heading">{stats.effectiveSpeed} м/с</span>
            </div>

            <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Crosshair className="w-3.5 h-3.5 text-red-400" /> Огневая мощь
              </span>
              <span className="font-bold text-slate-100 font-heading">{stats.dps} DPS</span>
            </div>

            <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-slate-400">
                <Shield className="w-3.5 h-3.5 text-blue-400" /> Броня
              </span>
              <span className="font-bold text-slate-100 font-heading">{Math.round(stats.armorRating * 100)}%</span>
            </div>
          </div>

          {/* Validation Errors if any */}
          {!stats.isValid && (
            <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-300 flex flex-col gap-1">
              <div className="font-bold flex items-center gap-1.5 text-red-400">
                <AlertTriangle className="w-4 h-4" /> Нарушение физических ограничений:
              </div>
              {stats.validationErrors.map((err, i) => (
                <div key={i}>• {err}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
