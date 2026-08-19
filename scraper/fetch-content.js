import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml } from './lib/fetch.js';
import { parseCsv } from './lib/csv.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const TEMPLATE_FIELDS = ['title', 'subject', 'message'];
const FAQ_FIELDS = ['question', 'answer'];

// Paragraph breaks are authored in the Sheet as the two literal characters
// `\` `n`, because putting a real line break in a cell means Alt+Enter and
// makes the column unreadable to edit. parseCsv handles genuine embedded
// newlines correctly, so both spellings reach here — but a literal `\n` that
// nothing converts ends up in the resident's email as the characters
// backslash-n. Convert here, at the boundary, so the data files on disk hold
// real newlines and the frontend needs no knowledge of the convention.
//
// Scans backslash escapes left to right rather than look-behind: a
// `(^|[^\\])\\n` pattern silently drops the second break in a `\n\n`
// paragraph gap, because the first match consumes the character the second
// one needs to test. `\\n` (an escaped backslash followed by n) is left alone.
function unescapeNewlines(value) {
  return typeof value === 'string' ? value.replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : m)) : value;
}

function defaultReadExisting(id) {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'data', `${id}.content.json`), 'utf8'));
  } catch {
    return null;
  }
}

function unknownLocaleCounts(rows, knownIds, source) {
  const counts = new Map();
  for (const r of rows) {
    if (r.locale !== 'all' && !knownIds.has(r.locale)) {
      counts.set(r.locale, (counts.get(r.locale) || 0) + 1);
    }
  }
  return [...counts].map(([locale, count]) => ({ source, locale, count }));
}

// A renamed/removed Sheet column (e.g. message -> body) leaves that field
// `undefined` on every row rather than failing the fetch — parseCsv has no
// way to know a column was expected. Split rows into usable vs. not here so
// a schema drift silently drops only the affected rows (reported, like an
// unrecognized locale) instead of writing `"message":"undefined"` to a
// resident-facing draft that JSON.stringify would otherwise render as the
// literal string "undefined" once the frontend touches it.
function partitionValid(rows, requiredFields) {
  const valid = [];
  const invalid = [];
  for (const r of rows) {
    (requiredFields.every(f => r[f] !== undefined) ? valid : invalid).push(r);
  }
  return { valid, invalid };
}

function invalidRowCounts(rows, source) {
  const counts = new Map();
  for (const r of rows) {
    const key = r.locale ?? '(unknown)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([locale, count]) => ({ source, locale, count }));
}

export async function buildContent(config, fetchImpl, { readExisting = defaultReadExisting } = {}) {
  const { templates: tUrl, faqs: fUrl } = config.sheets;
  if (!tUrl && !fUrl) return null;
  // null (not [] ) marks "this section was not fetched this run" so it can be
  // told apart from "fetched, and the sheet legitimately has zero rows".
  const templates = tUrl ? parseCsv(await fetchImpl(tUrl)) : null;
  const faqs = fUrl ? parseCsv(await fetchImpl(fUrl)) : null;
  const fetchedAt = new Date().toISOString();
  const knownIds = new Set(config.locales.map(l => l.id));
  const forLocale = (rows, id) => rows.filter(r => r.locale === id || r.locale === 'all');

  const unknownLocales = [
    ...(templates ? unknownLocaleCounts(templates, knownIds, 'templates') : []),
    ...(faqs ? unknownLocaleCounts(faqs, knownIds, 'faqs') : []),
  ];

  const validTemplates = templates ? partitionValid(templates, TEMPLATE_FIELDS) : null;
  const validFaqs = faqs ? partitionValid(faqs, FAQ_FIELDS) : null;
  const invalidRows = [
    ...(validTemplates ? invalidRowCounts(validTemplates.invalid, 'templates') : []),
    ...(validFaqs ? invalidRowCounts(validFaqs.invalid, 'faqs') : []),
  ];

  // A successful fetch of the *wrong thing* (e.g. the sheet momentarily has
  // rows for only one locale) must not be allowed to wipe out a locale's
  // existing, non-empty section — that would ship a resident a blank draft
  // with no PR/issue in the way, since Sheet content commits straight to
  // main. Fall back to what's already on disk and flag it so the caller can
  // fail the run (the same failure-issue path a fetch error already takes).
  const emptyFallbacks = [];

  const result = new Map(config.locales.map(l => {
    let existing; // lazily read at most once per locale, only if needed
    const getExisting = () => (existing !== undefined ? existing : (existing = readExisting(l.id)));

    let localeTemplates;
    if (templates === null) {
      localeTemplates = getExisting()?.templates ?? [];
    } else {
      const computed = forLocale(validTemplates.valid, l.id).map(({ title, subject, message }) => ({ title, subject, message: unescapeNewlines(message) }));
      if (computed.length === 0 && (getExisting()?.templates?.length ?? 0) > 0) {
        localeTemplates = getExisting().templates;
        emptyFallbacks.push({ locale: l.id, section: 'templates' });
      } else {
        localeTemplates = computed;
      }
    }

    let localeFaqs;
    if (faqs === null) {
      localeFaqs = getExisting()?.faqs ?? [];
    } else {
      const computed = forLocale(validFaqs.valid, l.id).map(({ question, answer }) => ({ question, answer: unescapeNewlines(answer) }));
      if (computed.length === 0 && (getExisting()?.faqs?.length ?? 0) > 0) {
        localeFaqs = getExisting().faqs;
        emptyFallbacks.push({ locale: l.id, section: 'faqs' });
      } else {
        localeFaqs = computed;
      }
    }

    return [l.id, { fetchedAt, templates: localeTemplates, faqs: localeFaqs }];
  }));
  result.unknownLocales = unknownLocales;
  result.invalidRows = invalidRows;
  result.emptyFallbacks = emptyFallbacks;
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = JSON.parse(readFileSync(join(ROOT, 'config', 'locales.json'), 'utf8'));
  try {
    const out = await buildContent(config, fetchHtml);
    if (!out) { console.log('sheets not configured yet; nothing to do'); process.exit(0); }
    for (const u of out.unknownLocales) {
      console.warn(`WARN unrecognized locale "${u.locale}" in ${u.source} sheet: ${u.count} row(s) not applied to any locale`);
    }
    for (const r of out.invalidRows) {
      console.warn(`WARN ${r.count} row(s) in ${r.source} sheet for locale "${r.locale}" missing a required field (renamed/removed column?) and were skipped`);
    }
    for (const [id, content] of out) {
      writeFileSync(join(ROOT, 'data', `${id}.content.json`), JSON.stringify(content, null, 2) + '\n');
      console.log(`ok   ${id}: ${content.templates.length} templates, ${content.faqs.length} faqs`);
    }
    if (out.emptyFallbacks.length) {
      for (const f of out.emptyFallbacks) {
        console.error(`FAIL ${f.locale}: fetched ${f.section} was empty; kept the existing ${f.section} instead of wiping it`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exit(1);
  }
}
