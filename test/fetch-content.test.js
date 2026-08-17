import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContent } from '../scraper/fetch-content.js';

const config = {
  sheets: { templates: 'https://sheet/t.csv', faqs: 'https://sheet/f.csv' },
  locales: [{ id: 'fruita' }, { id: 'palisade' }],
};
const csvs = {
  'https://sheet/t.csv':
    'locale,title,subject,message\nall,General,Hello,Please consider…\nfruita,Trails,Save the trails,Dear council…\n',
  'https://sheet/f.csv':
    'locale,question,answer\nfruita,When are meetings?,"Tuesdays, 7pm"\n',
};

test('rows route by locale with "all" shared', async () => {
  const out = await buildContent(config, async url => csvs[url]);
  const fruita = out.get('fruita');
  assert.deepEqual(fruita.templates.map(t => t.title), ['General', 'Trails']);
  assert.deepEqual(fruita.faqs, [{ question: 'When are meetings?', answer: 'Tuesdays, 7pm' }]);
  const palisade = out.get('palisade');
  assert.deepEqual(palisade.templates.map(t => t.title), ['General']);
  assert.deepEqual(palisade.faqs, []);
  assert.ok(!Number.isNaN(Date.parse(fruita.fetchedAt)));
});

test('null sheet urls -> null result (caller skips writing)', async () => {
  const out = await buildContent({ sheets: { templates: null, faqs: null }, locales: [{ id: 'x' }] }, async () => '');
  assert.equal(out, null);
});

test('a null section URL preserves that section from existing content instead of wiping it', async () => {
  const partialConfig = {
    sheets: { templates: null, faqs: 'https://sheet/f.csv' },
    locales: [{ id: 'fruita' }],
  };
  const existing = {
    fetchedAt: '2020-01-01T00:00:00.000Z',
    templates: [{ title: 'Old', subject: 'Old subject', message: 'Old message' }],
    faqs: [{ question: 'stale', answer: 'stale' }],
  };
  const out = await buildContent(
    partialConfig,
    async url => csvs[url],
    { readExisting: id => (id === 'fruita' ? existing : null) },
  );
  const fruita = out.get('fruita');
  assert.deepEqual(fruita.templates, existing.templates);
  assert.deepEqual(fruita.faqs, [{ question: 'When are meetings?', answer: 'Tuesdays, 7pm' }]);
});

test('a null section URL falls back to [] when there is no existing content file', async () => {
  const partialConfig = {
    sheets: { templates: 'https://sheet/t.csv', faqs: null },
    locales: [{ id: 'palisade' }],
  };
  const out = await buildContent(partialConfig, async url => csvs[url], { readExisting: () => null });
  const palisade = out.get('palisade');
  assert.deepEqual(palisade.templates.map(t => t.title), ['General']);
  assert.deepEqual(palisade.faqs, []);
});

test('unrecognized locale values are reported on the returned Map, not silently dropped', async () => {
  const cfg = {
    sheets: { templates: 'https://sheet/typo.csv', faqs: null },
    locales: [{ id: 'fruita' }],
  };
  const typoCsvs = {
    'https://sheet/typo.csv':
      'locale,title,subject,message\nfriuta,Typo,Subj,Msg\nall,General,Hello,World\n',
  };
  const out = await buildContent(cfg, async url => typoCsvs[url], { readExisting: () => null });
  assert.deepEqual(out.unknownLocales, [{ source: 'templates', locale: 'friuta', count: 1 }]);
  assert.deepEqual(out.get('fruita').templates.map(t => t.title), ['General']);
});

test('the original two-argument call form still works (Map contract preserved, no unknown locales)', async () => {
  const out = await buildContent(config, async url => csvs[url]);
  assert.deepEqual(out.unknownLocales, []);
});

test('a row missing a required field (e.g. a renamed "message" column) is skipped and reported, not written as undefined', async () => {
  const cfg = {
    sheets: { templates: 'https://sheet/renamed.csv', faqs: null },
    locales: [{ id: 'fruita' }],
  };
  // "body" is what "message" got renamed to; parseCsv gives every row a
  // `body` key and no `message` key at all, so `message` is `undefined` on
  // both rows below.
  const renamedCsv = {
    'https://sheet/renamed.csv':
      'locale,title,subject,body\nfruita,Trails,Save the trails,Dear council…\nfruita,Budget,About the budget,Please consider…\n',
  };
  const out = await buildContent(cfg, async url => renamedCsv[url], { readExisting: () => null });
  const fruita = out.get('fruita');
  assert.deepEqual(fruita.templates, []);
  assert.deepEqual(out.invalidRows, [{ source: 'templates', locale: 'fruita', count: 2 }]);
  assert.ok(!JSON.stringify(fruita).includes('undefined'));
});

test('a successful fetch that resolves to zero rows for a locale does not wipe that locale\'s existing non-empty section', async () => {
  const cfg = {
    sheets: { templates: 'https://sheet/onlyPalisade.csv', faqs: null },
    locales: [{ id: 'fruita' }, { id: 'palisade' }],
  };
  // The Sheet was published with rows for palisade only this run — fruita's
  // filtered set is legitimately empty, which must not overwrite its
  // existing templates.
  const onlyPalisadeCsv = {
    'https://sheet/onlyPalisade.csv':
      'locale,title,subject,message\npalisade,General,Hello,Dear trustees…\n',
  };
  const existingFruita = {
    fetchedAt: '2020-01-01T00:00:00.000Z',
    templates: [{ title: 'Old', subject: 'Old subject', message: 'Old message' }],
    faqs: [],
  };
  const out = await buildContent(cfg, async url => onlyPalisadeCsv[url], {
    readExisting: id => (id === 'fruita' ? existingFruita : null),
  });
  const fruita = out.get('fruita');
  assert.deepEqual(fruita.templates, existingFruita.templates);
  assert.deepEqual(out.emptyFallbacks, [{ locale: 'fruita', section: 'templates' }]);
  // Palisade's own fetch was genuinely populated and is unaffected.
  assert.deepEqual(out.get('palisade').templates.map(t => t.title), ['General']);
});
