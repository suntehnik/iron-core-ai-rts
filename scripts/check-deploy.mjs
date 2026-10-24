// Guard run before every Firebase Hosting deploy (README, «Публикация на Firebase Hosting»):
//  - .firebaserc names a project instead of the placeholder;
//  - the build holds no secret Vite can read (LLM_API_KEY from .env.local and the like, or the shell
//    environment) and no .env file. Only the variable name and the file are printed, never the value.
// Usage: node scripts/check-deploy.mjs [distDir], run from the project root.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadEnv } from 'vite';

const PLACEHOLDER = 'YOUR_FIREBASE_PROJECT_ID';
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;
/** Shorter values (flags, ports) would match by chance. */
const MIN_SECRET_LENGTH = 8;

const root = process.cwd();
const dist = join(root, process.argv[2] ?? 'dist');
const problems = [];

const rcPath = join(root, '.firebaserc');
const project = existsSync(rcPath) ? JSON.parse(readFileSync(rcPath, 'utf8')).projects?.default : undefined;
if (!project || project === PLACEHOLDER) {
  problems.push(`.firebaserc: укажите id своего проекта Firebase вместо ${PLACEHOLDER}`);
}

let files = [];
let secrets = [];
if (!existsSync(dist)) {
  problems.push(`${relative(root, dist)}: сборки нет, сначала npm run build`);
} else {
  // The same files and mode `npm run build` loads; prefix '' adds the process environment too
  const env = loadEnv('production', root, '');
  secrets = Object.entries(env).filter(([name, value]) => SECRET_NAME.test(name) && value.length >= MIN_SECRET_LENGTH);
  files = readdirSync(dist, { recursive: true })
    .map(f => join(dist, f))
    .filter(f => statSync(f).isFile());
  for (const file of files) {
    const rel = relative(root, file);
    if (/(^|[\\/])\.env/.test(rel)) problems.push(`${rel}: файл окружения попал в сборку`);
    const bytes = readFileSync(file);
    for (const [name, value] of secrets) {
      if (bytes.includes(value)) problems.push(`${rel}: содержит значение ${name}`);
    }
  }
}

if (problems.length) {
  console.error(`Деплой остановлен:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Проверка перед деплоем: проект ${project}, файлов в сборке ${files.length}, секретов не найдено (проверено переменных: ${secrets.length})`);
