# Mesa County Contact Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, no-build civic contact tool for Mesa County, CO (Grand Junction, Fruita, Palisade, Mesa County tabs) with GitHub-Actions-based scraping that opens PRs when officials' contact info changes.

**Architecture:** One HTML page + vanilla JS renders four locale tabs from committed JSON (`config/locales.json` + `data/*.json`). A Node scraper (cheerio) with one source module per locale runs weekly in GitHub Actions, validates output, and opens a PR on changes; a daily job pulls Google Sheet CSVs into content JSON. GitHub Pages serves `main` directly — merge = deploy.

**Tech Stack:** Node 20+ (ESM), `cheerio` (only dependency), `node:test`, GitHub Actions, GitHub Pages. Frontend: hand-written CSS + vanilla JS, zero dependencies.

**Spec:** `docs/superpowers/specs/2026-08-16-mesa-contact-tool-design.md`

## Global Constraints

- Node >= 20, ESM everywhere (`"type": "module"` in package.json).
- Exactly one npm dependency: `cheerio`. Frontend has zero dependencies, no build step, no framework.
- All frontend asset/data references are **relative paths** (site must work at `https://<user>.github.io/mesaContactTool/` and at a future domain root).
- All HTTP requests from the scraper send a browser User-Agent (colorado.gov 403s default UAs): `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36`.
- JSON files written by tools: 2-space indent, trailing newline, stable key order as produced by the code in this plan.
- Scraped contact changes reach `main` **only via PR**; Sheet content commits directly to `main`.
- Run `node --test test/` before every commit; commit at the end of every task.
- Emails are normalized to lowercase everywhere.

## Reference: verified source-page facts (2026-08-16)

- **Grand Junction** (CivicPlus): list `https://www.gjcity.org/313/City-Council` shows 7 members (Laurel Lutz (Cole)–District D/President, Ben Van Dyke–At-Large/Pro Tem, Cody Kennedy–A, Jason Nguyen–B, Anna Stout–C, Robert Ballard–E, Scott Beilfuss–At-Large) as name-links to profile pages (`/316/Laurel-Cole`, etc.). Emails are **not** on the list page; each profile page has one `mailto:` (`laurel.cole@gjcity.org`). District appears in `h2` headings near each member. District checker: `https://external-gis.gjcity.org/CheckCityCouncilDistricts/`. GJ has no elected mayor (council-manager form).
- **Fruita** (CivicPlus): `https://www.fruita.org/citycouncil` has everything inline in microformat markup: `div.widgetStaffDirectory li.widgetItem.h-card` with `.p-name`, `.p-job-title` ("Mayor", "Mayor Pro-Tem", "Council Member"), `.u-email a[href^=mailto:]`, `.p-tel a`. 8 h-cards on page; exactly 7 have council titles. Council elected at-large.
- **Palisade** (Drupal 10 at `https://palisade.colorado.gov/`; `townofpalisade.org` 301s there; **403 without browser UA**): `https://palisade.colorado.gov/board-of-trustees` lists members as `<h6><u>MAYOR Greg Mikolai</u></h6>`, `<h6><u>MAYOR PRO-TEM Sarah Matchett</u></h6>`, `<h6><u>TRUSTEE Amy Gekas</u></h6>` … (7 total: Mikolai, Matchett, Gekas, Seymour, Rasmussen, Fox, Snook). **No individual emails** — group address `boardoftrustees@townofpalisade.org`. At-large.
- **Mesa County** (Drupal): `https://www.mesacounty.us/departments-and-services/commissioners` links the 3 commissioners as `li.menu__item > a` (`…/commissioners/cody-davis`, `…/bobbie-daniel`, `…/JJ-Fletcher`) mixed with non-person links (`business-commissioners`, `connect-us`, `volunteer-opportunities`). Profile pages contain `Email: <a href="mailto:cody.davis@mesacounty.us">` and "District 1/2/3" text. General office email `mcadmin@mesacounty.us`.
- **GJ offices:** City Clerk `cityclerk@gjcity.org` (verified). City Manager page `https://www.gjcity.org/293/City-Manager` lists `mike.bennett@gjcity.org` among others (verify holder at implementation).

---

### Task 1: Scaffolding + locale config

**Files:**
- Create: `package.json`, `.gitignore`, `.nojekyll`, `config/locales.json`, `test/config.test.js`

**Interfaces:**
- Produces: `config/locales.json` — shape `{ sheets: {templates, faqs}, locales: [Locale] }` where `Locale = { id, label, emailDomain, scrape: {module, urls}, bodies: [Body], districts?: {label, options, mapUrl}, links: [{label,url}] }` and `Body = { id, label, scraped?: true, expectedCount?: number, groupEmail?: string, staticMembers?: [{name,title,email}] }`. Every later task reads this file.

- [ ] **Step 1: package.json, .gitignore, .nojekyll**

`package.json`:
```json
{
  "name": "mesa-contact-tool",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test test/",
    "scrape": "node scraper/scrape.js",
    "content": "node scraper/fetch-content.js"
  },
  "dependencies": { "cheerio": "^1.0.0" }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
```

`.nojekyll`: empty file (stops GitHub Pages' Jekyll pass).

Run: `npm install` (creates `package-lock.json` — commit it).

- [ ] **Step 2: Write the failing config test**

`test/config.test.js`:
```js
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
```

Run: `node --test test/` — Expected: FAIL (`config/locales.json` missing).

- [ ] **Step 3: Pin the remaining office emails and the Mesa district map link**

Each is a fetch-and-read step; record what you find (these are role addresses, so prefer generic aliases over personal ones when both exist):

```bash
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
# GJ City Manager: confirm current holder + email
curl -sL -A "$UA" https://www.gjcity.org/293/City-Manager | grep -o 'mailto:[^"]*'
# Fruita City Manager + City Clerk (check /citymanager, /cityclerk, then /directory.aspx)
curl -sL -A "$UA" https://www.fruita.org/citymanager | grep -o 'mailto:[^"]*'
curl -sL -A "$UA" https://www.fruita.org/cityclerk   | grep -o 'mailto:[^"]*'
# Palisade Town Administrator + Town Clerk (cora@townofpalisade.org was seen; confirm the role)
curl -sL -A "$UA" https://palisade.colorado.gov/administration | grep -o 'mailto:[^"]*'
curl -sL -A "$UA" https://palisade.colorado.gov/town-clerk     | grep -o 'mailto:[^"]*'
# Mesa County Clerk & Recorder
curl -sL -A "$UA" https://www.mesacounty.us/departments-and-services/clerk-and-recorder | grep -o 'mailto:[^"]*'
# Mesa County commissioner-district map page (search site nav for "district map"); if none found,
# use https://www.mesacounty.us/departments-and-services/commissioners as mapUrl
```

If a URL 404s, find the right path from the site's nav/search (`curl -sL -A "$UA" <homepage> | grep -oiE 'href="[^"]*(manager|clerk|administra)[^"]*"' | sort -u`). If a role truly has no published email, omit that static member.

- [ ] **Step 4: Write `config/locales.json`**

Use exactly this content, substituting the emails/URLs pinned in Step 3 where marked `PINNED:`:

```json
{
  "sheets": { "templates": null, "faqs": null },
  "locales": [
    {
      "id": "grand-junction",
      "label": "Grand Junction",
      "emailDomain": "gjcity.org",
      "scrape": { "module": "grand-junction", "urls": { "list": "https://www.gjcity.org/313/City-Council" } },
      "bodies": [
        { "id": "council", "label": "City Council", "scraped": true, "expectedCount": 7 },
        { "id": "offices", "label": "Key Offices", "staticMembers": [
          { "name": "City Manager", "title": "Office of the City Manager", "email": "PINNED: (mike.bennett@gjcity.org if confirmed)" },
          { "name": "City Clerk", "title": "Office of the City Clerk", "email": "cityclerk@gjcity.org" }
        ] }
      ],
      "districts": {
        "label": "Council District",
        "options": ["District A", "District B", "District C", "District D", "District E"],
        "mapUrl": "https://external-gis.gjcity.org/CheckCityCouncilDistricts/"
      },
      "links": [
        { "label": "Agendas & Minutes", "url": "https://www.gjcity.org/129/Agendas-Minutes" },
        { "label": "City Council page", "url": "https://www.gjcity.org/313/City-Council" }
      ]
    },
    {
      "id": "fruita",
      "label": "Fruita",
      "emailDomain": "fruita.org",
      "scrape": { "module": "fruita", "urls": { "list": "https://www.fruita.org/citycouncil" } },
      "bodies": [
        { "id": "council", "label": "City Council", "scraped": true, "expectedCount": 7 },
        { "id": "offices", "label": "Key Offices", "staticMembers": [
          { "name": "City Manager", "title": "Office of the City Manager", "email": "PINNED:" },
          { "name": "City Clerk", "title": "Office of the City Clerk", "email": "PINNED:" }
        ] }
      ],
      "links": [
        { "label": "City Council Agendas", "url": "https://www.fruita.org/729" },
        { "label": "City Council page", "url": "https://www.fruita.org/citycouncil" }
      ]
    },
    {
      "id": "palisade",
      "label": "Palisade",
      "emailDomain": "townofpalisade.org",
      "scrape": { "module": "palisade", "urls": { "list": "https://palisade.colorado.gov/board-of-trustees" } },
      "bodies": [
        { "id": "council", "label": "Board of Trustees", "scraped": true, "expectedCount": 7,
          "groupEmail": "boardoftrustees@townofpalisade.org" },
        { "id": "offices", "label": "Key Offices", "staticMembers": [
          { "name": "Town Administrator", "title": "Town Administration", "email": "PINNED:" },
          { "name": "Town Clerk", "title": "Office of the Town Clerk", "email": "PINNED:" }
        ] }
      ],
      "links": [
        { "label": "Board of Trustees (agendas on page)", "url": "https://palisade.colorado.gov/board-of-trustees" }
      ]
    },
    {
      "id": "mesa-county",
      "label": "Mesa County",
      "emailDomain": "mesacounty.us",
      "scrape": { "module": "mesa-county", "urls": {
        "list": "https://www.mesacounty.us/departments-and-services/commissioners",
        "excludeSlugs": ["business-commissioners", "connect-us", "volunteer-opportunities", "public-hearing-information"]
      } },
      "bodies": [
        { "id": "council", "label": "Board of County Commissioners", "scraped": true, "expectedCount": 3 },
        { "id": "offices", "label": "Key Offices", "staticMembers": [
          { "name": "County Administration", "title": "County Administrator's Office", "email": "mcadmin@mesacounty.us" },
          { "name": "Clerk & Recorder", "title": "Office of the Clerk & Recorder", "email": "PINNED:" }
        ] }
      ],
      "districts": {
        "label": "Commissioner District",
        "options": ["District 1", "District 2", "District 3"],
        "mapUrl": "PINNED: (fallback: https://www.mesacounty.us/departments-and-services/commissioners)"
      },
      "links": [
        { "label": "Public Hearings & Agendas", "url": "https://www.mesacounty.us/departments-and-services/commissioners/business-commissioners/public-hearing-information" }
      ]
    }
  ]
}
```

Note `excludeSlugs` lives under `scrape.urls` for mesa-county only; other modules ignore it.

- [ ] **Step 5: Run tests, verify pass**

Run: `node --test test/` — Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .nojekyll config/ test/
git commit -m "feat: scaffolding and locale config for four Mesa County locales"
```

---

### Task 2: CSV parser library

**Files:**
- Create: `scraper/lib/csv.js`, `test/csv.test.js`

**Interfaces:**
- Produces: `parseCsv(text: string) -> Array<Record<string,string>>` — RFC-4180: header row becomes keys; handles quoted fields, embedded commas/newlines/`""` escapes, CRLF; skips blank rows. Used by Task 10.

- [ ] **Step 1: Write the failing tests**

`test/csv.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify failure** — `node --test test/` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`scraper/lib/csv.js`:
```js
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const cleaned = rows.filter(r => r.length > 1 || r[0] !== '');
  const [header, ...body] = cleaned;
  if (!header) return [];
  return body.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
}
```

- [ ] **Step 4: Run tests, verify pass** — `node --test test/` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add scraper/lib/csv.js test/csv.test.js && git commit -m "feat: dependency-free RFC-4180 CSV parser"`

---

### Task 3: HTTP fetch helper

**Files:**
- Create: `scraper/lib/fetch.js`, `test/fetch.test.js`

**Interfaces:**
- Produces: `fetchHtml(url: string, {retries=1} = {}) -> Promise<string>` — GETs with the browser UA from Global Constraints, 20s timeout, follows redirects (native fetch default), retries once on network error/5xx, throws `Error("fetch failed: <status> <url>")` on final failure. Every source module and Task 10 consume this exact signature; tests substitute fakes with the same signature.

- [ ] **Step 1: Write the failing tests** (uses a throwaway local HTTP server)

`test/fetch.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchHtml } from '../scraper/lib/fetch.js';

function serve(handler) {
  return new Promise(resolve => {
    const srv = createServer(handler);
    srv.listen(0, () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('returns body and sends browser UA', async () => {
  let ua;
  const { srv, url } = await serve((req, res) => { ua = req.headers['user-agent']; res.end('<p>hi</p>'); });
  try {
    assert.equal(await fetchHtml(url), '<p>hi</p>');
    assert.match(ua, /Mozilla\/5\.0/);
  } finally { srv.close(); }
});

test('retries once on 500 then succeeds', async () => {
  let calls = 0;
  const { srv, url } = await serve((req, res) => {
    calls++;
    if (calls === 1) { res.statusCode = 500; res.end('boom'); } else res.end('ok');
  });
  try {
    assert.equal(await fetchHtml(url), 'ok');
    assert.equal(calls, 2);
  } finally { srv.close(); }
});

test('throws after retries exhausted', async () => {
  const { srv, url } = await serve((req, res) => { res.statusCode = 403; res.end(); });
  try {
    await assert.rejects(() => fetchHtml(url), /fetch failed: 403/);
  } finally { srv.close(); }
});
```

- [ ] **Step 2: Run to verify failure** — Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`scraper/lib/fetch.js`:
```js
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchHtml(url, { retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return await res.text();
      lastErr = new Error(`fetch failed: ${res.status} ${url}`);
      if (res.status < 500 && attempt > 0) break;
    } catch (err) {
      lastErr = new Error(`fetch failed: ${err.message} ${url}`);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git add scraper/lib/fetch.js test/fetch.test.js && git commit -m "feat: fetchHtml with browser UA, timeout, and retry"`

---

### Task 4: Fixtures + Fruita source module (establishes the module pattern)

**Files:**
- Create: `test/fixtures/` (six HTML snapshots), `scraper/sources/fruita.js`, `test/sources-fruita.test.js`

**Interfaces:**
- Produces: the **source-module contract** every locale module follows:
  `scrape(fetchHtml, scrapeConfig) -> Promise<Person[]>` where `scrapeConfig` is a locale's `config.scrape` object (module reads `scrapeConfig.urls.*`) and `Person = { name: string, title: string|null, district: string|null, email: string|null, phone: string|null, profileUrl: string|null }`. Tasks 5–7 copy this contract; Task 9 invokes modules through it.
- Produces: `test/fixtures/{fruita-council,gj-list,gj-profile-laurel,palisade-board,mesa-list,mesa-profile-davis}.html`.

- [ ] **Step 1: Download fixtures**

```bash
mkdir -p test/fixtures
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
curl -sL -A "$UA" https://www.fruita.org/citycouncil > test/fixtures/fruita-council.html
curl -sL -A "$UA" https://www.gjcity.org/313/City-Council > test/fixtures/gj-list.html
curl -sL -A "$UA" https://www.gjcity.org/316/Laurel-Cole > test/fixtures/gj-profile-laurel.html
curl -sL -A "$UA" https://palisade.colorado.gov/board-of-trustees > test/fixtures/palisade-board.html
curl -sL -A "$UA" https://www.mesacounty.us/departments-and-services/commissioners > test/fixtures/mesa-list.html
curl -sL -A "$UA" https://www.mesacounty.us/departments-and-services/commissioners/cody-davis > test/fixtures/mesa-profile-davis.html
```

Sanity-check each file is real content, not an error page: `grep -l "Council\|Trustee\|Commissioner" test/fixtures/*.html` must list all six.

- [ ] **Step 2: Write the failing test**

`test/sources-fruita.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrape } from '../scraper/sources/fruita.js';

const fixture = readFileSync(new URL('./fixtures/fruita-council.html', import.meta.url), 'utf8');
const fakeFetch = async () => fixture;
const cfg = { urls: { list: 'https://www.fruita.org/citycouncil' } };

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
```

(If the live roster changed since 2026-08-16, adjust the pinned email/name to what the freshly downloaded fixture actually contains — the fixture is the source of truth for tests.)

- [ ] **Step 3: Run to verify failure** — Expected: FAIL (module not found).

- [ ] **Step 4: Implement**

`scraper/sources/fruita.js`:
```js
import * as cheerio from 'cheerio';

const clean = s => s.replace(/\s+/g, ' ').trim();

export async function scrape(fetchHtml, scrapeConfig) {
  const $ = cheerio.load(await fetchHtml(scrapeConfig.urls.list));
  const people = [];
  $('.widgetStaffDirectory li.widgetItem.h-card').each((_, el) => {
    const $el = $(el);
    const title = clean($el.find('.p-job-title').text());
    if (!/mayor|council/i.test(title)) return; // page has extra staff h-cards
    const mailto = $el.find('.u-email a[href^="mailto:"]').attr('href') ?? '';
    people.push({
      name: clean($el.find('.p-name').text()),
      title,
      district: null,
      email: mailto ? mailto.replace(/^mailto:/i, '').toLowerCase() : null,
      phone: clean($el.find('.p-tel a').text()) || null,
      profileUrl: null,
    });
  });
  return people;
}
```

- [ ] **Step 5: Run tests, verify pass.** Adjust selectors against the fixture if the count is off — the fixture, not this plan, is authoritative.

- [ ] **Step 6: Commit** — `git add test/fixtures scraper/sources/fruita.js test/sources-fruita.test.js && git commit -m "feat: fruita source module + fixture snapshots for all locales"`

---

### Task 5: Grand Junction source module (two-hop scrape)

**Files:**
- Create: `scraper/sources/grand-junction.js`, `test/sources-grand-junction.test.js`

**Interfaces:**
- Consumes: module contract and fixtures from Task 4.
- Produces: `scrape(fetchHtml, scrapeConfig)` per contract. The module fetches `urls.list`, finds member name-links + districts, then fetches each `profileUrl` to get the email.

- [ ] **Step 1: Write the failing test**

`test/sources-grand-junction.test.js`:
```js
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

const cfg = { urls: { list: 'https://www.gjcity.org/313/City-Council' } };

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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/sources/grand-junction.js` — strategy: member anchors are links whose href matches the CivicPlus page pattern `/<digits>/<Hyphenated-Name>` and whose text is the member's name (the same href also appears with text "Contact & Biography" — keep the name-looking text). District/title comes from the nearest preceding `h2` heading text. Then fetch each profile for its `mailto:`.

```js
import * as cheerio from 'cheerio';

const clean = s => s.replace(/[\s ]+/g, ' ').trim();
const PROFILE = /^(?:https?:\/\/(?:www\.)?gjcity\.org)?\/\d+\/[A-Za-z][A-Za-z-]+$/;
const NOT_NAMES = /contact|biography|email|agenda|minute|council|city|charter|form|meeting/i;

export async function scrape(fetchHtml, scrapeConfig) {
  const listUrl = scrapeConfig.urls.list;
  const $ = cheerio.load(await fetchHtml(listUrl));
  const byUrl = new Map();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!PROFILE.test(href)) return;
    const text = clean($(el).text());
    if (text.split(' ').length < 2 || NOT_NAMES.test(text)) return;
    const url = new URL(href, listUrl).href;
    if (byUrl.has(url)) return;
    // district/title: h2 headings pair each member's name with their district/role
    let district = null, title = null;
    $('h2').each((_, h) => {
      const t = clean($(h).text());
      if (t.startsWith(text.split(' ')[0]) && t.includes(text.split(' ').slice(-1)[0])) {
        const m = t.match(/District\s+[A-Za-z-]+/i);
        if (m) district = m[0].replace(/district/i, 'District');
        if (/president pro tem/i.test(t)) title = 'Council President Pro Tem';
        else if (/president/i.test(t)) title = 'Council President';
      }
    });
    byUrl.set(url, { name: text, title: title ?? 'Council Member', district, email: null, phone: null, profileUrl: url });
  });

  const people = [...byUrl.values()];
  for (const p of people) {
    const $$ = cheerio.load(await fetchHtml(p.profileUrl));
    const mailto = $$('a[href^="mailto:"]').map((_, a) => $$(a).attr('href')).get()
      .map(h => h.replace(/^mailto:/i, '').toLowerCase())
      .find(e => e.endsWith('@gjcity.org'));
    p.email = mailto ?? null;
  }
  return people;
}
```

If GJ's list markup makes district matching unreliable, districts may come out null for some members — loosen the district assertion to Laurel+Kennedy only and note it; email extraction is the load-bearing part.

- [ ] **Step 4: Run tests, verify pass** (iterate selectors against fixture as needed).

- [ ] **Step 5: Commit** — `git commit -am "feat: grand-junction two-hop source module"`

---

### Task 6: Palisade source module

**Files:**
- Create: `scraper/sources/palisade.js`, `test/sources-palisade.test.js`

**Interfaces:**
- Consumes: module contract (Task 4). Members carry `email: null` — the body-level `groupEmail` in config (Task 1) is applied by the frontend, not the scraper.

- [ ] **Step 1: Write the failing test**

`test/sources-palisade.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/sources/palisade.js`:
```js
import * as cheerio from 'cheerio';

const clean = s => s.replace(/[\s ]+/g, ' ').trim();
const ROLE = /^(MAYOR PRO-TEM|MAYOR|TRUSTEE)\s+(.+)$/i;
const TITLES = { 'MAYOR': 'Mayor', 'MAYOR PRO-TEM': 'Mayor Pro-Tem', 'TRUSTEE': 'Trustee' };

export async function scrape(fetchHtml, scrapeConfig) {
  const $ = cheerio.load(await fetchHtml(scrapeConfig.urls.list));
  const people = [];
  $('h6, h5, h4').each((_, el) => {
    const m = clean($(el).text()).match(ROLE);
    if (!m) return;
    people.push({
      name: clean(m[2]),
      title: TITLES[m[1].toUpperCase()],
      district: null,
      email: null,
      phone: null,
      profileUrl: null,
    });
  });
  return people;
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: palisade source module (group-email body)"`

---

### Task 7: Mesa County source module (self-validating discovery)

**Files:**
- Create: `scraper/sources/mesa-county.js`, `test/sources-mesa-county.test.js`

**Interfaces:**
- Consumes: module contract (Task 4); `scrapeConfig.urls.excludeSlugs` from Task 1's config.
- Produces: `scrape` that discovers commissioner links under `/departments-and-services/commissioners/`, excludes configured section slugs, fetches each candidate, and keeps only pages that yield a `@mesacounty.us` mailto (self-validating against nav noise).

- [ ] **Step 1: Write the failing test**

`test/sources-mesa-county.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrape } from '../scraper/sources/mesa-county.js';

const list = readFileSync(new URL('./fixtures/mesa-list.html', import.meta.url), 'utf8');
const davis = readFileSync(new URL('./fixtures/mesa-profile-davis.html', import.meta.url), 'utf8');

const fakeFetch = async (url) => {
  if (url.endsWith('/commissioners')) return list;
  if (url.includes('cody-davis')) return davis;
  const slug = url.split('/').pop().toLowerCase().replace(/-/g, '.');
  return `<html><body><p>District 2</p><p>Email: <a href="mailto:${slug}@mesacounty.us">${slug}</a></p></body></html>`;
};

const cfg = { urls: {
  list: 'https://www.mesacounty.us/departments-and-services/commissioners',
  excludeSlugs: ['business-commissioners', 'connect-us', 'volunteer-opportunities', 'public-hearing-information'],
} };

test('mesa-county: exactly 3 commissioners, emails and districts from profiles', async () => {
  const people = await scrape(fakeFetch, cfg);
  assert.equal(people.length, 3);
  const davisP = people.find(p => /Davis/.test(p.name));
  assert.equal(davisP.email, 'cody.davis@mesacounty.us');   // from real fixture
  assert.equal(davisP.district, 'District 1');
  for (const p of people) {
    assert.match(p.email, /@mesacounty\.us$/);
    assert.match(p.district, /^District [123]$/);
    assert.equal(p.title, 'County Commissioner');
  }
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/sources/mesa-county.js`:
```js
import * as cheerio from 'cheerio';

const clean = s => s.replace(/[\s ]+/g, ' ').trim();

export async function scrape(fetchHtml, scrapeConfig) {
  const { list, excludeSlugs = [] } = scrapeConfig.urls;
  const $ = cheerio.load(await fetchHtml(list));
  const candidates = new Map();
  $('a[href*="/commissioners/"]').each((_, el) => {
    const url = new URL($(el).attr('href'), list).href;
    const path = new URL(url).pathname;
    const m = path.match(/\/departments-and-services\/commissioners\/([^/]+)$/);
    if (!m || excludeSlugs.includes(m[1].toLowerCase())) return;
    const name = clean($(el).text());
    if (name.split(' ').length >= 2 && !candidates.has(url)) candidates.set(url, name);
  });

  const people = [];
  for (const [profileUrl, name] of candidates) {
    const html = await fetchHtml(profileUrl);
    const $$ = cheerio.load(html);
    const email = $$('a[href^="mailto:"]').map((_, a) => $$(a).attr('href')).get()
      .map(h => h.replace(/^mailto:/i, '').toLowerCase())
      .find(e => e.endsWith('@mesacounty.us'));
    if (!email) continue; // self-validation: non-person pages drop out here
    const district = ($$.text().match(/District\s+([0-9])/) ?? [null, null])[1];
    people.push({
      name, title: 'County Commissioner',
      district: district ? `District ${district}` : null,
      email, phone: null, profileUrl,
    });
  }
  return people;
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: mesa-county source module with self-validating discovery"`

---

### Task 8: Validation

**Files:**
- Create: `scraper/validate.js`, `test/validate.test.js`

**Interfaces:**
- Consumes: `Locale` config shape (Task 1), `Person[]` (Task 4 contract).
- Produces: `validateContacts(localeConfig, people) -> string[]` — empty array means valid; each string is a human-readable problem. Task 9 refuses to write data and exits non-zero when non-empty.

- [ ] **Step 1: Write the failing tests**

`test/validate.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContacts } from '../scraper/validate.js';

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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/validate.js`:
```js
export function validateContacts(localeConfig, people) {
  const errors = [];
  const body = localeConfig.bodies.find(b => b.scraped);
  const label = `${localeConfig.id}/${body.id}`;

  if (people.length !== body.expectedCount) {
    errors.push(`${label}: expected ${body.expectedCount} members, got ${people.length}`);
  }
  for (const p of people) {
    const who = p.name?.trim() || '(unnamed)';
    if (!p.name?.trim()) errors.push(`${label}: member with blank name`);
    if (p.email == null) {
      if (!body.groupEmail) errors.push(`${label}: ${who} has no email and body has no groupEmail`);
    } else if (!p.email.endsWith(`@${localeConfig.emailDomain}`)) {
      errors.push(`${label}: ${who} email "${p.email}" not on expected domain ${localeConfig.emailDomain}`);
    }
  }
  return errors;
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -am "feat: contact validation rules"`

---

### Task 9: Scrape orchestrator + first real data

**Files:**
- Create: `scraper/scrape.js`, `test/scrape.test.js`, `data/*.contacts.json` (generated)

**Interfaces:**
- Consumes: config (Task 1), `fetchHtml` (Task 3), source modules (Tasks 4–7), `validateContacts` (Task 8).
- Produces: CLI `node scraper/scrape.js [--locale=<id>]` writing `data/<id>.contacts.json` as `{ scrapedAt: ISO-8601, bodies: { council: Person[] } }`; prints per-locale status; **exit code 1** if any locale failed to fetch or validate (failed locales' files are left untouched). Exports `runScrape(config, fetchImpl, dataDir)` for testing. The frontend (Task 12) and diff summary (Task 15) read these files.

- [ ] **Step 1: Write the failing test**

`test/scrape.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScrape } from '../scraper/scrape.js';

const goodConfig = { locales: [{
  id: 'fruita', label: 'Fruita', emailDomain: 'fruita.org',
  scrape: { module: 'fruita', urls: { list: 'https://www.fruita.org/citycouncil' } },
  bodies: [{ id: 'council', scraped: true, expectedCount: 7 }],
}] };
const fixture = readFileSync(new URL('./fixtures/fruita-council.html', import.meta.url), 'utf8');

test('writes contacts.json for a valid locale and reports success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrape-'));
  const result = await runScrape(goodConfig, async () => fixture, dir);
  assert.deepEqual(result.failed, []);
  const out = JSON.parse(readFileSync(join(dir, 'fruita.contacts.json'), 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(out.scrapedAt)));
  assert.equal(out.bodies.council.length, 7);
});

test('a failing locale writes nothing and is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrape-'));
  const result = await runScrape(goodConfig, async () => '<html><body>Site redesigned!</body></html>', dir);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].errors.join(' '), /expected 7, got 0|fetch failed/i);
  assert.ok(!existsSync(join(dir, 'fruita.contacts.json')));
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/scrape.js`:
```js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fetchHtml } from './lib/fetch.js';
import { validateContacts } from './validate.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export async function runScrape(config, fetchImpl, dataDir) {
  const failed = [];
  for (const locale of config.locales) {
    try {
      const mod = await import(pathToFileURL(join(ROOT, 'scraper', 'sources', `${locale.scrape.module}.js`)).href);
      const people = await mod.scrape(fetchImpl, locale.scrape);
      const errors = validateContacts(locale, people);
      if (errors.length) { failed.push({ id: locale.id, errors }); continue; }
      const body = locale.bodies.find(b => b.scraped);
      const out = { scrapedAt: new Date().toISOString(), bodies: { [body.id]: people } };
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, `${locale.id}.contacts.json`), JSON.stringify(out, null, 2) + '\n');
      console.log(`ok   ${locale.id}: ${people.length} members`);
    } catch (err) {
      failed.push({ id: locale.id, errors: [err.message] });
    }
  }
  for (const f of failed) console.error(`FAIL ${f.id}:\n  - ${f.errors.join('\n  - ')}`);
  return { failed };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = JSON.parse(readFileSync(join(ROOT, 'config', 'locales.json'), 'utf8'));
  const only = process.argv.find(a => a.startsWith('--locale='))?.split('=')[1];
  if (only) config.locales = config.locales.filter(l => l.id === only);
  const { failed } = await runScrape(config, fetchHtml, join(ROOT, 'data'));
  process.exit(failed.length ? 1 : 0);
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: First live run** — `npm run scrape` — Expected: `ok` for all four locales and four files in `data/`. Open each and eyeball the rosters against the Reference section above. If a live page changed since the fixtures were taken, fix the parser (and refresh the fixture) now.

- [ ] **Step 6: Commit** — `git add scraper/scrape.js test/scrape.test.js data/ && git commit -m "feat: scrape orchestrator + initial contact data for all four locales"`

---

### Task 10: Content fetcher + seed content

**Files:**
- Create: `scraper/fetch-content.js`, `test/fetch-content.test.js`, `data/<id>.content.json` × 4 (seeded)

**Interfaces:**
- Consumes: `config.sheets` (Task 1), `parseCsv` (Task 2), `fetchHtml` signature (Task 3).
- Produces: CLI `node scraper/fetch-content.js` writing `data/<id>.content.json` = `{ fetchedAt: ISO|null, templates: [{title,subject,message}], faqs: [{question,answer}] }` for every locale. Sheet rows apply to a locale when `row.locale === id` or `row.locale === 'all'`. When both sheet URLs are `null` (Sheet not created yet) it prints a notice and exits 0 **without touching files**. Exports `buildContent(config, fetchImpl) -> Map<id, content>` for testing. The frontend (Task 13) reads these files.

- [ ] **Step 1: Write the failing test**

`test/fetch-content.test.js`:
```js
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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/fetch-content.js`:
```js
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml } from './lib/fetch.js';
import { parseCsv } from './lib/csv.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export async function buildContent(config, fetchImpl) {
  const { templates: tUrl, faqs: fUrl } = config.sheets;
  if (!tUrl && !fUrl) return null;
  const templates = tUrl ? parseCsv(await fetchImpl(tUrl)) : [];
  const faqs = fUrl ? parseCsv(await fetchImpl(fUrl)) : [];
  const fetchedAt = new Date().toISOString();
  const forLocale = (rows, id) => rows.filter(r => r.locale === id || r.locale === 'all');
  return new Map(config.locales.map(l => [l.id, {
    fetchedAt,
    templates: forLocale(templates, l.id).map(({ title, subject, message }) => ({ title, subject, message })),
    faqs: forLocale(faqs, l.id).map(({ question, answer }) => ({ question, answer })),
  }]));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const config = JSON.parse(readFileSync(join(ROOT, 'config', 'locales.json'), 'utf8'));
  const out = await buildContent(config, fetchHtml);
  if (!out) { console.log('sheets not configured yet; nothing to do'); process.exit(0); }
  for (const [id, content] of out) {
    writeFileSync(join(ROOT, 'data', `${id}.content.json`), JSON.stringify(content, null, 2) + '\n');
    console.log(`ok   ${id}: ${content.templates.length} templates, ${content.faqs.length} faqs`);
  }
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Seed content files by hand** (until the Sheet exists). For each locale, create `data/<id>.content.json` with this exact shape — one welcoming general template, FAQs empty (they arrive via the Sheet later):

```json
{
  "fetchedAt": null,
  "templates": [
    {
      "title": "General comment",
      "subject": "A comment from a constituent",
      "message": "Dear members,\n\nI am a resident writing to share my thoughts on an issue that matters to me.\n\n[Describe the issue and what action you hope to see.]\n\nThank you for your service and for considering my input."
    }
  ],
  "faqs": []
}
```

- [ ] **Step 6: Commit** — `git add scraper/fetch-content.js test/fetch-content.test.js data/*.content.json && git commit -m "feat: sheet content fetcher + seed content"`

---

### Task 11: Frontend shell — HTML, CSS, tab navigation

**Files:**
- Create: `index.html`, `css/main.css`, `js/main.js`

**Interfaces:**
- Consumes: `config/locales.json`, `data/*.json` via `fetch()` with **relative** paths.
- Produces: page skeleton and `js/main.js` module structure that Tasks 12–14 extend: `state = { locales, dataById, selected: Map<localeId, Set<email>> }`, functions `init()`, `renderTabs()`, `renderLocale(locale)`. Element ids used by later tasks: `#tabs`, `#panel`, `#action-bar`, `#output`.

- [ ] **Step 1: index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Contact your local elected officials in Mesa County, Colorado — Grand Junction, Fruita, Palisade, and the county commissioners.">
  <title>Mesa County Contact Tool</title>
  <link rel="stylesheet" href="css/main.css">
</head>
<body>
  <header class="site-header">
    <h1>Mesa County Contact Tool</h1>
    <p class="tagline">Send your voice to your local government</p>
    <nav id="tabs" class="tabs" aria-label="Choose your local government"></nav>
  </header>
  <main id="panel"></main>
  <div id="action-bar" class="action-bar" hidden></div>
  <section id="output" class="output" hidden></section>
  <footer class="site-footer" id="footer"></footer>
  <noscript>
    <p>This tool needs JavaScript. You can find officials directly at
      <a href="https://www.gjcity.org/313/City-Council">Grand Junction</a>,
      <a href="https://www.fruita.org/citycouncil">Fruita</a>,
      <a href="https://palisade.colorado.gov/board-of-trustees">Palisade</a>, and
      <a href="https://www.mesacounty.us/departments-and-services/commissioners">Mesa County</a>.</p>
  </noscript>
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: css/main.css** — design tokens + shell (Tasks 12–14 add component rules to this same file; keep this structure):

```css
:root {
  --bg: #f7f6f3; --surface: #ffffff; --ink: #1c2321; --muted: #5c6662;
  --accent: #1d6a5a; --accent-ink: #ffffff; --border: #ddd8d0;
  --radius: 10px; --shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14181a; --surface: #1e2427; --ink: #e8e6e1; --muted: #9aa5a0;
    --accent: #4fb39c; --accent-ink: #0c1512; --border: #313a3e;
    --shadow: 0 1px 3px rgb(0 0 0 / 40%);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.5;
}
.site-header { text-align: center; padding: 2rem 1rem 0.5rem; }
.site-header h1 { margin: 0; font-size: clamp(1.4rem, 4vw, 2rem); }
.tagline { color: var(--muted); margin: 0.25rem 0 1.25rem; }
.tabs { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center; }
.tab {
  border: 1px solid var(--border); background: var(--surface); color: var(--ink);
  padding: 0.5rem 1.1rem; border-radius: 999px; cursor: pointer; font-size: 1rem;
}
.tab[aria-selected="true"] { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
main { max-width: 60rem; margin: 0 auto; padding: 1rem; }
.site-footer { text-align: center; color: var(--muted); font-size: 0.85rem; padding: 2rem 1rem 6rem; }
```

- [ ] **Step 3: js/main.js**

```js
const state = { locales: [], dataById: new Map(), selected: new Map(), active: null };

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function init() {
  const config = await loadJson('config/locales.json');
  state.locales = config.locales;
  await Promise.all(state.locales.map(async l => {
    const [contacts, content] = await Promise.all([
      loadJson(`data/${l.id}.contacts.json`),
      loadJson(`data/${l.id}.content.json`),
    ]);
    state.dataById.set(l.id, { contacts, content });
    state.selected.set(l.id, new Set());
  }));
  renderTabs();
  const fromHash = location.hash.replace('#', '');
  activate(state.locales.some(l => l.id === fromHash) ? fromHash : state.locales[0].id);
  addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (state.locales.some(l => l.id === id) && id !== state.active) activate(id);
  });
}

function renderTabs() {
  const nav = document.getElementById('tabs');
  nav.innerHTML = '';
  for (const l of state.locales) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.textContent = l.label;
    btn.setAttribute('role', 'tab');
    btn.dataset.id = l.id;
    btn.addEventListener('click', () => { location.hash = l.id; });
    nav.append(btn);
  }
}

function activate(id) {
  state.active = id;
  document.querySelectorAll('.tab').forEach(t =>
    t.setAttribute('aria-selected', String(t.dataset.id === id)));
  renderLocale(state.locales.find(l => l.id === id));
}

function renderLocale(locale) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = locale.label;
  panel.append(h); // Tasks 12–14 replace/extend this body
  renderFooter(locale);
}

function renderFooter(locale) {
  const { contacts } = state.dataById.get(locale.id);
  const el = document.getElementById('footer');
  el.textContent = contacts.scrapedAt
    ? `Contacts last updated ${new Date(contacts.scrapedAt).toLocaleDateString()}`
    : '';
}

init().catch(err => {
  document.getElementById('panel').textContent = `Failed to load data: ${err.message}`;
});
```

- [ ] **Step 4: Manual verification** — `python3 -m http.server 8080` from repo root, open `http://localhost:8080/`. Expected: header, four working pill tabs, hash updates (`#fruita`), locale heading changes, footer shows the scrape date, dark mode follows the OS setting. Also verify from a subpath: `http://localhost:8080/index.html` works (relative paths).

- [ ] **Step 5: Commit** — `git add index.html css js && git commit -m "feat: frontend shell with data-driven locale tabs"`

---

### Task 12: Person cards, selection, sticky action bar

**Files:**
- Modify: `js/main.js` (replace `renderLocale` body), `css/main.css` (append component styles)

**Interfaces:**
- Consumes: shell from Task 11; `contacts.bodies`, `bodies[].staticMembers`, `bodies[].groupEmail` from config/data.
- Produces: selection stored as `state.selected.get(localeId): Set<string>` of **email addresses** (a group-email body contributes its `groupEmail` once, no matter how many of its members are selected — dedupe is inherent to the Set). `updateActionBar()` used by Task 13. Helper `peopleForBody(locale, body)` merging scraped people and `staticMembers`.

- [ ] **Step 1: renderLocale**

Replace `renderLocale` in `js/main.js` and add helpers:

```js
function peopleForBody(locale, body) {
  const { contacts } = state.dataById.get(locale.id);
  const scraped = body.scraped ? (contacts.bodies[body.id] ?? []) : [];
  const statics = (body.staticMembers ?? []).map(m => ({ district: null, phone: null, profileUrl: null, email: null, ...m }));
  return [...scraped, ...statics];
}

function emailFor(person, body) {
  return person.email ?? body.groupEmail ?? null;
}

function renderLocale(locale) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';
  for (const body of locale.bodies) {
    const section = document.createElement('section');
    section.className = 'body-section';
    const head = document.createElement('div');
    head.className = 'body-head';
    const title = document.createElement('h2');
    title.textContent = body.label;
    const allBtn = document.createElement('button');
    allBtn.className = 'select-all';
    allBtn.type = 'button';
    head.append(title, allBtn);
    section.append(head);
    if (body.groupEmail) {
      const note = document.createElement('p');
      note.className = 'group-note';
      note.textContent = `Members share one address: ${body.groupEmail}`;
      section.append(note);
    }
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    const people = peopleForBody(locale, body);
    for (const person of people) grid.append(personCard(locale, body, person));
    section.append(grid);
    syncSelectAll(locale, body, allBtn, people);
    allBtn.addEventListener('click', () => {
      const sel = state.selected.get(locale.id);
      const emails = people.map(p => emailFor(p, body)).filter(Boolean);
      const allIn = emails.every(e => sel.has(e));
      for (const e of emails) allIn ? sel.delete(e) : sel.add(e);
      renderLocale(locale); updateActionBar();
    });
    panel.append(section);
  }
  renderFooter(locale);
  updateActionBar();
}

function syncSelectAll(locale, body, btn, people) {
  const sel = state.selected.get(locale.id);
  const emails = people.map(p => emailFor(p, body)).filter(Boolean);
  btn.textContent = emails.length && emails.every(e => sel.has(e)) ? 'Clear all' : 'Select all';
}

function personCard(locale, body, person) {
  const email = emailFor(person, body);
  const sel = state.selected.get(locale.id);
  const card = document.createElement(email ? 'button' : 'div');
  card.className = 'person-card';
  const name = document.createElement('strong');
  name.textContent = person.name;
  const sub = document.createElement('small');
  sub.textContent = [person.title, person.district].filter(Boolean).join(' · ');
  card.append(name, sub);
  if (email) {
    card.type = 'button';
    card.setAttribute('aria-pressed', String(sel.has(email)));
    card.classList.toggle('selected', sel.has(email));
    card.addEventListener('click', () => {
      sel.has(email) ? sel.delete(email) : sel.add(email);
      renderLocale(locale); updateActionBar();
    });
  } else if (person.profileUrl) {
    const link = document.createElement('a');
    link.href = person.profileUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Contact via their page';
    card.append(link);
  }
  return card;
}

function updateActionBar() {
  const bar = document.getElementById('action-bar');
  const count = state.selected.get(state.active)?.size ?? 0;
  bar.hidden = count === 0;
  if (count === 0) { document.getElementById('output').hidden = true; return; }
  bar.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = `${count} recipient${count === 1 ? '' : 's'} selected`;
  const go = document.createElement('button');
  go.className = 'primary';
  go.type = 'button';
  go.textContent = 'Generate message';
  go.addEventListener('click', () => showOutput());   // Task 13 implements showOutput
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  clear.addEventListener('click', () => {
    state.selected.get(state.active).clear();
    renderLocale(state.locales.find(l => l.id === state.active));
  });
  bar.append(label, go, clear);
}
```

Until Task 13, add a stub after `updateActionBar`: `function showOutput() {}`.

- [ ] **Step 2: Append component CSS**

```css
.body-section { margin: 1.5rem 0; }
.body-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
.body-head h2 { font-size: 1.15rem; margin: 0.5rem 0; }
.select-all { background: none; border: none; color: var(--accent); cursor: pointer; font-size: 0.9rem; }
.group-note { color: var(--muted); font-size: 0.85rem; margin: 0 0 0.5rem; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 0.6rem; }
.person-card {
  display: flex; flex-direction: column; gap: 0.15rem; text-align: left;
  background: var(--surface); border: 1.5px solid var(--border); border-radius: var(--radius);
  padding: 0.7rem 0.9rem; cursor: pointer; box-shadow: var(--shadow);
  color: var(--ink); font: inherit;
}
.person-card small { color: var(--muted); }
.person-card.selected { border-color: var(--accent); outline: 2px solid var(--accent); outline-offset: -2px; }
div.person-card { cursor: default; }
.action-bar {
  position: fixed; inset: auto 0 0 0; display: flex; gap: 0.75rem; align-items: center;
  justify-content: center; padding: 0.75rem 1rem; background: var(--surface);
  border-top: 1px solid var(--border); box-shadow: 0 -2px 8px rgb(0 0 0 / 10%);
}
.action-bar button { font: inherit; padding: 0.5rem 1.2rem; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg); color: var(--ink); cursor: pointer; }
.action-bar button.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
```

- [ ] **Step 3: Manual verification** — serve locally. Expected: cards render for every locale; clicking toggles selection highlight; "Select all"/"Clear all" flips per body; Palisade trustees select but the count reflects **one** shared recipient; sticky bar appears with correct count; officials without any email (if any) show a profile link card.

- [ ] **Step 4: Commit** — `git commit -am "feat: person cards, selection model, sticky action bar"`

---

### Task 13: Message generation — templates, mailto, copy fallbacks, salutation

**Files:**
- Modify: `js/main.js` (implement `showOutput`), `css/main.css` (append)

**Interfaces:**
- Consumes: selection Set (Task 12), `content.templates` (Task 10 shape), `locale.districts` (Task 1).
- Produces: `showOutput()` rendering into `#output`: template `<select>`, editable subject `<input>` + message `<textarea>`, salutation inputs, primary `mailto:` anchor, copy buttons. `buildMailto(emails, subject, body) -> string`; if the resulting URL exceeds 1800 chars the manual-copy section auto-opens with a notice instead of relying on the link.

- [ ] **Step 1: Implement (replace the Task 12 stub)**

```js
function showOutput() {
  const locale = state.locales.find(l => l.id === state.active);
  const { content } = state.dataById.get(locale.id);
  const out = document.getElementById('output');
  out.hidden = false;
  out.innerHTML = '';

  const templates = content.templates.length
    ? content.templates
    : [{ title: 'Blank', subject: '', message: '' }];

  const pick = document.createElement('select');
  for (const [i, t] of templates.entries()) {
    const opt = document.createElement('option');
    opt.value = i; opt.textContent = t.title;
    pick.append(opt);
  }

  const subject = document.createElement('input');
  subject.id = 'subject'; subject.placeholder = 'Subject';
  const message = document.createElement('textarea');
  message.id = 'message'; message.rows = 10; message.placeholder = 'Your message';

  const salName = document.createElement('input');
  salName.placeholder = 'Your name (optional)';
  let salDistrict = null;
  if (locale.districts) {
    salDistrict = document.createElement('select');
    const none = document.createElement('option');
    none.value = ''; none.textContent = `${locale.districts.label} (optional)`;
    salDistrict.append(none);
    for (const d of locale.districts.options) {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      salDistrict.append(opt);
    }
  }

  const apply = () => {
    const t = templates[Number(pick.value)];
    subject.value = t.subject;
    message.value = t.message + salutation();
    refreshSend();
  };
  const salutation = () => {
    const parts = [];
    if (salName.value.trim()) parts.push(salName.value.trim());
    if (salDistrict?.value) parts.push(`${salDistrict.value} resident`);
    return parts.length ? `\n\nSincerely,\n${parts.join('\n')}` : '';
  };

  const send = document.createElement('a');
  send.className = 'send-btn';
  send.textContent = 'Open in your email app';
  const notice = document.createElement('p');
  notice.className = 'length-notice'; notice.hidden = true;
  notice.textContent = 'This message is long — some email apps cut off long links. Use the copy buttons below instead.';

  const emails = [...state.selected.get(locale.id)];
  const refreshSend = () => {
    const url = buildMailto(emails, subject.value, message.value);
    send.href = url;
    const tooLong = url.length > 1800;
    notice.hidden = !tooLong;
    manual.open = tooLong || manual.open;
  };

  const manual = document.createElement('details');
  manual.className = 'manual-copy';
  const summ = document.createElement('summary');
  summ.textContent = 'Or copy manually';
  manual.append(summ,
    copyRow('Recipients', () => emails.join(', ')),
    copyRow('Subject', () => subject.value),
    copyRow('Message', () => message.value));

  pick.addEventListener('change', apply);
  salName.addEventListener('input', apply);
  salDistrict?.addEventListener('change', apply);
  subject.addEventListener('input', refreshSend);
  message.addEventListener('input', refreshSend);

  const salWrap = document.createElement('div');
  salWrap.className = 'salutation';
  salWrap.append(salName);
  if (salDistrict) salWrap.append(salDistrict);
  if (locale.districts) {
    const mapLink = document.createElement('a');
    mapLink.href = locale.districts.mapUrl;
    mapLink.target = '_blank'; mapLink.rel = 'noopener';
    mapLink.textContent = 'Find your district';
    salWrap.append(mapLink);
  }

  out.append(pick, salWrap, subject, message, send, notice, manual);
  apply();
  out.scrollIntoView({ behavior: 'smooth' });
}

function buildMailto(emails, subject, body) {
  return `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function copyRow(label, getValue) {
  const row = document.createElement('div');
  row.className = 'copy-row';
  const span = document.createElement('span');
  span.textContent = label;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = `Copy ${label.toLowerCase()}`;
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(getValue());
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = `Copy ${label.toLowerCase()}`; }, 1500);
  });
  row.append(span, btn);
  return row;
}
```

- [ ] **Step 2: Append CSS**

```css
.output { max-width: 60rem; margin: 0 auto; padding: 0 1rem 2rem; display: flex; flex-direction: column; gap: 0.7rem; }
.output select, .output input, .output textarea {
  font: inherit; color: var(--ink); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 0.6rem 0.8rem; width: 100%;
}
.salutation { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
.salutation input, .salutation select { width: auto; flex: 1 1 12rem; }
.send-btn {
  display: block; text-align: center; background: var(--accent); color: var(--accent-ink);
  padding: 0.8rem; border-radius: var(--radius); text-decoration: none; font-weight: 600;
}
.length-notice { color: var(--muted); font-size: 0.9rem; }
.manual-copy summary { cursor: pointer; color: var(--accent); }
.copy-row { display: flex; justify-content: space-between; align-items: center; padding: 0.35rem 0; }
.copy-row button { font: inherit; border: 1px solid var(--border); background: var(--surface); color: var(--ink); border-radius: var(--radius); padding: 0.35rem 0.9rem; cursor: pointer; }
```

- [ ] **Step 3: Manual verification** — serve locally. Expected: Generate reveals the panel and scrolls to it; template dropdown fills subject/message; name + district append a salutation; the mailto link opens the OS mail client with recipients/subject/body populated; copy buttons work; editing subject/message updates the mailto; a very long pasted message auto-opens the manual section with the notice; Fruita/Palisade show no district dropdown.

- [ ] **Step 4: Commit** — `git commit -am "feat: message generation with mailto, templates, salutation, copy fallbacks"`

---

### Task 14: FAQ, links, and finishing touches

**Files:**
- Modify: `js/main.js` (extend `renderLocale`), `css/main.css` (append)

**Interfaces:**
- Consumes: `content.faqs` (Task 10), `locale.links` (Task 1).

- [ ] **Step 1: Extend renderLocale** — after the bodies loop in `renderLocale`, before `renderFooter(locale)`:

```js
  const { content } = state.dataById.get(locale.id);
  if (content.faqs.length) {
    const faqSec = document.createElement('section');
    faqSec.className = 'faq';
    const h = document.createElement('h2');
    h.textContent = 'Frequently asked questions';
    faqSec.append(h);
    for (const f of content.faqs) {
      const d = document.createElement('details');
      const s = document.createElement('summary');
      s.textContent = f.question;
      const p = document.createElement('p');
      p.textContent = f.answer;
      d.append(s, p);
      faqSec.append(d);
    }
    panel.append(faqSec);
  }
  if (locale.links.length) {
    const linkSec = document.createElement('section');
    linkSec.className = 'links';
    const h = document.createElement('h2');
    h.textContent = 'Helpful links';
    const ul = document.createElement('ul');
    for (const l of locale.links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = l.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = l.label;
      li.append(a);
      ul.append(li);
    }
    linkSec.append(h, ul);
    panel.append(linkSec);
  }
```

- [ ] **Step 2: Append CSS**

```css
.faq details { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.6rem 0.9rem; margin: 0.4rem 0; }
.faq summary { cursor: pointer; font-weight: 600; }
.links a, .group-note a { color: var(--accent); }
```

- [ ] **Step 3: Manual verification** — temporarily add one FAQ row to a seed `content.json`, confirm accordion renders and toggles, links open in new tabs; revert the temp FAQ. Walk every locale end-to-end once (select → generate → mailto) on desktop width and a narrow (375px) viewport.

- [ ] **Step 4: Commit** — `git commit -am "feat: per-locale FAQ and helpful links"`

---

### Task 15: Diff summary + GitHub Actions workflows

**Files:**
- Create: `scraper/diff-summary.js`, `test/diff-summary.test.js`, `.github/workflows/scrape.yml`, `.github/workflows/content.yml`

**Interfaces:**
- Consumes: `data/*.contacts.json` shape (Task 9).
- Produces: `summarizeDiff(oldJson, newJson, localeId) -> string[]` (exported, tested) and a CLI that compares `git show HEAD:data/<f>` against the working tree for every contacts file, printing a markdown summary (used as the PR body).

- [ ] **Step 1: Write the failing test**

`test/diff-summary.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDiff } from '../scraper/diff-summary.js';

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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`scraper/diff-summary.js`:
```js
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarizeDiff(oldData, newData, localeId) {
  const lines = [];
  const bodies = new Set([...Object.keys(oldData.bodies ?? {}), ...Object.keys(newData.bodies ?? {})]);
  for (const bodyId of bodies) {
    const oldPeople = new Map((oldData.bodies?.[bodyId] ?? []).map(p => [p.name, p]));
    const newPeople = new Map((newData.bodies?.[bodyId] ?? []).map(p => [p.name, p]));
    for (const [name, p] of newPeople) {
      const prev = oldPeople.get(name);
      if (!prev) { lines.push(`**${localeId}**: added ${name} (${p.email ?? 'no email'})`); continue; }
      for (const field of ['email', 'district', 'title', 'phone']) {
        if ((prev[field] ?? null) !== (p[field] ?? null)) {
          lines.push(`**${localeId}**: ${name}'s ${field} changed from \`${prev[field]}\` to \`${p[field]}\``);
        }
      }
    }
    for (const name of oldPeople.keys()) {
      if (!newPeople.has(name)) lines.push(`**${localeId}**: removed ${name}`);
    }
  }
  return lines;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
  const dataDir = join(ROOT, 'data');
  const all = [];
  for (const file of readdirSync(dataDir).filter(f => f.endsWith('.contacts.json'))) {
    const localeId = file.replace('.contacts.json', '');
    let oldData = { bodies: {} };
    try {
      oldData = JSON.parse(execSync(`git show HEAD:data/${file}`, { cwd: ROOT, encoding: 'utf8' }));
    } catch { /* new file */ }
    const newData = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
    all.push(...summarizeDiff(oldData, newData, localeId));
  }
  console.log(all.length
    ? `Scheduled scrape found contact changes:\n\n${all.map(l => `- ${l}`).join('\n')}`
    : 'No contact changes.');
}
```

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: scrape.yml**

`.github/workflows/scrape.yml`:
```yaml
name: Scrape contacts
on:
  schedule:
    - cron: '0 13 * * 1'   # Mondays ~7am Mountain
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Scrape
        id: scrape
        run: node scraper/scrape.js 2> scrape-errors.txt || echo "failed=true" >> "$GITHUB_OUTPUT"
      - name: Open issue on scrape failure
        if: steps.scrape.outputs.failed == 'true'
        env: { GH_TOKEN: '${{ github.token }}' }
        run: |
          title="Scrape failure $(date -u +%F)"
          gh issue create --title "$title" --body "$(printf 'The scheduled scrape failed validation; live data was left untouched.\n\n```\n%s\n```' "$(cat scrape-errors.txt)")" \
            --label scrape-failure || true
      - name: Build PR body
        id: diff
        run: |
          node scraper/diff-summary.js > pr-body.md
          if git diff --quiet -- data/; then echo "changed=false" >> "$GITHUB_OUTPUT"; else echo "changed=true" >> "$GITHUB_OUTPUT"; fi
      - name: Open PR with changes
        if: steps.diff.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          add-paths: data/
          branch: scrape-updates
          title: 'Contact data updates from scheduled scrape'
          body-path: pr-body.md
          commit-message: 'chore: scraped contact data update'
```

- [ ] **Step 6: content.yml**

`.github/workflows/content.yml`:
```yaml
name: Fetch sheet content
on:
  schedule:
    - cron: '30 13 * * *'   # daily
  workflow_dispatch:

permissions:
  contents: write
  issues: write

jobs:
  content:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - name: Fetch content
        id: fetch
        run: node scraper/fetch-content.js || echo "failed=true" >> "$GITHUB_OUTPUT"
      - name: Open issue on failure
        if: steps.fetch.outputs.failed == 'true'
        env: { GH_TOKEN: '${{ github.token }}' }
        run: gh issue create --title "Sheet content fetch failed $(date -u +%F)" --body "fetch-content.js exited non-zero; existing content.json files were left untouched." || true
      - name: Commit content updates
        run: |
          git config user.name 'github-actions[bot]'
          git config user.email 'github-actions[bot]@users.noreply.github.com'
          git add data/*.content.json
          git diff --cached --quiet || git commit -m 'chore: sheet content update'
          git push
```

- [ ] **Step 7: Validate workflow YAML locally** — `node -e "console.log('yaml parse ok')"` isn't enough; if `actionlint` is available (`brew install actionlint`), run `actionlint`. Otherwise rely on the first `workflow_dispatch` run in Task 16.

- [ ] **Step 8: Commit** — `git add scraper/diff-summary.js test/diff-summary.test.js .github && git commit -m "feat: diff summary and scheduled scrape/content workflows"`

---

### Task 16: Publish — GitHub repo, Pages, README, Sheet handoff

**Files:**
- Create: `README.md`
- External: GitHub repo, Pages settings, first workflow runs

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: README.md**

```markdown
# Mesa County Contact Tool

A static tool for contacting local elected officials in Mesa County, Colorado —
Grand Junction, Fruita, Palisade, and the Board of County Commissioners.
Modeled on [FvilleCityTool], rebuilt to repeat across locales.

**Live site:** https://<user>.github.io/mesaContactTool/

## How it works

- `index.html` + `js/main.js` render everything from `config/locales.json` and `data/*.json`.
  There is no build step; GitHub Pages serves `main` as-is.
- `.github/workflows/scrape.yml` (weekly) scrapes each government's website,
  validates the results, and **opens a PR** when contact info changed.
  Merging the PR is the deploy. Failures open an issue and never touch live data.
- `.github/workflows/content.yml` (daily) pulls campaign templates and FAQs
  from a Google Sheet into `data/*.content.json` and commits directly.

## Adding a locale

1. Add an entry to `config/locales.json` (id, label, emailDomain, scrape URLs, bodies, links).
2. If no existing source module fits, add `scraper/sources/<id>.js` implementing
   `scrape(fetchHtml, scrapeConfig) -> [{name,title,district,email,phone,profileUrl}]`,
   a fixture in `test/fixtures/`, and a test.
3. Run `npm run scrape` and commit the new data file. Done — the frontend picks it up from config.

## Development

```bash
npm install
npm test                    # parser/validation/csv tests against fixtures
npm run scrape              # live scrape into data/
python3 -m http.server 8080 # serve the site locally
```

## Editing campaigns and FAQs

Edit the Google Sheet (tabs: `templates`, `faqs`; each row has a `locale`
column — a locale id or `all`). The daily workflow publishes it; or trigger
"Fetch sheet content" manually from the Actions tab.
```

(Replace `<user>` with the real GitHub username; link FvilleCityTool to its repo.)

- [ ] **Step 2: Create the GitHub repo and push**

```bash
gh repo create mesaContactTool --public --source=. --push
```

- [ ] **Step 3: Enable Pages** (deploy from branch `main`, root):

```bash
gh api -X POST "repos/{owner}/mesaContactTool/pages" -f 'source[branch]=main' -f 'source[path]=/' \
  || gh api -X PUT "repos/{owner}/mesaContactTool/pages" -f 'source[branch]=main' -f 'source[path]=/'
```

Then verify the live URL loads and every tab works. (Data `fetch()` must succeed over Pages — if `config/` or `data/` 404, check `.nojekyll` was pushed.)

- [ ] **Step 4: Allow Actions to open PRs** — repo Settings → Actions → General → Workflow permissions: enable "Allow GitHub Actions to create and approve pull requests" (or `gh api -X PUT repos/{owner}/mesaContactTool/actions/permissions/workflow -f default_workflow_permissions=write -F can_approve_pull_request_reviews=true`).

- [ ] **Step 5: Trigger both workflows manually** (`gh workflow run scrape.yml`, `gh workflow run content.yml`) and watch (`gh run watch`). Expected: scrape run green with "No contact changes" (or a PR if a roster changed since Task 9); content run prints "sheets not configured yet".

- [ ] **Step 6: Google Sheet handoff (user action)** — create a Sheet with tabs `templates` (`locale,title,subject,message`) and `faqs` (`locale,question,answer`); File → Share → Publish to web → each tab as CSV; paste the two URLs into `config/locales.json` `sheets.templates` / `sheets.faqs`; commit, then run the content workflow and confirm `data/*.content.json` update.

- [ ] **Step 7: Final commit & close** — `git add README.md && git commit -m "docs: README with operations guide" && git push`. Update this plan's checkboxes, run the full test suite one last time.

---

## Self-review notes (spec coverage)

- Spec §Scope locales/bodies → Tasks 1, 4–7, 9. §Features → Tasks 12–14 (cards, templates, mailto+copy, salutation w/ district-config gating, FAQ, links, footer date). §Architecture/hosting → Tasks 1, 16 (.nojekyll, relative paths, Pages). §Data model → Tasks 1, 9, 10 (groupEmail addition for Palisade is a body-level field, an extension the spec's "person with no public email" rule required in practice). §Automation → Task 15 (PR-only contacts, direct-commit content, issues on failure). §Error handling table → Tasks 8, 9, 12 (profile-link fallback), 11 (noscript), 15 (issues). §Testing → fixtures + node:test throughout; frontend manual per spec.
- Static-member offices are config-maintained rather than scraped: role addresses (cityclerk@, mcadmin@) are stable by design; noted as a deliberate narrowing of "scraped contacts" consistent with the spec's hand-maintained config file.
```
