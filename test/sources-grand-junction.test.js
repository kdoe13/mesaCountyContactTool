import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrape } from '../scraper/sources/grand-junction.js';

const list = readFileSync(new URL('./fixtures/gj-list.html', import.meta.url), 'utf8');
const laurel = readFileSync(new URL('./fixtures/gj-profile-laurel.html', import.meta.url), 'utf8');

// Real fixture for the list page and one profile; synthetic minimal pages for the rest.
const fakeFetch = async (url) => {
  if (url.includes('/313/')) return list;
  if (url.includes('Laurel-Cole')) return laurel;
  const slug = url.split('/').pop();                       // e.g. "Ben-Van-Dyke"
  const email = slug.toLowerCase().replace(/-/g, '.');     // not the real scheme; just a unique synthetic
  return `<html><body><a href="mailto:${email}@gjcity.org">Email</a></body></html>`;
};

const cfg = { emailDomain: 'gjcity.org', urls: { list: 'https://www.gjcity.org/313/City-Council' } };

test('grand-junction: 7 members, emails resolved from profile pages', async () => {
  const people = await scrape(fakeFetch, cfg);
  assert.equal(people.length, 7);
  const names = people.map(p => p.name).join('|');
  for (const expected of ['Laurel Lutz', 'Van Dyke', 'Kennedy', 'Nguyen', 'Stout', 'Ballard', 'Beilfuss']) {
    assert.match(names, new RegExp(expected));
  }
  const laurelP = people.find(p => /Laurel/.test(p.name));
  assert.equal(laurelP.email, 'laurel.cole@gjcity.org');   // from the real profile fixture
  assert.ok(laurelP.profileUrl.startsWith('https://www.gjcity.org/'));
  const kennedy = people.find(p => /Kennedy/.test(p.name));
  assert.equal(kennedy.district, 'District A');
  for (const p of people) assert.match(p.email, /@gjcity\.org$/);
});
