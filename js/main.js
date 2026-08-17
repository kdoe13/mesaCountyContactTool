import { EMAIL_RE } from '../scraper/validate.js';

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
    btn.id = `tab-${l.id}`;
    btn.setAttribute('role', 'tab');
    btn.tabIndex = -1;
    btn.dataset.id = l.id;
    btn.addEventListener('click', () => selectTab(l.id));
    btn.addEventListener('keydown', onTabKeydown);
    nav.append(btn);
  }
}

// Shared by click and keyboard navigation: activates immediately (so
// roving tabindex/focus state is synchronous) and persists the choice
// to the URL hash. The hashchange listener in init() no-ops on this
// hash update since state.active already matches by the time it fires.
function selectTab(id) {
  if (id === state.active) return;
  activate(id);
  location.hash = id;
}

function onTabKeydown(e) {
  const ids = state.locales.map(l => l.id);
  const currentIndex = ids.indexOf(state.active);
  let newIndex;
  switch (e.key) {
    case 'ArrowRight': newIndex = (currentIndex + 1) % ids.length; break;
    case 'ArrowLeft': newIndex = (currentIndex - 1 + ids.length) % ids.length; break;
    case 'Home': newIndex = 0; break;
    case 'End': newIndex = ids.length - 1; break;
    default: return; // Enter/Space are handled natively by the <button>
  }
  e.preventDefault();
  const newId = ids[newIndex];
  selectTab(newId);
  document.getElementById(`tab-${newId}`).focus();
}

function activate(id) {
  state.active = id;
  // The output panel is derived from state.selected for a single locale at
  // Generate time and never re-synced afterward. showOutput() stamps
  // out.dataset.locale with the locale it was built for; hide the panel
  // whenever the active locale doesn't match so it can never keep showing a
  // stale locale's recipients/mailto after the tab/panel/action-bar have
  // moved on — but preserve an in-progress draft when the user switches away
  // from and back to the SAME locale without regenerating.
  const out = document.getElementById('output');
  out.hidden = out.dataset.locale !== id;
  document.querySelectorAll('.tab').forEach(t => {
    const selected = t.dataset.id === id;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
  });
  document.getElementById('panel').setAttribute('aria-labelledby', `tab-${id}`);
  renderLocale(state.locales.find(l => l.id === id));
}

function peopleForBody(locale, body) {
  const { contacts } = state.dataById.get(locale.id);
  const scraped = body.scraped ? (contacts.bodies[body.id] ?? []) : [];
  const statics = (body.staticMembers ?? []).map(m => ({ district: null, phone: null, profileUrl: null, email: null, ...m }));
  return [...scraped, ...statics];
}

function emailFor(person, body) {
  return person.email ?? body.groupEmail ?? null;
}

// state.selected is keyed by *person* identity, not by email — several people
// (e.g. all seven Palisade trustees) can share one groupEmail address, and
// keying by email would make selecting one of them visually select all of
// them. A body id is included since person names are only unique within a
// body, not across a whole locale.
function personKey(body, person) {
  return `${body.id}:${person.name}`;
}

// Resolves the current person-identity selection down to the deduped set of
// addresses that will actually receive mail — the number a resident cares
// about ("N recipients selected") and the mailto's To list are both built
// from this, not from the raw count of selected cards.
function selectedEmails(locale) {
  const sel = state.selected.get(locale.id);
  const emails = new Set();
  for (const body of locale.bodies) {
    for (const person of peopleForBody(locale, body)) {
      if (sel.has(personKey(body, person))) {
        const email = emailFor(person, body);
        if (email) emails.add(email);
      }
    }
  }
  return emails;
}

// The output panel's dataset.locale identity (set by showOutput) is only
// honest as long as that locale's selection hasn't changed underneath it.
// Call this at every point a locale's selection actually mutates (not on
// mere re-renders/tab switches) so a stale draft — built from a selection
// that no longer matches — can never resurface, while an untouched draft
// still survives a same-locale tab round-trip.
function invalidateOutputFor(localeId) {
  const out = document.getElementById('output');
  if (out.dataset.locale === localeId) {
    out.hidden = true;
    delete out.dataset.locale;
  }
}

function renderLocale(locale) {
  const panel = document.getElementById('panel');
  // Selecting a card or a select-all button re-renders the whole panel
  // (innerHTML = ''), which would otherwise drop keyboard/AT focus to
  // <body>. Capture which control had focus (by a stable key, since the
  // old node is about to be discarded) and restore it on the rebuilt node.
  const focusKey = panel.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
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
    allBtn.dataset.focusKey = `select-all:${body.id}`;
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
      const keys = people.filter(p => emailFor(p, body)).map(p => personKey(body, p));
      const allIn = keys.every(k => sel.has(k));
      for (const k of keys) allIn ? sel.delete(k) : sel.add(k);
      invalidateOutputFor(locale.id);
      renderLocale(locale); updateActionBar();
    });
    panel.append(section);
  }
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
  renderFooter(locale);
  updateActionBar();
  if (focusKey) {
    const match = [...panel.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === focusKey);
    match?.focus();
  }
}

function syncSelectAll(locale, body, btn, people) {
  const sel = state.selected.get(locale.id);
  const selectable = people.filter(p => emailFor(p, body));
  const keys = selectable.map(p => personKey(body, p));
  btn.textContent = keys.length && keys.every(k => sel.has(k)) ? 'Clear all' : 'Select all';
}

function personCard(locale, body, person) {
  const email = emailFor(person, body);
  const key = personKey(body, person);
  const sel = state.selected.get(locale.id);
  const card = document.createElement(email ? 'button' : 'div');
  card.className = 'person-card';
  card.dataset.focusKey = `card:${body.id}:${person.name}`;
  const name = document.createElement('strong');
  name.textContent = person.name;
  const sub = document.createElement('small');
  sub.textContent = [person.title, person.district].filter(Boolean).join(' · ');
  card.append(name, sub);
  if (email) {
    card.type = 'button';
    card.setAttribute('aria-pressed', String(sel.has(key)));
    card.classList.toggle('selected', sel.has(key));
    card.addEventListener('click', () => {
      sel.has(key) ? sel.delete(key) : sel.add(key);
      invalidateOutputFor(locale.id);
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
  const activeLocale = state.locales.find(l => l.id === state.active);
  const count = activeLocale ? selectedEmails(activeLocale).size : 0;
  bar.hidden = count === 0;
  if (count === 0) {
    // A selection dropping to zero is itself a selection change, so if the
    // output panel's draft belongs to *this* locale, it's now stale and
    // must not resurface on a later same-locale tab round-trip. Route
    // through invalidateOutputFor rather than unconditionally touching
    // out.dataset.locale here: state.active's count can be zero simply
    // because it's a different, untouched locale being freshly rendered
    // (e.g. switching to a locale nobody has selected anything in yet),
    // in which case the panel may still be showing a valid, unrelated
    // locale's in-progress draft that must be left alone.
    invalidateOutputFor(state.active);
    return;
  }
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
    invalidateOutputFor(state.active);
    renderLocale(state.locales.find(l => l.id === state.active));
  });
  bar.append(label, go, clear);
}

function showOutput() {
  const locale = state.locales.find(l => l.id === state.active);
  const { content } = state.dataById.get(locale.id);
  const out = document.getElementById('output');
  out.hidden = false;
  out.dataset.locale = locale.id;
  out.innerHTML = '';

  const templates = content.templates.length
    ? content.templates
    : [{ title: 'Blank', subject: '', message: '' }];

  const pick = document.createElement('select');
  pick.id = 'template';
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
  salName.id = 'sal-name';
  salName.placeholder = 'Optional';
  let salDistrict = null;
  if (locale.districts) {
    salDistrict = document.createElement('select');
    salDistrict.id = 'sal-district';
    const none = document.createElement('option');
    none.value = ''; none.textContent = `${locale.districts.label} (optional)`;
    salDistrict.append(none);
    for (const d of locale.districts.options) {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      salDistrict.append(opt);
    }
  }

  const salutation = () => {
    const parts = [];
    if (salName.value.trim()) parts.push(salName.value.trim());
    if (salDistrict?.value) parts.push(`${salDistrict.value} resident`);
    return parts.length ? `\n\nSincerely,\n${parts.join('\n')}` : '';
  };

  // Tracks the salutation text last spliced onto the end of the message, so
  // a name/district edit can replace just that tail instead of the whole
  // field. Rebuilding subject+message wholesale on every keystroke (the
  // previous behavior) discarded anything the resident had typed — and
  // clobbered the native undo stack, since it's a programmatic .value write.
  let lastSalutation = '';

  // Template picker only: full rebuild of both fields from the template.
  const applyTemplate = () => {
    const t = templates[Number(pick.value)];
    subject.value = t.subject;
    lastSalutation = salutation();
    message.value = t.message + lastSalutation;
    refreshSend();
  };

  // Salutation fields only: never touch subject.value. Replace just the
  // previously-applied salutation tail if it's still there (untouched by the
  // resident); otherwise append the new salutation rather than overwriting
  // whatever they've typed.
  const applySalutation = () => {
    const next = salutation();
    message.value = message.value.endsWith(lastSalutation)
      ? message.value.slice(0, message.value.length - lastSalutation.length) + next
      : message.value + next;
    lastSalutation = next;
    refreshSend();
  };

  const send = document.createElement('a');
  send.className = 'send-btn';
  send.textContent = 'Open in your email app';
  const notice = document.createElement('p');
  notice.className = 'length-notice'; notice.hidden = true;
  notice.textContent = 'This message is long — some email apps cut off long links. Use the copy buttons below instead.';

  const emails = [...selectedEmails(locale)];
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
    copyRow('Subject', () => subject.value, subject),
    copyRow('Message', () => message.value, message));

  pick.addEventListener('change', applyTemplate);
  salName.addEventListener('input', applySalutation);
  salDistrict?.addEventListener('change', applySalutation);
  subject.addEventListener('input', refreshSend);
  message.addEventListener('input', refreshSend);

  const salFields = document.createElement('div');
  salFields.className = 'salutation-fields';
  salFields.append(labeledField('Your name', salName));
  if (salDistrict) salFields.append(labeledField(locale.districts.label, salDistrict));

  const salWrap = document.createElement('div');
  salWrap.className = 'salutation';
  salWrap.append(salFields);
  if (locale.districts) {
    const mapLink = document.createElement('a');
    mapLink.href = locale.districts.mapUrl;
    mapLink.target = '_blank'; mapLink.rel = 'noopener';
    mapLink.textContent = 'Find your district';
    salWrap.append(mapLink);
  }

  out.append(
    labeledField('Message template', pick),
    salWrap,
    labeledField('Subject', subject),
    labeledField('Message', message),
    send, notice, manual);
  applyTemplate();
  out.scrollIntoView({ behavior: 'smooth' });
  // Move focus into the newly revealed panel for keyboard/AT users, without
  // fighting the smooth scroll above (scrollIntoView already handles that).
  subject.focus({ preventScroll: true });
}

// Wraps a form control with a visible, persistent <label> (rather than
// relying on placeholder text, which disappears once a value is typed and
// is not a reliable accessible name).
function labeledField(text, control) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = text;
  wrap.append(label, control);
  return wrap;
}

function buildMailto(emails, subject, body) {
  // Recipients are joined as literal addresses (not percent-encoded) since
  // that's the form real mail clients expect in a mailto To list — some
  // clients mishandle a percent-encoded "@". Shape-validate with the same
  // EMAIL_RE the scraper enforces (imported, not redefined) so a malformed
  // address can't smuggle a comma/space and corrupt the list.
  const to = emails
    .map(e => e.trim())
    .filter(e => EMAIL_RE.test(e))
    .join(',');
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function copyRow(label, getValue, el) {
  const row = document.createElement('div');
  row.className = 'copy-row';
  const span = document.createElement('span');
  span.textContent = label;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.textContent = `Copy ${label.toLowerCase()}`;
  const reset = () => { btn.textContent = `Copy ${label.toLowerCase()}`; };
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getValue());
      btn.textContent = 'Copied ✓';
      setTimeout(reset, 1500);
    } catch {
      btn.textContent = 'Copy failed — select and copy manually';
      el?.focus();
      el?.select();
      setTimeout(reset, 3000);
    }
  });
  row.append(span, btn);
  return row;
}

function renderFooter(locale) {
  const { contacts } = state.dataById.get(locale.id);
  const el = document.getElementById('footer');
  el.textContent = contacts.scrapedAt
    ? `Contacts last updated ${new Date(contacts.scrapedAt).toLocaleDateString()}`
    : '';
}

init().catch(err => {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';
  const message = document.createElement('p');
  message.textContent = `Failed to load data: ${err.message}`;
  panel.append(message);
  // Reuse the same official-directory links the <noscript> fallback offers,
  // rather than leaving a resident with nothing when data fails to load.
  const links = document.getElementById('official-links');
  if (links) panel.append(links.cloneNode(true));
});
