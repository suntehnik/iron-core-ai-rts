import { Entry, Lang, format, getLanguage } from './core';
import { enAgents, itAgents, ruAgents } from './dict/agents';
import { enCampaign, itCampaign, ruCampaign } from './dict/campaign';
import { enCatalog, itCatalog, ruCatalog } from './dict/catalog';
import { enGame, itGame, ruGame } from './dict/game';
import { enHud, itHud, ruHud } from './dict/hud';

export * from './core';

/**
 * Area dictionaries are merged here. `t` checks keys at compile time; English and Italian are typed
 * against Russian, so every string exists in every language.
 */
const RU = { ...ruHud, ...ruGame, ...ruAgents, ...ruCatalog, ...ruCampaign };
const EN: Record<MessageKey, Entry> = { ...enHud, ...enGame, ...enAgents, ...enCatalog, ...enCampaign };
const IT: Record<MessageKey, Entry> = { ...itHud, ...itGame, ...itAgents, ...itCatalog, ...itCampaign };

export type MessageKey = keyof typeof RU;

const DICTS: Record<Lang, Record<string, Entry>> = { ru: RU, en: EN, it: IT };

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const lang = getLanguage();
  const entry = DICTS[lang][key] ?? (RU as Record<string, Entry>)[key] ?? key;
  return format(entry, params, lang);
}
