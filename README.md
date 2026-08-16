# Mesa County Contact Tool

A tool for contacting local elected officials in Mesa County, Colorado — the
Grand Junction City Council, Fruita City Council, Palisade Board of Trustees,
and the Mesa County Board of County Commissioners. Residents pick who they
want to reach, can generate some copy on the topic promoted to get started on their message, and send it from their email service (with an easy copy/paste tool).

## How it works

There is no build step and no server. `index.html` plus `js/main.js` render
everything from JSON at runtime:

- `config/locales.json` — the locale registry, maintained by hand. One entry
  per locale: which scraper to use, which bodies to show, expected member
  counts, districts, and helpful links.
- `data/<locale>.contacts.json` — written by the scraper, reviewed via PR.
- `data/<locale>.content.json` — campaign templates and FAQs from a Google
  Sheet.

Two scheduled GitHub Actions keep it current:

- **`scrape.yml`** (weekly, plus a "Run workflow" button) scrapes each
  government site, validates the result, and **opens a pull request** when
  anything changed. Nothing reaches the live site without your review.
  Validation failures open an issue and leave the live data untouched, so a
  redesigned city website can never blank out the contact list.
- **`content.yml`** (daily) pulls the Google Sheet into the content files and
  commits directly — it's your own copy, so it doesn't need a second review.

`test.yml` runs the test suite on every push and pull request.

## Adding a locale

1. Add an entry to `config/locales.json` (id, label, `emailDomain`, scrape
   URLs, bodies with `expectedCount`, optional `districts`, links).
2. If no existing source module fits, add `scraper/sources/<id>.js` exporting
   `scrape(fetchHtml, scrapeConfig) -> Promise<Person[]>` where `Person` is
   `{name, title, district, email, phone, profileUrl}`. Save a snapshot of the
   page under `test/fixtures/` and add a test against it.
3. Run `npm run scrape`, check the new data file, and commit.

The frontend needs no changes — it has no locale-specific code.

## Development

```bash
npm install
npm test                     # 51 tests: parsers, validation, CSV, data schema
npm run scrape               # live scrape into data/
npm run content              # pull the Google Sheet into data/
python3 -m http.server 8080  # then open http://localhost:8080/
```

Parser tests run against committed HTML snapshots in `test/fixtures/`, so they
work offline and pinpoint exactly what broke when a city redesigns its site.

## Editing campaigns and FAQs

Edit the Google Sheet: two tabs, `templates` (`locale,title,subject,message`)
and `faqs` (`locale,question,answer`). The `locale` column takes a locale id
or `all` for rows that apply everywhere. Publish each tab to the web as CSV and
put the two URLs in `config/locales.json` under `sheets`. The daily workflow
picks them up, or you can trigger "Fetch sheet content" from the Actions tab.

Until those URLs are set, each locale uses the seeded starter template in its
`content.json` and shows no FAQ section.

## Notes for whoever maintains this

- **Quiet is normal.** Scrapes that find no changes write nothing, so a
  healthy month produces no PRs and no commits. That means an open
  `scrape-failure` or `content-failure` issue is the *only* signal that
  something is wrong — watch repo notifications.
- **"Contacts last updated" means the last time a roster actually changed**,
  not the last time we checked.
- **Council size changes are a deliberate stop.** If a council gains or loses
  a seat, validation fails on the member count and opens an issue naming the
  expected and actual numbers. Update `expectedCount` in `config/locales.json`
  to accept it.
- **Two addresses no automation can verify**: the Grand Junction and Fruita
  city managers publish personal addresses rather than role aliases, so those
  cards carry the person's name to make staleness visible. Check them if
  either city has staff turnover.
- Palisade publishes no individual trustee addresses; that body routes to
  `boardoftrustees@townofpalisade.org`, and the card list says so.
