import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * The bare document. Deliberately holds nothing but the shell of a page.
 *
 * Rendered per request, not prebuilt, for two reasons and the second is the
 * one that forced it.
 *
 * The obvious one: most pages here show one customer's workspace. A statically
 * generated shell that a CDN can cache is the wrong shape for that, even
 * though the data arrives by fetch — it invites a cache in front of the app
 * that does not know about sessions.
 *
 * The one that actually broke: **Next can only stamp a CSP nonce onto a page
 * it renders per request.** A prebuilt page has no nonce, so its inline
 * bootstrap scripts were refused and the app never hydrated. The alternative
 * was `'unsafe-inline'`, which is the same as having no script policy at all.
 *
 * The navigation and workspace state live in `(app)/layout.tsx` rather than
 * here, so that public pages — the hosted signup form, and whatever else gets
 * shown to somebody else's customers — do not inherit an admin interface.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Perception — Campaign Operating System',
  description:
    'One campaign, everywhere your customers are. Plan social posts, email, and website promotions from one simple calendar.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
