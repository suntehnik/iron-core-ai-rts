import { Team } from '../types/game';
import { MessageKey, t } from '../i18n';

/** AI commanders. The enemy one always plays; the teal one takes the player's side in AI-vs-AI mode. */
export interface CommanderProfile {
  name: string;
  armyRu: string; // genitive: "армия оранжевых роботов"
  persona: string;
  /** for the English prompts of the on-device model (it has no Russian) */
  nameEn: string;
  armyEn: string;
  personaEn: string;
}

/** The commander's name in the game language (`name` is the Russian original used by the Russian prompts). */
export function commanderName(team: Team): string {
  return t(team === 'enemy' ? 'commander.enemy' : 'commander.player');
}

/** A random radio jab of the rule-based commander, in the game language. */
export function commanderTaunt(team: Team, random: number): string {
  const n = 1 + Math.floor(random * 6);
  return t(`taunt.${team}.${n}` as MessageKey);
}

/** Name of a design the rule-based commander invents, e.g. «Ржавый Гончая Mk-2» / «Segugio Arrugginito Mk-2». */
export function commanderDesignName(team: Team, name: string, version: number): string {
  return t('design.localName', { prefix: t(team === 'enemy' ? 'commander.enemy.prefix' : 'commander.player.prefix'), name, n: version });
}

export const COMMANDERS: Record<Team, CommanderProfile> = {
  enemy: {
    name: 'Генерал Ржавый',
    nameEn: 'General Rusty',
    armyRu: 'оранжевых',
    armyEn: 'orange',
    personaEn: 'Boastful and sarcastic',
    persona: 'Хвастливый и язвительный',
  },
  player: {
    name: 'Командор Бирюзов',
    nameEn: 'Commodore Teal',
    armyRu: 'бирюзовых',
    armyEn: 'teal',
    personaEn: 'An imperturbable pedant with dry irony',
    persona: 'Невозмутимый педант с сухой иронией',
  },
};
