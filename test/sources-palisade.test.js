import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrape } from '../scraper/sources/palisade.js';

const fixture = readFileSync(new URL('./fixtures/palisade-board.html', import.meta.url), 'utf8');
const cfg = { urls: { list: 'https://palisade.colorado.gov/board-of-trustees' } };

test('palisade: 7 board members from h6 headings, roles parsed, emails null', async () => {
  const people = await scrape(async () => fixture, cfg);
  assert.equal(people.length, 7);
  const mayor = people.find(p => p.title === 'Mayor');
  assert.match(mayor.name, /Mikolai/);
  const proTem = people.find(p => p.title === 'Mayor Pro-Tem');
  assert.match(proTem.name, /Matchett/);
  assert.equal(people.filter(p => p.title === 'Trustee').length, 5);
  for (const p of people) {
    assert.equal(p.email, null);
    assert.equal(p.district, null);
  }
});
