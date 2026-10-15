import React from 'react';

/** Cartoon agent portraits (concept art: friendly robot with headphones). */

export const EngineerPortrait: React.FC<{ size?: number; talking?: boolean }> = ({ size = 56, talking }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Инженер Болт">
    <rect x="8" y="10" width="48" height="42" rx="14" fill="#f4ecdb" stroke="#2b2622" strokeWidth="2.5" />
    <rect x="14" y="18" width="36" height="22" rx="9" fill="#1d2a33" stroke="#2b2622" strokeWidth="2" />
    <ellipse cx="25" cy="29" rx="4.5" ry={talking ? 3.5 : 5} fill="#5eead4" />
    <ellipse cx="39" cy="29" rx="4.5" ry={talking ? 3.5 : 5} fill="#5eead4" />
    <path d={talking ? 'M26 45 Q32 50 38 45' : 'M27 45 Q32 47 37 45'} stroke="#2b2622" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <path d="M6 30 Q6 4 32 4 Q58 4 58 30" stroke="#0f766e" strokeWidth="4" fill="none" />
    <rect x="1" y="24" width="10" height="16" rx="4" fill="#14b8a6" stroke="#2b2622" strokeWidth="2" />
    <rect x="53" y="24" width="10" height="16" rx="4" fill="#14b8a6" stroke="#2b2622" strokeWidth="2" />
    <path d="M56 38 Q52 50 42 50" stroke="#2b2622" strokeWidth="2" fill="none" />
    <circle cx="41" cy="50" r="2.5" fill="#f2b134" stroke="#2b2622" strokeWidth="1.5" />
  </svg>
);

export const TacticianPortrait: React.FC<{ size?: number; talking?: boolean }> = ({ size = 56, talking }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Тактик Кобра">
    <line x1="44" y1="10" x2="50" y2="1" stroke="#2b2622" strokeWidth="2.5" />
    <circle cx="50" cy="2.5" r="2.5" fill="#f2b134" stroke="#2b2622" strokeWidth="1.5" />
    <path d="M8 34 Q8 8 32 8 Q56 8 56 34 L56 46 Q56 56 46 56 L18 56 Q8 56 8 46 Z" fill="#14b8a6" stroke="#2b2622" strokeWidth="2.5" />
    <rect x="12" y="24" width="40" height="14" rx="7" fill="#1d2a33" stroke="#2b2622" strokeWidth="2" />
    <rect x="17" y="28" width={talking ? 30 : 12} height="6" rx="3" fill="#7ef0ff" />
    <rect x="20" y="44" width="24" height="6" rx="3" fill="#f4ecdb" stroke="#2b2622" strokeWidth="1.5" />
    <path d="M14 16 L24 12" stroke="#f4ecdb" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const GeneralPortrait: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Генерал Ржавый">
    <rect x="10" y="16" width="44" height="40" rx="10" fill="#f97316" stroke="#2b2622" strokeWidth="2.5" />
    <path d="M6 20 L58 20 L52 8 L12 8 Z" fill="#7c2d12" stroke="#2b2622" strokeWidth="2.5" />
    <circle cx="32" cy="14" r="3" fill="#f2b134" stroke="#2b2622" strokeWidth="1.5" />
    <rect x="16" y="26" width="13" height="9" rx="3" fill="#1d2a33" />
    <rect x="35" y="26" width="13" height="9" rx="3" fill="#1d2a33" />
    <circle cx="22" cy="30.5" r="2.5" fill="#ff6a3d" />
    <circle cx="41" cy="30.5" r="2.5" fill="#ff6a3d" />
    <path d="M18 44 Q25 39 32 44 Q39 39 46 44 Q39 48 32 45 Q25 48 18 44 Z" fill="#3a2a20" stroke="#2b2622" strokeWidth="1.5" />
  </svg>
);
