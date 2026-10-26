/** Strict build-time QA for concurrently authored Thai locale shards.
 * Explicit translations only: no English autofill is permitted in this catalog.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(base, 'messages.ts'), 'utf8');
const start = source.indexOf('export const enUSMessages: Record<keyof typeof zhCNMessages, string> = {');
const end = source.indexOf('\n};\n\nexport type MessageKey', start);
if (start < 0 || end < 0) throw Error('English i18n source shape unexpectedly changed');
const records = source.slice(start, end).matchAll(/^  ("(?:\\.|[^"\\])+"):\s*("(?:\\.|[^"\\])*")\s*,?\s*$/gm);
const english = new Map([...records].map(match => [JSON.parse(match[1]), JSON.parse(match[2])]));
if (english.size < 2000) throw Error('English catalog parser returned incomplete key set');
const errorSource = readFileSync(join(base, 'error-notice-messages.ts'), 'utf8');
const extraStart = errorSource.indexOf('export const enUSErrorNoticeMessages = {');
const extraEnd = errorSource.indexOf('} satisfies Record<keyof typeof zhCNErrorNoticeMessages', extraStart);
if (extraStart < 0 || extraEnd < 0) throw Error('English error notice catalog is missing');
for (const match of errorSource.slice(extraStart, extraEnd).matchAll(/^  ("(?:\\.|[^"\\])+"):\s*("(?:\\.|[^"\\])*")\s*,?\s*$/gm)) {
  const [key, value] = [JSON.parse(match[1]), JSON.parse(match[2])];
  if (english.has(key)) throw Error('duplicate English error key: ' + key);
  english.set(key, value);
}
const thaiErrorStart = errorSource.indexOf('export const thErrorNoticeMessages = {');
if (thaiErrorStart < 0) throw Error('Thai error notice catalog is missing');
const thaiErrorKeys = [...errorSource.slice(thaiErrorStart).matchAll(/^  "([^"]+)":/gm)].map(match=>match[1]);
const manual = readFileSync(join(base,'th-messages.ts'),'utf8');
const manualKeys = new Set([...manual.matchAll(/^  "([^"]+)":/gm)].map(match => match[1]).concat(thaiErrorKeys));
const automated = {};
const problems = [];
for (let i=0;i<8;i++) {
  const id = String(i).padStart(2,'0');
  const output = JSON.parse(readFileSync(join(base, `th-packs/part-${id}.json`),'utf8'));
  const b = Object.keys(output);
  if (b.length!==247) problems.push(`${id}: expected 247 keys, got ${b.length}`);
  for (const [key, value] of Object.entries(output)) {
    if (typeof value!=='string' || (!value.trim() && (english.get(key)??'').trim())) problems.push(`${id}: missing/invalid translation ${key}`);
    if (!english.has(key) || manualKeys.has(key) || Object.hasOwn(automated,key)) problems.push(`${id}: duplicate/invalid key ${key}`);
    const tokens=(str)=>[...(str.match(/\{[a-zA-Z0-9_]+\}/g)??[])].sort().join('|');
    if(tokens(english.get(key)??'')!==tokens(value)) problems.push(`${id}: placeholder mismatch ${key}`);
    automated[key]=value;
  }
}
const full = new Set([...manualKeys,...Object.keys(automated)]);
if(full.size!==english.size || [...english.keys()].some(key=>!full.has(key))) problems.push(`locale coverage incomplete: ${full.size}/${english.size}`);
const unknown=[...full].filter(key=>!english.has(key));if(unknown.length) problems.push(`unknown keys: ${unknown.slice(0,5)}`);
if(problems.length) {for(const error of problems.slice(0,35)) console.error(error);process.exit(1)}
const outfile=join(base,'th-generated-messages.ts');
const contents=`/** Generated from th-packs/*.json after strict key and placeholder review.\n * Edit the source pack, never this file.\n */\nexport const thGeneratedMessages: Record<string, string> = ${JSON.stringify(automated,null,2)};\n`;
writeFileSync(outfile,contents);
console.log(`Thai translation: ${full.size}/${english.size} explicit keys, ${Object.keys(automated).length} agent translations plus ${manualKeys.size} reviewed baseline. Valid placeholders. ${contents.length} bytes generated.`);
