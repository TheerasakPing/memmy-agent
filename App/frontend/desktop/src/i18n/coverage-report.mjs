/** Report audited explicit Thai translations; fallback strings do not count. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(directory, 'messages.ts'), 'utf8');
const thai = readFileSync(resolve(directory, 'th-messages.ts'), 'utf8');
const en = source.slice(source.indexOf('export const enUSMessages:'), source.indexOf('export type MessageKey'));
const pattern = /^  "([^"]+)":/gm;
const errorNotices = readFileSync(resolve(directory, 'error-notice-messages.ts'), 'utf8');
const englishErrorStart = errorNotices.indexOf('export const enUSErrorNoticeMessages = {');
const englishErrorEnd = errorNotices.indexOf('} satisfies Record<keyof typeof zhCNErrorNoticeMessages', englishErrorStart);
const englishErrors = errorNotices.slice(englishErrorStart, englishErrorEnd);
const thaiErrors = errorNotices.slice(errorNotices.indexOf('export const thErrorNoticeMessages = {'));
const keys = [...en.matchAll(pattern), ...englishErrors.matchAll(pattern)].map(match => match[1]);
const translated = new Set([...thai.matchAll(pattern), ...thaiErrors.matchAll(pattern)].map(match => match[1]));
for (let i = 0; i < 8; i++) {
  const p = resolve(directory, 'th-packs', `part-${String(i).padStart(2, '0')}.json`);
  if (!existsSync(p)) continue;
  for (const key of Object.keys(JSON.parse(readFileSync(p, 'utf8')))) translated.add(key);
}
const missing = keys.filter(key => !translated.has(key));
const extraneous = [...translated].filter(key => !keys.includes(key));
const groups = {};
for (const key of keys) {
  const group = key.split('.')[0];
  groups[group] ??= { total: 0, translated: 0 };
  groups[group].total++;
  if (translated.has(key)) groups[group].translated++;
}
const report = { total: keys.length, translated: keys.length - missing.length,
  percent: Number((100 * (keys.length - missing.length) / keys.length).toFixed(1)),
  missing, extraneous, groups };
if (process.argv[2] === '--json') console.log(JSON.stringify(report, null, 2));
else console.log(`Thai locale: ${report.translated}/${report.total} (${report.percent}%), remaining ${missing.length}; unknown keys ${extraneous.length}`);
if (process.argv[2] === '--write') writeFileSync(resolve(directory, '../../../../docs/qa/thai-locale-coverage.json'), JSON.stringify(report, null, 2) + '\n');
if (extraneous.length) process.exitCode = 1;
