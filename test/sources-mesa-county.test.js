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

const cfg = { emailDomain: 'mesacounty.us', urls: {
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

test('mesa-county: drops candidate pages with no @mesacounty.us mailto (self-validation), never re-fetches excluded slugs', async () => {
  // A list page with one extra commissioner-shaped link that is NOT in
  // excludeSlugs and whose own profile page carries no @mesacounty.us mailto
  // -- the realistic case: a future section page the config doesn't know
  // about yet, which the self-validation filter (not excludeSlugs) must drop.
  const listWithExtra = `<html><body><ul class="image-page-header__menu">
    <li><a href="/departments-and-services/commissioners/bobbie-daniel">Bobbie Daniel</a></li>
    <li><a href="/departments-and-services/commissioners/business-commissioners">Business of the Commissioners</a></li>
    <li><a href="/departments-and-services/commissioners/cody-davis">Cody Davis</a></li>
    <li><a href="/departments-and-services/commissioners/connect-us">Connect with Us</a></li>
    <li><a href="/departments-and-services/commissioners/JJ-Fletcher">JJ Fletcher</a></li>
    <li><a href="/departments-and-services/commissioners/volunteer-opportunities">Volunteer Opportunities</a></li>
    <li><a href="/departments-and-services/commissioners/new-commissioner-summit">New Commissioner Summit</a></li>
  </ul></body></html>`;

  const fetchedUrls = [];
  const fetchWithLog = async (url) => {
    fetchedUrls.push(url);
    if (url.endsWith('/commissioners')) return listWithExtra;
    if (url.includes('cody-davis')) return davis;
    if (url.includes('new-commissioner-summit')) {
      // No mailto anywhere on this page -- must be dropped by self-validation.
      return '<html><body><h1>New Commissioner Summit</h1><p>Details about the annual summit event.</p></body></html>';
    }
    const slug = url.split('/').pop().toLowerCase().replace(/-/g, '.');
    return `<html><body><p>District 2</p><p>Email: <a href="mailto:${slug}@mesacounty.us">${slug}</a></p></body></html>`;
  };

  const people = await scrape(fetchWithLog, cfg);
  assert.equal(people.length, 3);
  assert.ok(!people.some(p => /Summit/i.test(p.name)), 'no-mailto candidate must be dropped');
  for (const slug of ['business-commissioners', 'connect-us', 'volunteer-opportunities']) {
    assert.ok(!fetchedUrls.some(u => u.includes(slug)), `excludeSlugs entry "${slug}" should never be fetched`);
  }
});

test('mesa-county: district comes from the profile\'s own heading, not a colleague mentioned on the page', async () => {
  // Davis's real profile fixture links Bobbie Daniel and JJ Fletcher in a
  // sidebar. If a "District N" label ever sits near a colleague's name
  // there, whole-page scanning could misattribute -- scoping to the page's
  // own h1.page-header__title guards against that.
  // Colleague mention deliberately comes BEFORE the profile's own heading in
  // document order, so an unscoped whole-page-text scan would wrongly grab
  // "District 2" here; only heading-first scoping yields the correct District 3.
  const html = `<html><body>
    <aside><a href="/departments-and-services/commissioners/other-person">Other Person, District 2</a></aside>
    <h1 class="page-header__title h1"><span>Pat Rivera, Mesa County Commissioner for District 3</span></h1>
    <p>Email: <a href="mailto:pat.rivera@mesacounty.us">Pat Rivera</a></p>
  </body></html>`;
  const fetchOwnHeading = async (url) => {
    if (url.endsWith('/commissioners')) {
      return '<html><body><ul class="image-page-header__menu"><li><a href="/departments-and-services/commissioners/pat-rivera">Pat Rivera</a></li></ul></body></html>';
    }
    return html;
  };
  const people = await scrape(fetchOwnHeading, cfg);
  assert.equal(people.length, 1);
  assert.equal(people[0].district, 'District 3');
});
