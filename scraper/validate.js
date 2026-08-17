// The single strict address rule for this project. Deliberately narrow: it
// admits no whitespace, comma, `?`, `&`, `;` or second `@`, so any address that
// clears it cannot smuggle extra headers into the `mailto:` To-list the
// frontend builds from this data. js/main.js imports EMAIL_RE from here so
// there is exactly one definition — keep this module dependency-free (no
// node: imports) so it stays loadable in the browser.
export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// Returns null when `email` is usable, else a human-readable reason.
// Enforces the project-wide "emails are stored lowercased" rule rather than
// trusting each source module to have remembered it, and — when a domain is
// given — that the address belongs to that government.
export function emailProblem(email, emailDomain) {
  if (typeof email !== 'string' || email === '') return 'is empty or not a string';
  if (email !== email.trim().toLowerCase()) return `"${email}" is not trimmed and lowercased`;
  if (!EMAIL_RE.test(email)) return `"${email}" is not a valid email address`;
  if (emailDomain && !email.endsWith(`@${emailDomain.toLowerCase()}`)) {
    return `"${email}" is not on expected domain ${emailDomain}`;
  }
  return null;
}

// Shared by every source module so all four apply one policy to a scraped
// `mailto:` href: drop the scheme and any prefilled `?subject=`/`?cc=` tail,
// lowercase, and keep the address only if it passes the rule above (including
// the locale's domain when one is given). Returns null otherwise, so a
// wrapped, prefilled or off-domain mailto never reaches the data files.
export function mailtoEmail(href, emailDomain) {
  const raw = String(href ?? '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
  return emailProblem(raw, emailDomain) ? null : raw;
}

export function validateContacts(localeConfig, people) {
  const errors = [];
  const body = localeConfig.bodies.find(b => b.scraped);

  if (!body) {
    return [`${localeConfig.id}: no body with scraped:true in config`];
  }

  const label = `${localeConfig.id}/${body.id}`;

  if (people.length !== body.expectedCount) {
    errors.push(`${label}: expected ${body.expectedCount} members, got ${people.length}`);
  }

  // Check for duplicate emails (ignoring nulls)
  const emailsSeen = new Set();
  const namesSeen = new Set();

  for (const p of people) {
    const who = p.name?.trim() || '(unnamed)';
    if (!p.name?.trim()) errors.push(`${label}: member with blank name`);

    // Check for duplicate names
    const trimmedName = p.name?.trim().toLowerCase();
    if (trimmedName && namesSeen.has(trimmedName)) {
      errors.push(`${label}: duplicate name "${p.name.trim()}"`);
    }
    if (trimmedName) namesSeen.add(trimmedName);

    if (p.email == null) {
      // Spec: an official whose email isn't published is still listed and
      // renders with their profile link instead of a selectable card. That
      // only works if we know somewhere to send the resident — a body-wide
      // shared address or the person's own page. With neither, the roster
      // really is unusable and the locale must fail rather than go live.
      if (!body.groupEmail && !p.profileUrl) {
        errors.push(`${label}: ${who} has no email, no profileUrl, and body has no groupEmail`);
      }
    } else {
      const dupKey = String(p.email).trim().toLowerCase();
      if (emailsSeen.has(dupKey)) errors.push(`${label}: duplicate email "${dupKey}"`);
      emailsSeen.add(dupKey);

      const problem = emailProblem(p.email, localeConfig.emailDomain);
      if (problem) errors.push(`${label}: ${who} email ${problem}`);
    }
  }
  return errors;
}
