import { fillMergeFields } from '../sms';

/**
 * Turning one composed message into the one person receives.
 *
 * Two jobs, both of which are easy to get wrong in ways that only show up in
 * somebody else's inbox:
 *
 * 1. **Merge fields**, filled from the contact rather than left as
 *    `{{name}}` — the classic failure being the campaign that greets four
 *    hundred people as "Hi {{name}}".
 * 2. **HTML**, generated from the same plain text rather than composed
 *    separately. A multipart email whose two halves say different things is
 *    the reason "click here for the offer" reaches people with no offer in it.
 */

export interface Recipient {
  name: string;
  email: string;
  /** Used for the tracked link and the unsubscribe URL. */
  deliveryId: string;
}

export interface RenderContext {
  businessName: string;
  /** Absolute, because an email has no origin to resolve a relative link. */
  unsubscribeBase: string;
  linkUrl?: string;
}

export interface Rendered {
  text: string;
  html: string;
  unsubscribeUrl: string;
}

/** Tokens we know how to fill. Anything else is a typo. */
const KNOWN = new Set(['name', 'full_name', 'business', 'link']);

/**
 * Strip tokens nothing can fill.
 *
 * `fillMergeFields` leaves an unknown token in place, which is exactly right
 * in the composer — a writer who types `{{naem}}` should see that it is not a
 * real field. It is exactly wrong here, because at this point the audience is
 * the one who would see it, and "Hi {{naem}}," in a customer's inbox is worse
 * than a missing word.
 *
 * So the render strips them, and the composer keeps showing them. The two
 * behaviours look inconsistent and are not: the difference is who is reading.
 */
function stripUnknownTokens(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (KNOWN.has(key) ? whole : ''));
}

/**
 * A merge field with no value becomes nothing, not the token.
 *
 * Known fields are always supplied, even when empty, so a contact with no
 * name gets a clean greeting rather than a placeholder.
 */
export function renderEmail(
  batch: { subject: string | null; body: string },
  to: Recipient,
  ctx: RenderContext
): Rendered {
  const first = to.name.trim().split(/\s+/)[0] ?? '';
  const unsubscribeUrl = `${ctx.unsubscribeBase.replace(/\/+$/, '')}/u/${to.deliveryId}`;

  const text = fillMergeFields(stripUnknownTokens(batch.body), {
    name: first,
    full_name: to.name,
    business: ctx.businessName,
    link: ctx.linkUrl ?? '',
  });

  return {
    text: `${text}\n\n—\nYou are receiving this because you subscribed to updates from ${ctx.businessName}.\nUnsubscribe: ${unsubscribeUrl}`,
    html: toHtml(text, ctx.businessName, unsubscribeUrl),
    unsubscribeUrl,
  };
}

/** Fill the subject the same way, so personalisation reaches the inbox line. */
export function renderSubject(subject: string | null, to: Recipient, ctx: RenderContext): string {
  const first = to.name.trim().split(/\s+/)[0] ?? '';
  return fillMergeFields(stripUnknownTokens(subject ?? ''), {
    name: first,
    full_name: to.name,
    business: ctx.businessName,
    link: ctx.linkUrl ?? '',
  });
}

/**
 * The text of a message as it will actually leave.
 *
 * SMS went out as `batch.body` verbatim for one release: merge fields
 * unfilled, so recipients would have been greeted as `Hi {{name}}`, and
 * without the opt-out line — which is required by carriers and, worse, was
 * *already included in the price*. The composer counted segments with
 * "Reply STOP to opt out." appended and the dispatcher sent the message
 * without it, so we charged for three segments and delivered two.
 *
 * The segment-count reconciliation added in the same phase is what found it:
 * our number and the carrier's disagreed on the first message containing an
 * emoji, and the disagreement was this.
 */
export function renderSms(batch: { body: string }, to: Recipient, ctx: RenderContext): string {
  const first = to.name.trim().split(/\s+/)[0] ?? '';
  return fillMergeFields(stripUnknownTokens(batch.body), {
    name: first,
    full_name: to.name,
    business: ctx.businessName,
    link: ctx.linkUrl ?? '',
  });
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escaped before anything else touches it — a contact name is user input. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Plain text to a paragraphed HTML email.
 *
 * Deliberately plain: inline styles only, a table-free single column, no web
 * fonts, no external stylesheet. Every one of those is a thing an email client
 * strips or mangles, and the mangling is invisible until a customer forwards a
 * screenshot. The unsubscribe link is in the body as well as the header
 * because the header version is not visible to a human.
 */
function toHtml(text: string, business: string, unsubscribeUrl: string): string {
  const paragraphs = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.55">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n      ');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px">
      ${paragraphs}
      <hr style="border:none;border-top:1px solid #e6e6e2;margin:24px 0 14px">
      <p style="margin:0;font-size:12px;color:#767672;line-height:1.5">
        You are receiving this because you subscribed to updates from ${escapeHtml(business)}.<br>
        <a href="${unsubscribeUrl}" style="color:#767672">Unsubscribe</a>
      </p>
    </div>
  </body>
</html>`;
}
