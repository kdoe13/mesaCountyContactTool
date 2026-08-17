import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../config/locales.json', import.meta.url), 'utf8'));

test('config has sheets and four locales in order', () => {
  assert.deepEqual(Object.keys(config.sheets), ['templates', 'faqs']);
  assert.deepEqual(config.locales.map(l => l.id),
    ['grand-junction', 'fruita', 'palisade', 'mesa-county']);
});

test('every locale is well-formed', () => {
  for (const loc of config.locales) {
    assert.match(loc.id, /^[a-z-]+$/);
    assert.ok(loc.label.length > 2);
    assert.match(loc.emailDomain, /^[a-z.]+\.(org|us)$/);
    assert.ok(loc.scrape.module, `${loc.id} needs scrape.module`);
    assert.ok(loc.scrape.urls.list, `${loc.id} needs scrape.urls.list`);
    const council = loc.bodies.find(b => b.scraped);
    assert.ok(council && council.expectedCount >= 3, `${loc.id} needs a scraped body with expectedCount`);
    for (const b of loc.bodies) {
      for (const m of b.staticMembers ?? []) {
        assert.ok(m.name && m.email.includes('@'), `${loc.id}/${b.id} static member malformed`);
      }
    }
    assert.ok(Array.isArray(loc.links) && loc.links.length >= 1);
    if (loc.districts) {
      assert.ok(loc.districts.options.length >= 3 && loc.districts.mapUrl.startsWith('http'));
    }
  }
});

test('district config matches spec: GJ + county have districts, Fruita/Palisade do not', () => {
  const byId = Object.fromEntries(config.locales.map(l => [l.id, l]));
  assert.ok(byId['grand-junction'].districts && byId['mesa-county'].districts);
  assert.equal(byId['fruita'].districts, undefined);
  assert.equal(byId['palisade'].districts, undefined);
});
