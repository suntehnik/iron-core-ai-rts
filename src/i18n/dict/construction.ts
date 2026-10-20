import { Translation } from '../core';

export const ruConstruction = {
  'site.queued': 'ждёт очереди',
  'site.noWorker': 'ждёт рабочего',
  'site.enRoute': 'рабочий в пути',
  'site.retreated': 'рабочий отступил',
  'site.building': 'строится {pct}%',
  'build.noSite': 'Такой стройки нет',
  'event.siteNoWorkers': 'Стройка ждёт рабочего: свободных добытчиков нет',
  'event.siteUnderFire': 'Стройка остановлена: рабочий под огнём',
  'event.siteCancelled': 'Стройка отменена, вернулось {metal} металла',
  'prod.onSite': 'на стройке {n}',
  'prod.cancelSite': 'Отменить стройку: вернётся 75% цены',
  'prod.plantSite': 'Электростанция',
  'prod.workersHint': 'Здание строит добытчик: на это время он не добывает',
};

export const enConstruction: Translation<typeof ruConstruction> = {
  'site.queued': 'queued',
  'site.noWorker': 'needs a worker',
  'site.enRoute': 'worker on the way',
  'site.retreated': 'worker fell back',
  'site.building': 'building {pct}%',
  'build.noSite': 'There is no such site',
  'event.siteNoWorkers': 'A site needs a worker: no free harvesters',
  'event.siteUnderFire': 'Construction stopped: the worker is under fire',
  'event.siteCancelled': 'Construction cancelled, {metal} metal returned',
  'prod.onSite': 'building {n}',
  'prod.cancelSite': 'Cancel the site: 75% of the price comes back',
  'prod.plantSite': 'Power plant',
  'prod.workersHint': 'A harvester builds it and does not mine meanwhile',
};

export const itConstruction: Translation<typeof ruConstruction> = {
  'site.queued': 'in coda',
  'site.noWorker': 'serve un operaio',
  'site.enRoute': 'operaio in arrivo',
  'site.retreated': 'operaio in ritirata',
  'site.building': 'in costruzione {pct}%',
  'build.noSite': 'Questo cantiere non esiste',
  'event.siteNoWorkers': 'Un cantiere aspetta un operaio: nessun raccoglitore libero',
  'event.siteUnderFire': 'Costruzione ferma: l’operaio è sotto il fuoco',
  'event.siteCancelled': 'Costruzione annullata, restituiti {metal} di metallo',
  'prod.onSite': 'in cantiere {n}',
  'prod.cancelSite': 'Annulla il cantiere: torna il 75% del prezzo',
  'prod.plantSite': 'Centrale',
  'prod.workersHint': 'La costruisce un raccoglitore, che intanto non estrae',
};
