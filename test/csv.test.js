import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../scraper/lib/csv.js';

test('parses header + simple rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n3,4'), [{ a: '1', b: '2' }, { a: '3', b: '4' }]);
});

test('handles quoted fields with commas, newlines, escaped quotes, CRLF', () => {
  const text = 'locale,message\r\nall,"Hello, ""friend""\nsecond line"\r\n';
  assert.deepEqual(parseCsv(text), [{ locale: 'all', message: 'Hello, "friend"\nsecond line' }]);
});

test('skips blank rows and preserves empty trailing fields', () => {
  assert.deepEqual(parseCsv('a,b\n\n1,\n'), [{ a: '1', b: '' }]);
});
