/** Campaign progress kept in this browser: the furthest open level and the best victory times. */
export interface CampaignProgress {
  /** highest level the player may start (1 at the beginning) */
  unlocked: number;
  /** fastest victory per level, in game seconds */
  best: Record<number, number>;
}

const CAMPAIGN_KEY = 'ironcore_campaign_v1';

export function loadCampaign(): CampaignProgress {
  try {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<CampaignProgress>;
      const unlocked = Math.max(1, Math.floor(Number(p.unlocked) || 1));
      const best: Record<number, number> = {};
      for (const [k, v] of Object.entries(p.best ?? {})) if (Number(v) > 0) best[Number(k)] = Number(v);
      return { unlocked, best };
    }
  } catch {
    /* private mode or blocked storage: start from level 1 */
  }
  return { unlocked: 1, best: {} };
}

export function saveCampaign(p: CampaignProgress) {
  try {
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** A won level opens the next one and may set a new best time. */
export function recordVictory(p: CampaignProgress, level: number, seconds: number): CampaignProgress {
  const prev = p.best[level];
  return {
    unlocked: Math.max(p.unlocked, level + 1),
    best: { ...p.best, [level]: prev ? Math.min(prev, Math.round(seconds)) : Math.round(seconds) },
  };
}
