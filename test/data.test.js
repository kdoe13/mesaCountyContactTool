import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EMAIL_RE } from '../scraper/validate.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../config/locales.json', import.meta.url), 'utf8'));

const PERSON_KEYS = ['name', 'title', 'district', 'email', 'phone', 'profileUrl'].sort();

// Spec smoke test: every committed data file must actually match the shape
// the rest of the app assumes, and every source module a locale's config
// points at must actually exist on disk.
for (const locale of config.locales) {
  test(`${locale.id}: data files parse and match the expected shape`, () => {
    const contacts = JSON.parse(readFileSync(new URL(`../data/${locale.id}.contacts.json`, import.meta.url), 'utf8'));
    const content = JSON.parse(readFileSync(new URL(`../data/${locale.id}.content.json`, import.meta.url), 'utf8'));

    assert.ok(contacts && typeof contacts === 'object', `${locale.id}.contacts.json must parse to an object`);
    assert.ok(content && typeof content === 'object', `${locale.id}.content.json must parse to an object`);

    assert.ok(!Number.isNaN(Date.parse(contacts.scrapedAt)), `${locale.id}.contacts.json scrapedAt must be a valid date`);

    const scrapedBodies = locale.bodies.filter(b => b.scraped);
    for (const body of scrapedBodies) {
      const people = contacts.bodies[body.id];
      assert.ok(Array.isArray(people), `${locale.id}/${body.id} must have an array of people in contacts.json`);
      for (const person of people) {
        assert.ok(person.name && typeof person.name === 'string', `${locale.id}/${body.id}: every person needs a name`);
        assert.deepEqual(Object.keys(person).sort(), PERSON_KEYS, `${locale.id}/${body.id}: ${person.name} has the wrong key set`);
        if (person.email !== null) {
          assert.match(person.email, EMAIL_RE, `${locale.id}/${body.id}: ${person.name}'s email "${person.email}" fails EMAIL_RE`);
        }
      }
    }

    assert.ok(existsSync(`${ROOT}scraper/sources/${locale.scrape.module}.js`),
      `${locale.id}: scraper/sources/${locale.scrape.module}.js must exist`);
  });
}
