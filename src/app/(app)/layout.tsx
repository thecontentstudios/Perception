import type { ReactNode } from 'react';
import { AppProvider } from '@/lib/store';
import { Shell } from '@/components/Shell';

/**
 * The signed-in application: navigation rail, brand switcher, workspace state.
 *
 * This used to be the *root* layout, which meant every route in the codebase
 * got it — including `/f/<slug>`, the signup form we host on behalf of a
 * customer and show to their customers. That page rendered with the admin
 * navigation and a dropdown listing every business in the workspace, on a
 * screen intended for a member of the public.
 *
 * A route group fixes it without changing a single URL: everything under
 * `(app)` gets the shell, and anything outside it — the hosted form, and any
 * public page added later — starts from the bare document.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
