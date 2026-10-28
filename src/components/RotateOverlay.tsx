import React from 'react';
import { Maximize, Smartphone } from 'lucide-react';
import { enterFullscreen, suggestHomeScreen, useFullscreen, usePortraitPhone } from './device';
import { t } from '../i18n';

/**
 * A phone held upright: the HUD does not fit, so the game asks to turn it. Where the browser can,
 * fullscreen also locks the screen to landscape (Android Chrome turns it by itself).
 */
export const RotateOverlay: React.FC = () => {
  const portrait = usePortraitPhone();
  const fs = useFullscreen();
  if (!portrait) return null;
  return (
    <div className="safe-pad fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 text-center bg-[#1b1712] text-slate-100">
      <Smartphone className="w-14 h-14 text-teal-300 rotate-hint" aria-hidden />
      <h2 className="font-heading text-xl font-bold">{t('rotate.title')}</h2>
      <p className="text-sm text-slate-300 max-w-[300px] leading-snug">{t('rotate.text')}</p>
      {fs.supported && !fs.active && (
        <button
          type="button"
          onClick={() => void enterFullscreen()}
          className="min-h-[48px] px-5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-heading font-bold flex items-center gap-2"
        >
          <Maximize className="w-5 h-5" /> {t('top.fullscreen')}
        </button>
      )}
      {suggestHomeScreen() && <p className="text-xs text-slate-400 max-w-[300px] leading-snug">{t('fs.homeScreen')}</p>}
    </div>
  );
};
