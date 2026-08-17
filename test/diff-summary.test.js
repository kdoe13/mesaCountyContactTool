import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDiff, TRACKED_FIELDS } from '../scraper/diff-summary.js';

const before = { bodies: { council: [
  { name: 'Ann A', email: 'ann@x.org', district: 'District A' },
  { name: 'Bob B', email: 'bob@x.org', district: 'District B' },
] } };
const after = { bodies: { council: [
  { name: 'Ann A', email: 'ann.a@x.org', district: 'District A' },
  { name: 'Cal C', email: 'cal@x.org', district: 'District B' },
] } };

test('reports changed emails, additions, removals in plain English', () => {
  const lines = summarizeDiff(before, after, 'testville');
  assert.ok(lines.some(l => /Ann A.*ann@x\.org.*ann\.a@x\.org/.test(l)));
  assert.ok(lines.some(l => /added.*Cal C/i.test(l)));
  assert.ok(lines.some(l => /removed.*Bob B/i.test(l)));
});

test('no changes -> empty list', () => {
  assert.deepEqual(summarizeDiff(before, before, 'testville'), []);
});

test('reports a profileUrl change', () => {
  const oldData = { bodies: { council: [
    { name: 'Ann A', email: 'ann@x.org', district: 'District A', profileUrl: 'https://old.example/ann' },
  ] } };
  const newData = { bodies: { council: [
    { name: 'Ann A', email: 'ann@x.org', district: 'District A', profileUrl: 'https://new.example/ann' },
  ] } };
  const lines = summarizeDiff(oldData, newData, 'testville');
  assert.ok(lines.some(l => /Ann A.*profileUrl.*old\.example\/ann.*new\.example\/ann/.test(l)));
});

test('a pure reorder is described, so a written change can never lack a summary line', () => {
  const reordered = { bodies: { council: [...before.bodies.council].reverse() } };
  const lines = summarizeDiff(before, reordered, 'testville');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /listing order changed.*Bob B, Ann A/);
});

test('order line is not emitted alongside adds/removes', () => {
  const lines = summarizeDiff(before, after, 'testville');
  assert.ok(!lines.some(l => /listing order/.test(l)));
});

test('TRACKED_FIELDS is the shared definition scrape.js writes on', () => {
  assert.deepEqual(TRACKED_FIELDS, ['email', 'district', 'title', 'phone', 'profileUrl']);
});
