/**
 * Game localization: Russian (the original), English, Italian.
 *
 * Strings live in area dictionaries (src/i18n/dict/*.ts) that keep the three languages side by side;
 * the English and Italian ones are typed against the Russian one, so a missing key fails `tsc`.
 * A value is either a string with {placeholders} or plural forms picked by Intl.PluralRules
 * from the `count` parameter.
 */

export type Lang = 'ru' | 'en' | 'it';
export const LANGS: Lang[] = ['ru', 'en', 'it'];

export type PluralForms = { one: string; few?: string; many?: string; other: string };
export type Entry = string | PluralForms;
/** Another language's dictionary for the same keys as the Russian one. */
export type Translation<T> = { [K in keyof T]: Entry };

let current: Lang = 'ru';
const listeners = new Set<(lang: Lang) => void>();

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(lang: Lang) {
  if (lang === current) return;
  current = lang;
  for (const fn of listeners) fn(lang);
}

export function onLanguageChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The language of a browser or device locale such as "it-IT" or "en-GB". */
export function languageFromLocale(locale: string | undefined): Lang {
  const code = (locale ?? '').toLowerCase();
  if (code.startsWith('ru')) return 'ru';
  if (code.startsWith('it')) return 'it';
  return 'en';
}

/** BCP-47 locale for speech recognition and synthesis. */
export const SPEECH_LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-US', it: 'it-IT' };

/** Name of each language in itself, for the language switch. */
export const LANG_LABEL: Record<Lang, string> = { ru: 'Русский', en: 'English', it: 'Italiano' };

type Params = Record<string, string | number>;

export function format(entry: Entry, params: Params | undefined, lang: Lang): string {
  let text: string;
  if (typeof entry === 'string') text = entry;
  else {
    const count = Number(params?.count ?? 0);
    const form = new Intl.PluralRules(lang).select(count) as keyof PluralForms;
    text = entry[form] ?? entry.other;
  }
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}
