import type { ChannelVariation, MediaAsset, PreflightWarning } from '../types';
import { simulatedOperations, warning, type ConnectorAdapter } from './contract';

/**
 * Email rides on an established delivery provider (Amazon SES, Postmark,
 * SendGrid, or Mailgun) — Perception does not run its own mail
 * infrastructure. CAN-SPAM requirements (accurate sender, postal address,
 * working opt-out, suppression of unsubscribed contacts) are enforced here in
 * validation and again in the sending pipeline.
 */
export const emailAdapter: ConnectorAdapter = {
  capabilities: {
    channel: 'email',
    api: 'Delivery provider (SES / Postmark / SendGrid / Mailgun)',
    availability: 'mvp',
    formats: ['email'],
    allowedRatios: null,
    maxVideoSec: null,
    maxChars: null,
    maxHashtags: null,
    supportsNativeScheduling: true,
    supportsEdit: false,
    supportsDelete: false,
    supportsMetrics: true,
    supportsInboxEvents: true,
    reviewNotes:
      'Sender domain must pass SPF, DKIM, and DMARC before campaigns can send; unsubscribes are suppressed automatically at send time.',
  },

  validate(variation: ChannelVariation, _assets: MediaAsset[]): PreflightWarning[] {
    const out: PreflightWarning[] = [];

    if (!variation.subject || variation.subject.trim() === '') {
      out.push(
        warning('email-no-subject', 'block', 'This email has no subject line.', 'Add a subject in the email editor.')
      );
    } else if (variation.subject.length > 60) {
      out.push(
        warning(
          'email-subject-long',
          'info',
          `Subjects over 60 characters get cut off on phones (this one is ${variation.subject.length}).`,
          'Front-load the offer in the first 40 characters.'
        )
      );
    }

    if (!variation.hasUnsubscribeFooter) {
      out.push(
        warning(
          'email-no-unsub',
          'block',
          'This email has no unsubscribe footer.',
          'Add the footer block — commercial email requires a working opt-out and your postal address (CAN-SPAM).'
        )
      );
    }

    if (!variation.preheader) {
      out.push(
        warning(
          'email-no-preheader',
          'info',
          'No preview text set — inboxes will show the first line of the email instead.',
          'Add preview text in the email editor.'
        )
      );
    }

    return out;
  },

  ...simulatedOperations('email'),
};
