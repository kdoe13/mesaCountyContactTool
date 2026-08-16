import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The per-person fields a contact change is judged on. scrape.js imports this
// same list to decide whether a scrape is a real change worth writing, so the
// two can never disagree about what counts.
export const TRACKED_FIELDS = ['email', 'district', 'title', 'phone', 'profileUrl'];

export function summarizeDiff(oldData, newData, localeId) {
  const lines = [];
  const bodies = new Set([...Object.keys(oldData.bodies ?? {}), ...Object.keys(newData.bodies ?? {})]);
  for (const bodyId of bodies) {
    const oldPeople = new Map((oldData.bodies?.[bodyId] ?? []).map(p => [p.name, p]));
    const newPeople = new Map((newData.bodies?.[bodyId] ?? []).map(p => [p.name, p]));
    for (const [name, p] of newPeople) {
      const prev = oldPeople.get(name);
      if (!prev) { lines.push(`**${localeId}**: added ${name} (${p.email ?? 'no email'})`); continue; }
      for (const field of TRACKED_FIELDS) {
        if ((prev[field] ?? null) !== (p[field] ?? null)) {
          lines.push(`**${localeId}**: ${name}'s ${field} changed from \`${prev[field]}\` to \`${p[field]}\``);
        }
      }
    }
    for (const name of oldPeople.keys()) {
      if (!newPeople.has(name)) lines.push(`**${localeId}**: removed ${name}`);
    }
    // Membership is name-keyed above, so a pure reorder on the source page
    // would otherwise rewrite the file while producing zero summary lines —
    // and scrape.yml would then discard a real (display-order) change with no
    // PR and no issue. Report it instead.
    const oldNames = [...oldPeople.keys()];
    const newNames = [...newPeople.keys()];
    if (oldNames.length === newNames.length
        && oldNames.some((n, i) => n !== newNames[i])
        && oldNames.every(n => newPeople.has(n))) {
      lines.push(`**${localeId}**: listing order changed (now ${newNames.join(', ')})`);
    }
  }
  return lines;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const dataDir = join(ROOT, 'data');
  const all = [];
  for (const file of readdirSync(dataDir).filter(f => f.endsWith('.contacts.json'))) {
    const localeId = file.replace('.contacts.json', '');
    let oldData = { bodies: {} };
    try {
      oldData = JSON.parse(execSync(`git show HEAD:data/${file}`, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }));
    } catch { /* new file: no HEAD version to compare against */ }
    const newData = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
    all.push(...summarizeDiff(oldData, newData, localeId));
  }
  if (all.length) {
    const localeCount = new Set(all.map(l => l.match(/^\*\*(.+?)\*\*/)?.[1])).size;
    const changeWord = all.length === 1 ? 'change' : 'changes';
    const localeWord = localeCount === 1 ? 'locale' : 'locales';
    console.log(`Scheduled scrape found contact changes: ${all.length} ${changeWord} across ${localeCount} ${localeWord}\n\n${all.map(l => `- ${l}`).join('\n')}`);
  } else {
    console.log('No contact changes.');
  }
}
