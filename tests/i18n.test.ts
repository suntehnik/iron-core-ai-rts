import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIDirector } from '../src/ai/AIDirector';
import { parseCostLimitPct } from '../src/ai/prompts';
import { refreshNativeStatus } from '../src/ai/llm/nativeBridge';
import { initialDesign } from '../src/config/balance';
import { CHASSIS_IDS, MODULE_IDS, chassisDescription, chassisName, partDescription, partName } from '../src/config/catalog';
import { commanderName } from '../src/config/commanders';
import { GameState } from '../src/engine/GameState';
import { DEFAULT_SETTINGS, GameController } from '../src/game/GameController';
import { Entry, LANGS, Lang, getLanguage, languageFromLocale, setLanguage, t } from '../src/i18n';
import { enAgents, itAgents, ruAgents } from '../src/i18n/dict/agents';
import { enCatalog, itCatalog, ruCatalog } from '../src/i18n/dict/catalog';
import { enGame, itGame, ruGame } from '../src/i18n/dict/game';
import { enHud, itHud, ruHud } from '../src/i18n/dict/hud';
import { LLMSettings } from '../src/types/agent';

const DICTS: Record<Lang, Record<string, Entry>> = {
  ru: { ...ruHud, ...ruGame, ...ruAgents, ...ruCatalog },
  en: { ...enHud, ...enGame, ...enAgents, ...enCatalog },
  it: { ...itHud, ...itGame, ...itAgents, ...itCatalog },
};

const placeholders = (e: Entry) =>
  [...new Set((typeof e === 'string' ? [e] : Object.values(e)).flatMap(s => [...(s ?? '').matchAll(/\{(\w+)\}/g)].map(m => m[1])))].sort();

afterEach(async () => {
  setLanguage('ru');
  vi.unstubAllGlobals();
  await refreshNativeStatus();
});

describe('dictionaries', () => {
  it('every language has every key, non-empty, with the same placeholders as Russian', () => {
    const problems: string[] = [];
    for (const [key, ru] of Object.entries(DICTS.ru)) {
      for (const lang of ['en', 'it'] as const) {
        const entry = DICTS[lang][key];
        if (entry === undefined) problems.push(`${lang}: missing ${key}`);
        else if (typeof entry === 'string' ? !entry.trim() : !entry.other.trim()) problems.push(`${lang}: empty ${key}`);
        else if (placeholders(entry).join() !== placeholders(ru).join()) problems.push(`${lang}: ${key} has {${placeholders(entry)}} instead of {${placeholders(ru)}}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('every chassis and part has a name and a description in every language', () => {
    for (const lang of LANGS) {
      setLanguage(lang);
      for (const id of CHASSIS_IDS) {
        expect(chassisName(id)).not.toBe(`chassis.${id}`);
        expect(chassisDescription(id)).not.toBe(`chassis.${id}.desc`);
      }
      for (const id of MODULE_IDS) {
        expect(partName(id)).not.toBe(`part.${id}`);
        expect(partDescription(id)).not.toBe(`part.${id}.desc`);
      }
    }
  });

  it('plural forms follow the language rules', () => {
    expect([1, 3, 5].map(count => t('tac.armyCount', { count }))).toEqual(['1 машина', '3 машины', '5 машин']);
    setLanguage('en');
    expect([1, 5].map(count => t('tac.armyCount', { count }))).toEqual(['1 robot', '5 robots']);
    setLanguage('it');
    expect([1, 5].map(count => t('tac.armyCount', { count }))).toEqual(['1 robot', '5 robot']);
  });

  it('the game texts follow the switch', () => {
    setLanguage('it');
    expect(commanderName('player')).toBe('Commodoro Turchese');
    expect(initialDesign('player').name).not.toBe(initialDesign('player').name.replace(/[a-z]/gi, ''));
    expect(new GameState().teams.player.design.name).toBe(initialDesign('player').name);
    setLanguage('en');
    expect(commanderName('enemy')).toBe('General Rusty');
  });
});

describe('language choice', () => {
  it('a device locale maps to a game language, English by default', () => {
    expect(languageFromLocale('ru-RU')).toBe('ru');
    expect(languageFromLocale('it-IT')).toBe('it');
    expect(languageFromLocale('en-GB')).toBe('en');
    expect(languageFromLocale('de-DE')).toBe('en');
    expect(languageFromLocale(undefined)).toBe('en');
  });

  it('on the start screen the switch rebuilds the waiting match and remembers the choice', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const ctrl = new GameController();
    const ruName = ctrl.state.teams.player.design.name;
    ctrl.setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(store.get('ironcore_lang')).toBe('en');
    expect(ctrl.state.teams.player.design.name).not.toBe(ruName);
    expect(ctrl.chat).toHaveLength(1);
    expect(ctrl.chat[0].text).toContain(ctrl.state.teams.player.design.name);
  });

  it('the cost cap is understood in every language', () => {
    expect(parseCostLimitPct('no more than a quarter more expensive')).toBe(25);
    expect(parseCostLimitPct('keep the cost within 30%')).toBe(30);
    expect(parseCostLimitPct('same price, please')).toBe(0);
    expect(parseCostLimitPct('non più caro di un terzo')).toBe(33);
    expect(parseCostLimitPct('costo al massimo 20 per cento in più')).toBe(20);
    expect(parseCostLimitPct('make it faster')).toBeNull();
    expect(parseCostLimitPct('rendilo più veloce')).toBeNull();
  });
});

describe('agents in the English and Italian game', () => {
  const device: LLMSettings = { ...DEFAULT_SETTINGS, provider: 'device', apiKey: '', model: 'apple-on-device', baseUrl: '', autoSpeakResponse: false, soundMuted: true };

  it('the on-device engineer is asked to answer in Italian, with no translation either way', async () => {
    const ops: string[] = [];
    const prompts: { system: string; user: string }[] = [];
    vi.stubGlobal('webkit', {
      messageHandlers: {
        ironcoreLLM: {
          postMessage: async (m: { op: string; system?: string; user?: string }) => {
            ops.push(m.op);
            if (m.op === 'status') return { available: true, translation: 'installed', contextSize: 4096 };
            prompts.push({ system: m.system ?? '', user: m.user ?? '' });
            const reply = { reply: 'Più corazza, gambe più lente.', design: { name: 'Bastione', chassis: 'medium_tracked', modules: ['reinforced_steel', 'autocannon_20mm'], role: 'frontline' }, actions: [], costLimitPct: null, compromise: 'velocità' };
            return { text: JSON.stringify(reply), tokensIn: 300, tokensOut: 40, estimated: false };
          },
        },
      },
    });
    await refreshNativeStatus();
    setLanguage('it');
    const chat: string[] = [];
    const d = new AIDirector(device, { chat: m => chat.push(m.text), proposal() {}, tactical() {}, intercept() {}, changed() {} });
    await d.sendEngineerOrder(new GameState(), 'Metti più corazza');
    expect(ops).not.toContain('translate');
    expect(prompts[0].system).toContain('in Italian');
    expect(prompts[0].system + prompts[0].user).not.toMatch(/[⟦⟧]/);
    expect(prompts[0].user).toContain('"Metti più corazza"');
    expect(d.pendingProposal?.design?.name).toBe('Bastione');
    expect(chat[chat.length - 1]).toBe('Più corazza, gambe più lente. Compromesso: velocità.');
  });
});
