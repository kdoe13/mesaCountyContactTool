import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { fetchHtml } from './lib/fetch.js';
import { validateContacts } from './validate.js';
import { TRACKED_FIELDS } from './diff-summary.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// A roster is "unchanged" only in terms of the very fields diff-summary.js
// reports on — importing the same TRACKED_FIELDS list keeps the write decision
// and the PR body from drifting apart (a change we write but cannot describe
// used to be discarded silently by scrape.yml).
function trackedShape(bodies) {
  return Object.fromEntries(Object.entries(bodies ?? {}).map(([id, people]) => [
    id, (people ?? []).map(p => [p.name, ...TRACKED_FIELDS.map(f => p[f] ?? null)]),
  ]));
}

export async function runScrape(config, fetchImpl, dataDir) {
  const failed = [];
  for (const locale of config.locales) {
    try {
      const mod = await import(pathToFileURL(join(ROOT, 'scraper', 'sources', `${locale.scrape.module}.js`)).href);
      const people = await mod.scrape(fetchImpl, { ...locale.scrape, emailDomain: locale.emailDomain });
      const errors = validateContacts(locale, people);
      if (errors.length) { failed.push({ id: locale.id, errors }); continue; }
      const body = locale.bodies.find(b => b.scraped);
      const newBodies = { [body.id]: people };
      const filePath = join(dataDir, `${locale.id}.contacts.json`);
      let existing = null;
      if (existsSync(filePath)) {
        try { existing = JSON.parse(readFileSync(filePath, 'utf8')); } catch { existing = null; }
      }
      if (existing && isDeepStrictEqual(trackedShape(existing.bodies), trackedShape(newBodies))) {
        console.log(`ok   ${locale.id}: ${people.length} members (unchanged)`);
      } else {
        const out = { scrapedAt: new Date().toISOString(), bodies: newBodies };
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n');
        console.log(`ok   ${locale.id}: ${people.length} members`);
      }
    } catch (err) {
      failed.push({ id: locale.id, errors: [err.message] });
    }
  }
  for (const f of failed) console.error(`FAIL ${f.id}:\n  - ${f.errors.join('\n  - ')}`);
  return { failed };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = JSON.parse(readFileSync(join(ROOT, 'config', 'locales.json'), 'utf8'));
  const only = process.argv.find(a => a.startsWith('--locale='))?.split('=')[1];
  if (only) config.locales = config.locales.filter(l => l.id === only);
  const { failed } = await runScrape(config, fetchHtml, join(ROOT, 'data'));
  process.exit(failed.length ? 1 : 0);
}
