import { Team } from '../types/game';

/** AI commanders. The enemy one always plays; the teal one takes the player's side in AI-vs-AI mode. */
export interface CommanderProfile {
  name: string;
  armyRu: string; // genitive: "армия оранжевых роботов"
  designPrefix: string;
  persona: string;
  taunts: string[];
  /** for the English prompts of the on-device model (it has no Russian) */
  nameEn: string;
  armyEn: string;
  personaEn: string;
}

export const COMMANDERS: Record<Team, CommanderProfile> = {
  enemy: {
    name: 'Генерал Ржавый',
    nameEn: 'General Rusty',
    armyRu: 'оранжевых',
    armyEn: 'orange',
    personaEn: 'Boastful and sarcastic',
    designPrefix: 'Ржавый',
    persona: 'Хвастливый и язвительный',
    taunts: [
      'Ваши железки скрипят громче, чем стреляют!',
      'Мои конвейеры уже знают ваши слабые места.',
      'Сдавайтесь, пока у вас ещё есть металлолом.',
      'Это была разведка боем. Настоящий бой впереди!',
      'Ржавчина — это не возраст, это стиль.',
      'Ваш инженер собирает роботов по инструкции от тостера?',
    ],
  },
  player: {
    name: 'Командор Бирюзов',
    nameEn: 'Commodore Teal',
    armyRu: 'бирюзовых',
    armyEn: 'teal',
    personaEn: 'An imperturbable pedant with dry irony',
    designPrefix: 'Бирюзовый',
    persona: 'Невозмутимый педант с сухой иронией',
    taunts: [
      'Ржавчина — не стиль, а диагноз.',
      'Мои расчёты точнее ваших залпов.',
      'Бирюзовый — цвет победы. Запишите.',
      'Ваша броня скрипит. Слышно даже отсюда.',
      'Инженерия побеждает хвастовство.',
      'Предлагаю сдаться до следующей партии.',
    ],
  },
};
