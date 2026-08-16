import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape } from '../scraper/scrape.js';
import { summarizeDiff } from '../scraper/diff-summary.js';

const goodConfig = { locales: [{
  id: 'fruita', label: 'Fruita', emailDomain: 'fruita.org',
  scrape: { module: 'fruita', urls: { list: 'https://www.fruita.org/citycouncil' } },
  bodies: [{ id: 'council', scraped: true, expectedCount: 7 }],
}] };
const fixture = readFileSync(new URL('./fixtures/fruita-council.html', import.meta.url), 'utf8');

test('writes contacts.json for a valid locale and reports success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrape-'));
  const result = await runScrape(goodConfig, async () => fixture, dir);
  assert.deepEqual(result.failed, []);
  const out = JSON.parse(readFileSync(join(dir, 'fruita.contacts.json'), 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(out.scrapedAt)));
  assert.equal(out.bodies.council.length, 7);
});

test('does not rewrite the file when scraped data is unchanged, preserving scrapedAt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrape-'));
  await runScrape(goodConfig, async () => fixture, dir);
  const firstScrapedAt = JSON.parse(readFileSync(join(dir, 'fruita.contacts.json'), 'utf8')).scrapedAt;
  await new Promise(resolve => setTimeout(resolve, 5));
  await runScrape(goodConfig, async () => fixture, dir);
  const secondScrapedAt = JSON.parse(readFileSync(join(dir, 'fruita.contacts.json'), 'utf8')).scrapedAt;
  assert.equal(secondScrapedAt, firstScrapedAt);
});

test('a failing locale writes nothing and is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrape-'));
  const result = await runScrape(goodConfig, async () => '<html><body>Site redesigned!</body></html>', dir);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].errors.join(' '), /expected 7 members, got 0|fetch failed/i);
  assert.ok(!existsSync(join(dir, 'fruita.contacts.json')));
});

test('a change scrape.js writes is always a change diff-summary.js can describe', async () => {
  // The failure this guards: scrape.js wrote on any structural difference while
  // summarizeDiff only reported tracked-field changes, so scrape.yml (which
  // required both) could discard a real update with no PR and no issue.
  const dir = mkdtempSync(join(tmpdir(), 'scrape-'));
  await runScrape(goodConfig, async () => fixture, dir);
  const file = join(dir, 'fruita.contacts.json');
  const first = JSON.parse(readFileSync(file, 'utf8'));

  // Same roster, reordered: must still be treated as a change AND summarized.
  const reordered = { ...first, bodies: { council: [...first.bodies.council].reverse() } };
  writeFileSync(file, JSON.stringify(reordered, null, 2) + '\n');
  await runScrape(goodConfig, async () => fixture, dir);
  const rewritten = JSON.parse(readFileSync(file, 'utf8'));
  assert.notDeepEqual(rewritten.bodies.council.map(p => p.name), reordered.bodies.council.map(p => p.name));
  assert.ok(summarizeDiff(reordered, rewritten, 'fruita').length > 0,
    'a rewrite must produce at least one summary line');

  // A field outside TRACKED_FIELDS + name is not a contact change at all.
  const noise = { ...rewritten, bodies: { council: rewritten.bodies.council.map(p => ({ ...p, extra: 1 })) } };
  writeFileSync(file, JSON.stringify(noise, null, 2) + '\n');
  await runScrape(goodConfig, async () => fixture, dir);
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).bodies.council[0].extra === 1,
    'untracked noise must not trigger a rewrite');
});
