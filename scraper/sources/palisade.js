import * as cheerio from 'cheerio';

const clean = s => s.replace(/[\s ]+/g, ' ').trim();
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
