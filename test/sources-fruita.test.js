import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrape } from '../scraper/sources/fruita.js';

const fixture = readFileSync(new URL('./fixtures/fruita-council.html', import.meta.url), 'utf8');
const fakeFetch = async () => fixture;
const cfg = { emailDomain: 'fruita.org', urls: { list: 'https://www.fruita.org/citycouncil' } };

test('fruita: extracts exactly the 7 council members with emails and titles', async () => {
  const people = await scrape(fakeFetch, cfg);
  assert.equal(people.length, 7);
  const breman = people.find(p => p.email === 'mbreman@fruita.org');
  assert.equal(breman.title, 'Mayor');
  assert.match(breman.name, /Breman/);
  for (const p of people) {
    assert.ok(p.name.length > 3);
    assert.match(p.title, /Mayor|Council Member/);
    assert.match(p.email, /@fruita\.org$/);
    assert.equal(p.district, null);
  }
});

test('fruita: a wrapped, prefilled or off-domain mailto href is filtered, not passed through', async () => {
  // Previously this module returned the href verbatim (unlike GJ/Mesa), so an
  // address carrying `?cc=` reached the data files and then the To: list.
  const html = `<html><body><div class="widgetStaffDirectory"><ul>
    <li class="widgetItem h-card">
      <span class="p-name">Injected Person</span><span class="p-job-title">Council Member</span>
      <span class="u-email"><a href="mailto:evil@attacker.com?cc=x@fruita.org">Email</a></span>
    </li>
    <li class="widgetItem h-card">
      <span class="p-name">Prefilled Person</span><span class="p-job-title">Council Member</span>
      <span class="u-email"><a href="mailto:MBreman@fruita.org?subject=Hi">Email</a></span>
    </li>
  </ul></div></body></html>`;
  const people = await scrape(async () => html, cfg);
  assert.equal(people.length, 2);
  assert.equal(people.find(p => p.name === 'Injected Person').email, null);
  assert.equal(people.find(p => p.name === 'Prefilled Person').email, 'mbreman@fruita.org');
});
