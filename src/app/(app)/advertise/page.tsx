'use client';

import Link from 'next/link';
import { Collapsible } from '@/components/Collapsible';
import { useMemo, useState } from 'react';
import { BRANDS, useApp } from '@/lib/store';
import {
  GROUP_BLURB,
  GROUP_LABEL,
  humanWait,
  inGroup,
  outcomeSentence,
  peopleSentence,
  perDollar,
  routesFor,
  type Route,
  type RouteGroup,
} from '@/lib/routes';
import { money } from '@/lib/pricing';
import { CHANNEL_META } from '@/lib/channels';
import { CapabilityTable } from './CapabilityTable';

/**
 * The pathway: from "I want more customers" to something running.
 *
 * Everything needed to answer that question already existed in this codebase
 * — rates, reach, consent, connections, setup costs — in five files that had
 * never been introduced to each other. An owner could find out what an SMS
 * segment costs and, separately, that 308 of their contacts may be texted, and
 * nowhere could they find out that texting those 308 costs $3.39 and cannot
 * start for six days.
 *
 * The screen is deliberately not a funnel. There is no "get started" button
 * that hides the price until step four; every route shows its cost, its wait,
 * and what stands in the way, all at once, and any of them can be started
 * from where it sits. Easy does not mean fewer facts — it means the facts
 * arranged so the decision is obvious.
 */

const GROUPS: RouteGroup[] = ['owned', 'reach', 'intent'];

export default function AdvertisePage() {
  const { state } = useApp();
  const [brandId, setBrandId] = useState('all');
  const [budget, setBudget] = useState(210);
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const contacts = useMemo(
    () => (brandId === 'all' ? state.contacts : state.contacts.filter((c) => c.brandId === brandId)),
    [state.contacts, brandId]
  );
  const accounts = useMemo(
    () => (brandId === 'all' ? state.accounts : state.accounts.filter((a) => a.brandId === brandId || a.brandId === null)),
    [state.accounts, brandId]
  );

  // The industry decides which paid channels are worth anything, so the route
  // list is genuinely different for a landscaper and a software company. With
  // several businesses in view the fits are averaged, which is why picking one
  // above sharpens the ranking rather than just filtering it.
  const industries = useMemo(
    () => (brandId === 'all' ? BRANDS.map((b) => b.industry) : [BRANDS.find((b) => b.id === brandId)!.industry]),
    [brandId]
  );

  const routes = useMemo(
    () => routesFor({ contacts, accounts, industries, adBudgetCents: budget * 100 }),
    [contacts, accounts, industries, budget]
  );

  const readyNow = routes.filter((r) => r.readiness === 'ready');
  const best = inGroup(routes, 'owned').find((r) => r.readiness === 'ready') ?? readyNow[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ways to reach people</h1>
          <div className="sub">
            Every route from here to a customer, with what it costs, when it can start, and what is in the way. No
            route hides its price until you have committed to it.
          </div>
        </div>
        <div className="actions">
          <select className="select" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="all">All businesses</option>
            {BRANDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ------------------------------------------------------ the answer */}
      {best && (
        <div className="card headline-route">
          <div className="hr-tag">Start here</div>
          <div className="hr-body">
            <h2>{best.name}</h2>
            <p className="hr-what">{best.what}</p>
            <div className="hr-numbers">
              <span className="hr-cost">{outcomeSentence(best)}</span>
              <span className="hr-when">Can go out {humanWait(best.timeToFirstSendHours)}.</span>
            </div>
            <p className="hr-why">
              This is first because it is the cheapest way to reach a person who already chose to hear from you.
              Everything below it is either slower, more expensive, or aimed at strangers — all of which have their
              place, and none of which should come before the list you already have.
            </p>
          </div>
          <Link className="btn primary hr-go" href={hrefFor(best, brandId)}>
            {best.channel === 'email' || best.channel === 'sms' ? 'Write it' : 'Open it'}
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------- the budget */}
      <div className="card card-pad budget-strip">
        <label>
          <span>
            If you spent <b>{money(budget * 100)}</b> on ads
          </span>
          <input
            type="range"
            min={25}
            max={2000}
            step={25}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            aria-label="Ad budget to compare"
          />
        </label>
        <p>
          Every paid route below is priced at this figure, so they can be compared against each other — and against
          doing nothing, which is also a choice with a cost.
        </p>
      </div>

      {/* ------------------------------------------------------- the routes */}
      {GROUPS.map((group) => (
        <RouteGroupSection
          key={group}
          group={group}
          routes={inGroup(routes, group)}
          openRoute={openRoute}
          setOpenRoute={setOpenRoute}
          industryNamed={brandId !== 'all'}
          brandId={brandId}
        />
      ))}

      {/* -------------------------------------------------- what each can do */}
      <Collapsible
        id="advertise.matrix"
        title="What each one can actually do"
        defaultOpen={false}
        summary="the capability matrix — the useful cells are the ones that say no"
        className="route-group"
      >
        <div className="rg-head">
          <p>
            The useful cells here are the ones that say no. A link is not clickable in an Instagram caption; video
            does not play in Gmail; a picture in a text costs ten times a text. Each of those is a campaign somebody
            built before finding out.
          </p>
        </div>
        <CapabilityTable />
      </Collapsible>
    </div>
  );
}

function hrefFor(r: Route, brandId?: string): string {
  if (r.channel === 'email' || r.channel === 'sms') return '/send';
  if (r.id === 'organic') return '/post';
  // The recommendation lands in the planner already filled in — channel,
  // the platform's own budget floor, the brand for an audience seed. The
  // pathway used to advise a route and then abandon you at an empty form.
  const params = new URLSearchParams({ plan: r.channel });
  if (brandId && brandId !== 'all') params.set('brand', brandId);
  return `/spend?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// One group
// ---------------------------------------------------------------------------

/** Above this many, a group is a spreadsheet rather than a shortlist. */
const SHORTLIST = 4;

/**
 * A group of routes, shortlisted.
 *
 * The first version listed all eight paid channels at once, and eight rows
 * that each say "$210 for some number of views" is not a decision — it is a
 * price sheet with a scrollbar. What an owner needs is the handful worth
 * considering and an honest way to see the rest, so the tail is folded behind
 * a count rather than dropped: hiding options silently would be its own kind
 * of dishonesty.
 */
function RouteGroupSection({
  group,
  routes,
  brandId,
  openRoute,
  setOpenRoute,
  industryNamed,
}: {
  group: RouteGroup;
  routes: Route[];
  openRoute: string | null;
  setOpenRoute: (id: string | null) => void;
  industryNamed: boolean;
  brandId?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  if (routes.length === 0) return null;
  const visible = showAll ? routes : routes.slice(0, SHORTLIST);
  const hidden = routes.length - visible.length;

  return (
    <Collapsible
      id={`advertise.${group}`}
      title={GROUP_LABEL[group]}
      defaultOpen
      summary={`${routes.length} ${routes.length === 1 ? 'route' : 'routes'}, best fit first`}
      className="route-group"
    >
      <div className="rg-head">
        <p>{GROUP_BLURB[group]}</p>
        {group !== 'owned' && (
          <p className="rg-order">
            Ordered by fit first, price second — sorting on price alone puts whichever platform is selling views
            cheapest at the top, and cheap views of the wrong people are not cheap.
            {!industryNamed &&
              ' Fit here is averaged across every business in the workspace, which blunts it; pick one at the top of the page to see its own ranking.'}
          </p>
        )}
      </div>
      <div className="routes">
        {visible.map((r) => (
          <RouteCard
            key={r.id}
            route={r}
            open={openRoute === r.id}
            onToggle={() => setOpenRoute(openRoute === r.id ? null : r.id)}
            brandId={brandId}
          />
        ))}
      </div>
      {hidden > 0 && (
        <button className="btn rg-more" onClick={() => setShowAll(true)}>
          Show {hidden} more {hidden === 1 ? 'option' : 'options'} we think fit less well
        </button>
      )}
      {showAll && routes.length > SHORTLIST && (
        <button className="btn rg-more" onClick={() => setShowAll(false)}>
          Show fewer
        </button>
      )}
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// One route
// ---------------------------------------------------------------------------

const READY_LABEL: Record<Route['readiness'], string> = {
  ready: 'Ready now',
  almost: 'Nearly ready',
  setup: 'Needs setup',
  unavailable: 'Not available yet',
};

function RouteCard({ route, open, onToggle, brandId }: { route: Route; open: boolean; onToggle: () => void; brandId?: string }) {
  const meta = CHANNEL_META[route.channel];
  const outstanding = route.steps.filter((s) => !s.done);
  const people = peopleSentence(route);

  return (
    <article className={`route-card ${route.readiness}`}>
      <button className="rc-head" onClick={onToggle} aria-expanded={open}>
        <span className="rc-dot" style={{ background: meta?.color ?? 'var(--muted)' }} />
        <span className="rc-name">{route.name}</span>
        <span className={`rc-ready ${route.readiness}`}>{READY_LABEL[route.readiness]}</span>
        <span className="rc-cost">{outcomeSentence(route)}</span>
        <span className="rc-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      <div className="rc-line">
        {route.group !== 'owned' && (
          <span className={`rc-fit fit-${route.fit}`}>{route.fitLabel} fit</span>
        )}
        <span className="rc-per">{perDollar(route)}</span>
        <span className="rc-when">
          {route.readiness === 'unavailable' ? 'Cannot start yet' : `Starts ${humanWait(route.timeToFirstSendHours)}`}
        </span>
        {route.setupCents > 0 && <span className="rc-setup">{money(route.setupCents)} to set up first</span>}
      </div>

      {people && <p className="rc-people">{people}</p>}

      {open && (
        <div className="rc-detail">
          <p className="rc-what">{route.what}</p>
          {route.catch && <p className="rc-catch">{route.catch}</p>}

          {outstanding.length > 0 && (
            <>
              <div className="rc-steps-label">
                {outstanding.length} step{outstanding.length === 1 ? '' : 's'} before this can run
              </div>
              <ol className="rc-steps">
                {route.steps.map((s) => (
                  <li key={s.id} className={s.done ? 'done' : ''}>
                    <span className="st-tick" aria-hidden>
                      {s.done ? '✓' : '○'}
                    </span>
                    <div className="st-body">
                      <div className="st-top">
                        <span className="st-label">{s.label}</span>
                        <span className="st-meta">
                          {s.cents > 0 ? money(s.cents) : 'free'}
                          {s.waitHours >= 8 ? ` · ${humanWait(s.waitHours)}` : ''}
                        </span>
                      </div>
                      <div className="st-detail">{s.detail}</div>
                    </div>
                    {!s.done && (
                      <Link className="btn st-go" href={s.href}>
                        Do it
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}

          <Link className="btn primary rc-go" href={hrefFor(route, brandId)}>
            {route.readiness === 'ready'
              ? route.channel === 'email' || route.channel === 'sms'
                ? 'Write it'
                : 'Plan it'
              : 'Start setting it up'}
          </Link>
        </div>
      )}
    </article>
  );
}
