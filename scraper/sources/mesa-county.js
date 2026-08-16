import * as cheerio from 'cheerio';
import { mailtoEmail } from '../validate.js';

const clean = s => s.replace(/[\s ]+/g, ' ').trim();

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
    // The expected domain comes from config (scrape.js passes
    // locale.emailDomain through) rather than being hardcoded here.
    const email = $$('a[href^="mailto:"]').map((_, a) => $$(a).attr('href')).get()
      .map(h => mailtoEmail(h, scrapeConfig.emailDomain))
      .find(Boolean);
    if (!email) continue; // self-validation: non-person pages drop out here
    // Prefer the profile's own heading so a colleague's district mentioned
    // elsewhere on the page (e.g. a sidebar link) can't be misattributed.
    const ownHeading = $$('h1.page-header__title').first().text();
    const district = (ownHeading.match(/District\s+([0-9])/) ?? $$.text().match(/District\s+([0-9])/) ?? [null, null])[1];
    people.push({
      name, title: 'County Commissioner',
      district: district ? `District ${district}` : null,
      email, phone: null, profileUrl,
    });
  }
  return people;
}
