import * as cheerio from 'cheerio';
import { mailtoEmail } from '../validate.js';

const clean = s => s.replace(/\s+/g, ' ').trim();
// CivicPlus profile links: /<digits>/<Hyphenated-Name>, absolute or relative.
const PROFILE = /^(?:https?:\/\/(?:www\.)?gjcity\.org)?\/\d+\/[A-Za-z][A-Za-z-]+$/;
// The site reuses this same page-link shape for lots of non-member links (nav items,
// "Agendas & Minutes", "City Council Meetings", etc). We only treat a block as a member
// if its own heading doesn't look like one of those.
const NOT_NAMES = /contact|biography|email|agenda|minute|council|city|charter|form|overview|loading/i;

export async function scrape(fetchHtml, scrapeConfig) {
  const listUrl = scrapeConfig.urls.list;
  const $ = cheerio.load(await fetchHtml(listUrl));
  const people = [];

  // Each council member is rendered as its own `.fr-view` block: a name heading,
  // an optional title heading, a district heading, then one or two links (name +
  // "Contact & Biography") pointing at the same profile page.
  $('.fr-view').each((_, block) => {
    const $block = $(block);
    const headings = $block.find('h2').map((_, h) => clean($(h).text())).get();
    if (headings.length === 0) return;

    const name = headings[0].replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (name.split(' ').length < 2 || NOT_NAMES.test(name)) return;

    const profileHref = $block.find('a[href]').map((_, a) => $(a).attr('href')).get()
      .find(href => PROFILE.test(href));
    if (!profileHref) return;

    const headingText = headings.join(' ');
    let title = 'Council Member';
    if (/president pro tem/i.test(headingText)) title = 'Council President Pro Tem';
    else if (/president/i.test(headingText)) title = 'Council President';

    const districtMatch = headingText.match(/District\s+[A-Za-z-]+/i);
    const district = districtMatch ? districtMatch[0].replace(/district/i, 'District') : null;

    people.push({
      name,
      title,
      district,
      email: null,
      phone: null,
      profileUrl: new URL(profileHref, listUrl).href,
    });
  });

  // The expected domain comes from config (scrape.js passes locale.emailDomain
  // through) so all four source modules share one policy rather than each
  // hardcoding its own copy of the domain.
  for (const p of people) {
    const $$ = cheerio.load(await fetchHtml(p.profileUrl));
    p.email = $$('a[href^="mailto:"]').map((_, a) => $$(a).attr('href')).get()
      .map(h => mailtoEmail(h, scrapeConfig.emailDomain))
      .find(Boolean) ?? null;
  }

  return people;
}
