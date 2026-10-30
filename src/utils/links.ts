/**
 * Web links in notes. Shared by the app and the editor page, so it must not import anything app-specific.
 */

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** Schemes that would run code or load inside the editor page instead of opening outside. */
const BLOCKED = new Set(['javascript', 'vbscript', 'data', 'file', 'about', 'blob']);

/** Text that is itself an address, the way GFM autolinks it: `https://…`, `www.…` or an email. */
const URL_TEXT = /^(?:https?:\/\/|www\.)\S+$/i;
const EMAIL_TEXT = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;

export const looksLikeAddress = (text: string) => URL_TEXT.test(text) || EMAIL_TEXT.test(text);

/** The address a link's own text points to: `www.x.com` → `https://www.x.com`. */
export function hrefForText(text: string): string {
  if (SCHEME.test(text)) return text;
  return EMAIL_TEXT.test(text) ? `mailto:${text}` : `https://${text}`;
}

/** A link written as a bare address: its text is where it goes, so the file can keep the plain text. */
export function isBareLink(text: string, href: string): boolean {
  if (!looksLikeAddress(text)) return false;
  return href === text || href === `https://${text}` || href === `http://${text}` || href === `mailto:${text}`;
}

/** Where tapping the link should go, or null when it is not something to open outside the app. */
export function openableUrl(href: string | null | undefined): string | null {
  const h = (href ?? '').trim();
  if (!h) return null;
  const m = SCHEME.exec(h);
  if (m) return BLOCKED.has(m[1].toLowerCase()) ? null : h;
  // Relative links (other notes, attachments) stay inside the app.
  return /^www\./i.test(h) ? `https://${h}` : null;
}

/** Short label for the link: the site, or the email address. */
export function linkLabel(url: string): string {
  const mail = /^mailto:([^?]+)/i.exec(url);
  if (mail) return mail[1];
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return (host ? host[1] : url).replace(/^www\./i, '');
}
