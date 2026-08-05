import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppProvider } from '@/lib/store';
import { Shell } from '@/components/Shell';

/**
 * Rendered per request, not prebuilt.
 *
 * Two reasons, and the second is the one that forced it.
 *
 * The obvious one: every page here shows one customer's workspace. A
 * statically generated shell that a CDN can cache is the wrong shape for that,
 * even though the data arrives by fetch — it invites a cache in front of the
 * app that does not know about sessions.
 *
 * The one that actually broke: **Next can only stamp a CSP nonce onto a page
 * it renders per request.** A prebuilt page has no nonce, so its inline
 * bootstrap scripts were refused and the app never hydrated. The alternative
 * was `'unsafe-inline'`, which is the same as having no script policy at all.
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
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
