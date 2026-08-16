import * as cheerio from 'cheerio';
import { mailtoEmail } from '../validate.js';

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
      email: mailtoEmail(mailto, scrapeConfig.emailDomain),
      phone: clean($el.find('.p-tel a').text()) || null,
      profileUrl: null,
    });
  });
  return people;
}
