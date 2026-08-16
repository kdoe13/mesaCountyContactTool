# Mesa County Contact Tool — Design

**Date:** 2026-08-16
**Status:** Approved in brainstorming; pending final spec review

## Purpose

A community outreach tool for Mesa County, Colorado, modeled on
FvilleCityTool (`~/Sites/FvilleCityTool`) but designed from the start to
repeat across multiple locales. Residents pick officials, get a
prefilled email draft (or copyable fields), and send their voice to
local government.

Non-goals: user accounts, sending email server-side, tracking,
databases, any server-side runtime at all.

## Scope

**Locales at launch (one tab each):**

| Locale | Body | Key offices | Districts |
|---|---|---|---|
| Grand Junction | City Council | Mayor, City Manager, City Clerk | Council districts + at-large |
| Fruita | City Council | Mayor, City Manager, City Clerk | At-large (no district UI) |
| Palisade | Board of Trustees | Mayor, Town Administrator, Town Clerk | At-large (no district UI) |
| Mesa County | Board of County Commissioners | County Administrator, County Clerk | Commissioner districts 1–3 |

De Beque and Collbran are deliberately excluded at launch (populations
~350–500). Planning commissions and other boards/commissions are a
possible later phase, not in this design.

**Features per locale tab:**
- Selectable person cards grouped by body (Council/Commissioners, Key
  Offices), with check-all per group.
- Campaign template picker (subject + message) fed from a Google Sheet.
- "Open in your email app" `mailto:` button with recipients, subject,
  and body prefilled; copy-field fallbacks (emails / subject / message)
  behind an "or copy manually" toggle.
- Salutation helper: optional name + district dropdown + link to the
  official district map. District dropdown renders only for locales
  whose config lists districts.
- FAQ accordion and meeting/agenda links.
- "Data last updated" date in the footer from the scrape timestamp.

## Architecture

Static site, no build step, no server. GitHub Pages serves the repo's
`main` branch directly. All automation runs in GitHub Actions and
lands as commits/PRs to the repo. Hosting is free; the repo is public
(required for free-tier GitHub Pages; content is public government
data).

A custom domain can be added later purely via DNS + repo settings; to
keep that painless, all asset/data references in HTML/JS are relative
paths (the site must work at `https://<user>.github.io/mesaContactTool/`
and at a future domain root unchanged).

## Repository layout

```
mesaContactTool/
├── index.html            # the whole site (one page, four tabs)
├── css/main.css          # hand-written modern CSS, no framework
├── js/main.js            # generic renderer + message generator
├── config/
│   └── locales.json      # hand-maintained locale registry
├── data/                 # machine-written, reviewed via PR (contacts)
│   ├── grand-junction.contacts.json
│   ├── grand-junction.content.json
│   └── … (same pair per locale)
├── scraper/
│   ├── scrape.js         # entry point: node scraper/scrape.js [locale]
│   ├── sources/
│   │   ├── civicplus.js  # shared CivicPlus parser (GJ; likely Fruita/Palisade)
│   │   └── mesa-drupal.js# Mesa County parser
│   ├── fetch-content.js  # Google Sheet CSVs → content.json files
│   └── validate.js       # sanity checks; gate before any write
├── test/
│   ├── fixtures/         # saved HTML snapshots of each source page
│   └── *.test.js         # parser + schema tests (node:test)
├── docs/superpowers/specs/  # this document and future specs
└── .github/workflows/
    ├── scrape.yml        # weekly + manual; opens PR on changes
    └── content.yml       # daily; commits Sheet content to main
```

Only npm dependency: `cheerio` (HTML parsing in the scraper). The
frontend has zero dependencies.

## Data model

### `config/locales.json` (hand-maintained)

The single "add a locale here" file. Per locale:

```jsonc
{
  "id": "grand-junction",          // tab id, URL hash, data file prefix
  "label": "Grand Junction",
  "order": 1,
  "emailDomain": "gjcity.org",     // validation: scraped emails must match
  "scrape": {
    "parser": "civicplus",
    "sources": { "council": "<url>", "offices": ["<url>", …] }
  },
  "bodies": [
    { "id": "council", "label": "City Council", "expectedCount": 7 },
    { "id": "offices", "label": "Key Offices",  "expectedCount": 3 }
  ],
  "districts": {                    // omit entirely for at-large locales
    "label": "Council District",
    "options": ["District A", …],
    "mapUrl": "<official map url>"
  },
  "links": [ { "label": "Agendas & Minutes", "url": "…" }, … ]
}
```

`js/main.js` contains no locale-specific logic; everything it renders
is driven by this config plus the data files.

### `data/<id>.contacts.json` (written by scraper, merged via PR)

```jsonc
{
  "scrapedAt": "2026-08-16T12:00:00Z",
  "bodies": {
    "council": [
      { "name": "…", "title": "Council Member", "district": "District A",
        "email": "…", "phone": "…", "profileUrl": "…" }
    ],
    "offices": [ … ]
  }
}
```

A person with no public email is still included (`email: null`) and
renders with their profile link instead of a selectable card.

### `data/<id>.content.json` (written by content workflow, direct commit)

```jsonc
{
  "fetchedAt": "…",
  "templates": [ { "title": "…", "subject": "…", "message": "…" } ],
  "faqs": [ { "question": "…", "answer": "…" } ]
}
```

### Google Sheet

One spreadsheet, two published-CSV tabs, each with a `locale` column
(`grand-junction`, `fruita`, `palisade`, `mesa-county`, or `all` for
shared rows):

- `templates` (columns: locale, title, subject, message)
- `faqs` → `faqs` (columns: locale, question, answer)

Adding a locale requires no Sheet restructuring — just rows.

## Frontend

Single page, vanilla JS, hand-written CSS (~few hundred lines).

- Header with tool name; locales as a pill/segmented tab bar. Active
  tab tracked in the URL hash (`#fruita`) for shareable links.
- People render as selectable cards in a responsive grid (tap anywhere
  on the card), grouped under collapsible body sections with per-group
  check-all.
- Sticky bottom action bar appears when ≥1 selected: "N selected —
  Generate message".
- Output panel: template dropdown → prefilled `mailto:` button
  ("Open in your email app") + copy fallbacks. Salutation (name +
  district) is appended to the message when provided.
- FAQ accordion and links section per locale.
- Automatic light/dark via `prefers-color-scheme`; system font stack;
  mobile-first.
- Footer shows "Contacts last updated <date>" from `scrapedAt`.

## Automation

### `scrape.yml` — weekly cron + `workflow_dispatch`

1. Run scraper for every locale in config.
2. Run `validate.js`. Failures (fetch error, empty result, count
   mismatch vs `expectedCount`, malformed/foreign-domain email, missing
   name) → **no data written**; open or update a GitHub issue with
   details and stop.
3. If validated output differs from committed data → open a PR
   (branch per run) whose body summarizes the diff in plain English
   ("Grand Junction: Jane Doe's email changed; Fruita: 1 member
   added"). **Every contact change is human-reviewed**; merging the PR
   is the deploy.

### `content.yml` — daily cron + `workflow_dispatch`

Fetches the Sheet CSVs, rebuilds `*.content.json`, commits directly to
`main` (the user's own Sheet edits need no second review). Fetch
failure → keep existing data, open/update an issue.

### Deploy

GitHub Pages serves `main`. No build. Merge = live.

## Error handling summary

| Failure | Behavior |
|---|---|
| Source site unreachable / redesigned | Validation fails → issue opened, live data untouched |
| Scraped data suspicious (counts, domains, blanks) | Same — no PR, issue instead |
| Sheet fetch fails | Keep last good content.json, issue opened |
| Person has no public email | Rendered with profile link, not selectable |
| JS disabled in browser | `<noscript>` note with links to official directories |

## Testing

- **Parsers:** HTML fixture snapshots of each government page committed
  under `test/fixtures/`; `node:test` asserts extracted structures.
  Offline, deterministic, and pinpoints breakage when a site redesigns.
- **Validation:** unit tests for each rule.
- **Data/schema smoke test:** committed JSON parses and matches the
  shapes above; config references existing parsers.
- No browser-automation test rig; frontend verified manually.

## Decisions log

- Static + GitHub Pages/Actions over droplet hosting (droplet full;
  $0; automation-as-code is a project goal).
- No-build client-side rendering over an SSG (Eleventy) — YAGNI for
  one interactive page; identical result, fewer moving parts.
- No Bootstrap — modern hand-written CSS; `mailto:` as primary action
  (upgrade over Fville's copy-only flow).
- Scraped contact changes always PR (user choice); Sheet content
  auto-commits.
- GJ + Fruita + Palisade + Mesa County at launch; councils + key
  offices only.
