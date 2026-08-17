import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateContacts, emailProblem, EMAIL_RE } from '../scraper/validate.js';

const locale = {
  id: 'testville', emailDomain: 'testville.org',
  bodies: [{ id: 'council', scraped: true, expectedCount: 2 }],
};
const groupLocale = {
  id: 'grouptown', emailDomain: 'grouptown.org',
  bodies: [{ id: 'council', scraped: true, expectedCount: 1, groupEmail: 'all@grouptown.org' }],
};
const ok = [
  { name: 'Ann A', email: 'ann@testville.org' },
  { name: 'Bob B', email: 'bob@testville.org' },
];

test('accepts a valid roster', () => {
  assert.deepEqual(validateContacts(locale, ok), []);
});

test('rejects wrong count, blank name, foreign domain, and null email without groupEmail', () => {
  assert.match(validateContacts(locale, ok.slice(0, 1))[0], /expected 2.*got 1/i);
  assert.match(validateContacts(locale, [ok[0], { name: ' ', email: 'x@testville.org' }])[0], /name/i);
  assert.match(validateContacts(locale, [ok[0], { name: 'Eve E', email: 'eve@evil.com' }])[0], /domain/i);
  assert.match(validateContacts(locale, [ok[0], { name: 'Nia N', email: null }])[0], /email/i);
});

test('allows null emails when the body has a groupEmail', () => {
  assert.deepEqual(validateContacts(groupLocale, [{ name: 'Solo S', email: null }]), []);
});

test('allows a null email when the person has a profileUrl (spec: profile-link card)', () => {
  // One official whose email the city hasn't published must not fail the whole
  // locale and freeze the roster; the frontend renders their profile link.
  const roster = [
    ok[0],
    { name: 'Nia N', email: null, profileUrl: 'https://testville.org/nia' },
  ];
  assert.deepEqual(validateContacts(locale, roster), []);
});

test('still rejects a null email with neither groupEmail nor profileUrl', () => {
  const errors = validateContacts(locale, [ok[0], { name: 'Nia N', email: null, profileUrl: null }]);
  assert.match(errors[0], /no email, no profileUrl/i);
});

test('rejects when no body has scraped:true', () => {
  const noScrapedLocale = {
    id: 'noscraped', emailDomain: 'noscraped.org',
    bodies: [{ id: 'council', scraped: false, expectedCount: 1 }],
  };
  assert.match(validateContacts(noScrapedLocale, ok)[0], /no body with scraped:true/i);
});

test('detects duplicate emails', () => {
  const dupes = [
    { name: 'Ann A', email: 'ann@testville.org' },
    { name: 'Another Ann', email: 'ann@testville.org' },
  ];
  assert.match(validateContacts(locale, dupes)[0], /duplicate.*ann@testville.org/i);
});

test('detects duplicate names', () => {
  const dupes = [
    { name: 'Bob B', email: 'bob1@testville.org' },
    { name: 'Bob B', email: 'bob2@testville.org' },
  ];
  assert.match(validateContacts(locale, dupes)[0], /duplicate.*bob b/i);
});

test('config emailDomain is matched case-insensitively', () => {
  const caseInsensitiveLocale = {
    id: 'casetown', emailDomain: 'CaseCity.org',
    bodies: [{ id: 'council', scraped: true, expectedCount: 2 }],
  };
  const roster = [
    { name: 'Ann A', email: 'ann@casecity.org' },
    { name: 'Bob B', email: 'bob@casecity.org' },
  ];
  assert.deepEqual(validateContacts(caseInsensitiveLocale, roster), []);
});

test('stored emails must already be trimmed and lowercased', () => {
  // The global constraint is that scrapers lowercase emails; validation now
  // enforces it instead of trusting each module to have remembered.
  assert.match(validateContacts(locale, [ok[0], { name: 'Bob B', email: '  bob@testville.org  ' }])[0], /trimmed and lowercased/i);
  assert.match(validateContacts(locale, [ok[0], { name: 'Bob B', email: 'Bob@testville.org' }])[0], /trimmed and lowercased/i);
});

test('rejects addresses that could inject extra mailto headers', () => {
  // The exact primitive the old endsWith-only check let through: a foreign
  // mailbox with the expected domain trailing after a `?cc=`.
  const injection = 'evil@attacker.com?cc=x@testville.org';
  assert.match(validateContacts(locale, [ok[0], { name: 'Real Person', email: injection }])[0], /not a valid email address/i);
  for (const bad of [
    'a@b.org,c@b.org',      // comma: would silently split the To list
    'a b@testville.org',    // whitespace
    'a@testville.org;x',    // semicolon
    'a@testville.org&cc=x@testville.org',
    'a@@testville.org',
    'nodomain',
    'no@tld',
  ]) {
    assert.ok(!EMAIL_RE.test(bad), `${bad} must not pass EMAIL_RE`);
  }
  assert.equal(emailProblem('ann@testville.org', 'testville.org'), null);
  assert.equal(emailProblem('ann@testville.org'), null);
  assert.match(emailProblem(null) ?? '', /empty/i);
});

test('validate.js stays dependency-free so the browser can import EMAIL_RE from it', () => {
  // js/main.js imports EMAIL_RE from this module so the mailto builder and the
  // scraper share one address rule; a node: import here would break the page.
  const src = readFileSync(new URL('../scraper/validate.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'validate.js must not import anything');
});

test('allows null emails in duplicates (ignores them for duplicate check)', () => {
  const nullEmails = [
    { name: 'Ann A', email: null },
    { name: 'Bob B', email: null },
  ];
  const groupLocaleMulti = {
    id: 'grouptown2', emailDomain: 'grouptown2.org',
    bodies: [{ id: 'council', scraped: true, expectedCount: 2, groupEmail: 'all@grouptown2.org' }],
  };
  assert.deepEqual(validateContacts(groupLocaleMulti, nullEmails), []);
});
