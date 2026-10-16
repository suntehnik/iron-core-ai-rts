import React, { useEffect, useRef } from 'react';
import { GAME_BALANCE, TEAM_COLORS } from '../config/balance';
import { GameController } from '../game/GameController';
import { t } from '../i18n';

const MW = 216;
const MH = Math.round((MW * GAME_BALANCE.MAP_HEIGHT) / GAME_BALANCE.MAP_WIDTH);

/** Minimap with the camera frame; click to move the camera (brief §7). */
export const Minimap: React.FC<{ ctrl: GameController; version: number }> = ({ ctrl, version }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const s = ctrl.state;
    const kx = MW / GAME_BALANCE.MAP_WIDTH;
    const ky = MH / GAME_BALANCE.MAP_HEIGHT;
    ctx.fillStyle = '#26303b';
    ctx.fillRect(0, 0, MW, MH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(MW / 2, 0);
    ctx.lineTo(MW / 2, MH);
    ctx.stroke();

    for (const p of s.resourcePatches) {
      if (p.metalRemaining <= 0) continue;
      ctx.fillStyle = '#9fb3c8';
      ctx.beginPath();
      ctx.arc(p.pos.x * kx, p.pos.y * ky, 2 + 2 * (p.metalRemaining / p.maxMetal), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#8a8f96';
    for (const sc of s.scrapPiles) ctx.fillRect(sc.pos.x * kx - 1, sc.pos.y * ky - 1, 2, 2);
    for (const b of s.buildings) {
      ctx.fillStyle = TEAM_COLORS[b.team].main;
      const size = b.type === 'command_center' ? 9 : 6;
      ctx.globalAlpha = b.built < 1 ? 0.5 : 1;
      ctx.fillRect(b.pos.x * kx - size / 2, b.pos.y * ky - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    for (const u of s.units) {
      ctx.fillStyle = u.kind === 'harvester' ? (u.team === 'player' ? '#a7f3d0' : '#fed7aa') : TEAM_COLORS[u.team].glow;
      ctx.fillRect(u.pos.x * kx - 1.5, u.pos.y * ky - 1.5, u.kind === 'combat' ? 3 : 2.5, u.kind === 'combat' ? 3 : 2.5);
    }
    const corners = ctrl.viewportCorners();
    if (corners.length === 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach((p, i) => (i ? ctx.lineTo(p.x * kx, p.y * ky) : ctx.moveTo(p.x * kx, p.y * ky)));
      ctx.closePath();
      ctx.stroke();
    }
  }, [ctrl, version]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * GAME_BALANCE.MAP_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * GAME_BALANCE.MAP_HEIGHT;
    ctrl.focusCamera(x, y);
  };

  return (
    <div className="hud-panel pointer-events-auto p-1.5">
      <canvas ref={ref} width={MW} height={MH} onClick={onClick} className="block rounded-md cursor-crosshair" title={t('minimap.title')} />
    </div>
  );
};
