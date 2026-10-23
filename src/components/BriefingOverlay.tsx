import React, { useState, useSyncExternalStore } from 'react';
import { BarChart3, Cpu, Eye, Flag, Lock, MessageSquarePlus, Mic, Play, Settings, Swords, Wrench } from 'lucide-react';
import { analytics } from '../analytics';
import { COMMANDER_INSTRUCTIONS_MAX } from '../ai/prompts';
import { nativeStatus, nativeUnavailableText } from '../ai/llm/nativeBridge';
import { LLM_PROVIDERS } from '../config/llmProviders';
import { GameController } from '../game/GameController';
import { CommanderPortrait, EngineerPortrait } from './Portraits';
import { LanguageSwitch, cx, formatTime, useCompactHud } from './ui';
import { t } from '../i18n';
import { commanderName } from '../config/commanders';
import { CAMPAIGN, ENDLESS_FROM, levelConfig } from '../config/levels';
import { enemyEdge, levelDescription, levelName } from '../game/levelText';

export const BriefingOverlay: React.FC<{ ctrl: GameController; onOpenSettings: () => void }> = ({ ctrl, onOpenSettings }) => {
  const cloud = ctrl.director.cloudEnabled();
  const onDevice = LLM_PROVIDERS[ctrl.settings.provider].protocol === 'native';
  const modelWord = onDevice ? t('brief.modelDevice') : t('brief.modelCloud');
  const [instructionsOpen, setInstructionsOpen] = useState(!!ctrl.allyInstructions);
  // Short screens (a phone in landscape): no tutorial cards, both modes side by side, so nothing hides below the edge
  const compact = useCompactHud();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#1b1712]/55 backdrop-blur-[2px]">
      <div className={cx('hud-panel w-full max-w-[640px] max-h-full overflow-y-auto text-slate-100', compact ? 'p-4' : 'p-6')}>
        <div className="flex items-start gap-4">
          <EngineerPortrait size={compact ? 52 : 72} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-teal-300 font-bold">Iron Core · AI Commander</div>
              <LanguageSwitch value={ctrl.language} onChange={lang => ctrl.setLanguage(lang)} short />
            </div>
            <h1 className={cx('font-heading font-bold mt-1', compact ? 'text-xl' : 'text-2xl')}>{t('brief.title')}</h1>
            <p className={cx('text-slate-300 mt-1', compact ? 'text-xs' : 'text-sm')}>
              {t('brief.intro')}
            </p>
          </div>
        </div>

        {!compact && (
          <>
          <div className="grid grid-cols-3 gap-2 mt-5 text-xs">
            <Step icon={<Wrench className="w-4 h-4" />} title={t('brief.step.engineer')} text={t('brief.step.engineerText')} />
            <Step icon={<Swords className="w-4 h-4" />} title={t('brief.step.tactician')} text={t('brief.step.tacticianText')} />
            <Step icon={<Mic className="w-4 h-4" />} title={t('brief.step.voice')} text={t('brief.step.voiceText')} />
          </div>

          <div className="mt-4 text-[11px] text-slate-300 leading-relaxed">
            {t('brief.cycle')}
          </div>
          </>
        )}

        <div className={cx(compact ? 'mt-3' : 'mt-4', 'flex items-center gap-2 p-2.5 rounded-lg border text-xs', cloud ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-amber-500/10 border-amber-400/30')}>
          <Cpu className={cx('w-4 h-4 shrink-0', cloud ? 'text-emerald-300' : 'text-amber-300')} />
          <div className="flex-1">
            {cloud ? (
              <>
                {t('brief.connected', { label: ctrl.director.providerLabel(), how: modelWord })}
              </>
            ) : (
              onDevice ? (
                <>
                  {t('brief.deviceUnavailable', { why: nativeUnavailableText(nativeStatus()) })}
                </>
              ) : (
                <>{t('brief.noCloud')}</>
              )
            )}
          </div>
          <button type="button" onClick={onOpenSettings} className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-700 hover:bg-slate-600 font-semibold">
            <Settings className="w-3.5 h-3.5" /> {t('brief.configure')}
          </button>
        </div>

        <LevelPicker ctrl={ctrl} compact={compact} />

        <div className={cx(compact ? 'mt-2 grid grid-cols-2 gap-2' : 'mt-3 flex flex-col gap-2')}>
          <button
            type="button"
            onClick={() => ctrl.start('human')}
            className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-teal-900/40"
          >
            <Play className="w-5 h-5" /> {t('brief.start')}
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
                <Eye className="w-4 h-4 text-cyan-300" /> {compact ? t('brief.aiVsAi') : t('brief.aiVsAiLong')}
              </span>
              {compact ? (
                <span className="block text-[11px] text-slate-400 leading-snug">{t('brief.aiVsAiShort')}</span>
              ) : (
                <span className="block text-[11px] text-slate-400 leading-snug">
                  {t('brief.aiVsAiText', { teal: commanderName('player'), rusty: commanderName('enemy'), how: cloud ? modelWord : t('brief.modelRules') })}
                </span>
              )}
            </span>
          </button>
        </div>
        {instructionsOpen ? (
          <div className="mt-1.5 rounded-lg bg-slate-800/60 border border-teal-400/20 p-2">
            <label htmlFor="ally-instructions" className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-200">
              <CommanderPortrait team="player" size={18} /> {t('brief.ordersTitle')}
              <span className="font-normal text-slate-400">{t('brief.optional')}</span>
            </label>
            <textarea
              id="ally-instructions"
              rows={compact ? 2 : 3}
              maxLength={COMMANDER_INSTRUCTIONS_MAX}
              value={ctrl.allyInstructions}
              onChange={e => ctrl.setAllyInstructions(e.target.value)}
              placeholder={t('brief.ordersPlaceholder')}
              className="mt-1.5 w-full resize-none rounded-md bg-slate-900/80 border border-white/10 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-teal-400/60"
            />
            <div className="flex justify-between gap-2 text-[10px] text-slate-400">
              <span>
                {cloud
                  ? t('brief.ordersCloud')
                  : t('brief.ordersNoLlm')}
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
            <MessageSquarePlus className="w-3.5 h-3.5" /> {t('brief.giveOrders')}
          </button>
        )}
        <StatsPrompt />
        {!compact && (
          <div className="text-[10px] text-slate-400 text-center mt-2">{t('brief.camera')}</div>
        )}
      </div>
    </div>
  );
};

/** Asks once for anonymous statistics: nothing is loaded or sent before the player agrees. */
const StatsPrompt: React.FC = () => {
  useSyncExternalStore(analytics.subscribe, analytics.getVersion, analytics.getVersion);
  if (!analytics.shouldAsk) return null;
  return (
    <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-slate-800/60 border border-white/10 text-[11px]">
      <BarChart3 className="w-4 h-4 shrink-0 text-teal-300 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-100">{t('stats.ask')}</div>
        <div className="text-[10px] text-slate-400 leading-snug mt-0.5">{t('stats.askText')}</div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button type="button" onClick={() => analytics.setConsent(true)} className="px-2.5 py-1 rounded-md bg-teal-600 hover:bg-teal-500 text-white font-semibold">
          {t('stats.yes')}
        </button>
        <button type="button" onClick={() => analytics.setConsent(false)} className="px-2.5 py-1 rounded-md bg-slate-700 hover:bg-slate-600 font-semibold">
          {t('stats.no')}
        </button>
      </div>
    </div>
  );
};

/** Campaign ladder: open levels can be replayed, the next locked one shows what it takes. */
const LevelPicker: React.FC<{ ctrl: GameController; compact: boolean }> = ({ ctrl, compact }) => {
  const { unlocked, best } = ctrl.campaign;
  const selected = levelConfig(ctrl.selectedLevel);
  const endless = unlocked >= ENDLESS_FROM;
  const chip = (n: number, label: string) => {
    const locked = n > unlocked;
    const active = n === ctrl.selectedLevel || (n >= ENDLESS_FROM && ctrl.selectedLevel >= ENDLESS_FROM);
    return (
      <button
        key={n}
        type="button"
        disabled={locked}
        onClick={() => ctrl.selectLevel(n)}
        title={locked ? t('campaign.locked', { n: n - 1 }) : levelName(levelConfig(n))}
        className={cx(
          'min-w-[34px] px-2 py-1 rounded-md text-xs font-heading font-bold tabular-nums flex items-center justify-center gap-1 border transition',
          active ? 'bg-teal-600 border-teal-300/60 text-white' : locked ? 'bg-slate-900/60 border-white/5 text-slate-500 cursor-not-allowed' : 'bg-slate-800 border-white/10 text-slate-200 hover:bg-slate-700',
        )}
      >
        {locked ? <Lock className="w-3 h-3" /> : null}
        {label}
      </button>
    );
  };
  return (
    <div className={cx(compact ? 'mt-3' : 'mt-4', 'rounded-lg bg-slate-800/50 border border-white/10 p-2.5')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-[11px] uppercase tracking-[0.15em] font-bold text-teal-300 mr-1">
          <Flag className="w-3.5 h-3.5" /> {t('campaign.title')}
        </span>
        {CAMPAIGN.map(l => chip(l.n, String(l.n)))}
        {endless && chip(unlocked, t('campaign.endlessChip', { n: ctrl.selectedLevel >= ENDLESS_FROM ? ctrl.selectedLevel : unlocked }))}
      </div>
      <div className="mt-2 text-xs">
        <div className="font-semibold text-slate-100">
          {t('campaign.level', { n: selected.n })} · {levelName(selected)}
          {best[selected.n] ? <span className="ml-2 font-normal text-amber-300">{t('campaign.best', { time: formatTime(best[selected.n]) })}</span> : null}
        </div>
        {!compact && <div className="text-slate-300 mt-0.5 leading-snug">{levelDescription(selected)}</div>}
        <div className="text-[11px] text-orange-200/90 mt-0.5 leading-snug">{enemyEdge(selected)}</div>
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
