'use client';

import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import {
  ACCOUNTS, APPROVALS, AUDIT, BRANDS, CAMPAIGNS, CONTACTS, CONTENT_ITEMS,
  CONVERSATIONS, MEDIA, ORG, PERFORMANCE, SEGMENTS, TEMPLATES, TODAY, USERS, VARIATIONS,
} from './demo-data';
import { preflight, type PreflightContext } from './preflight';
import { dateKeyOf } from './dates';
import type {
  Approval, AuditEvent, Brand, Campaign, CampaignPerformance, ChannelVariation,
  ConnectedAccount, Contact, ContentItem, Conversation, MediaAsset,
  PreflightWarning, VariationStatus,
} from './types';

export interface AppState {
  campaigns: Campaign[];
  items: ContentItem[];
  variations: ChannelVariation[];
  media: MediaAsset[];
  accounts: ConnectedAccount[];
  conversations: Conversation[];
  contacts: Contact[];
  approvals: Approval[];
  audit: AuditEvent[];
  /** brand filter applied across the app; 'all' shows the whole workspace */
  activeBrandId: string;
}

type Action =
  | { type: 'reschedule'; variationId: string; dateKey: string }
  | { type: 'setScheduledAt'; variationId: string; scheduledAt: string | null }
  | { type: 'setStatus'; variationId: string; status: VariationStatus }
  | { type: 'bulkSetStatus'; variationIds: string[]; status: VariationStatus }
  | { type: 'updateVariation'; variationId: string; patch: Partial<ChannelVariation> }
  | { type: 'retryFailed'; variationId: string }
  | { type: 'reconnect'; accountId: string }
  | { type: 'setAltText'; mediaId: string; altText: string }
  | { type: 'conversationStatus'; conversationId: string; status: Conversation['status'] }
  | { type: 'setBrand'; brandId: string }
  | { type: 'duplicateVariation'; variationId: string }
  | { type: 'addCampaign'; campaign: Campaign; items: ContentItem[]; variations: ChannelVariation[]; auditDetail: string };

let dupSeq = 1;

let auditSeq = 100;
function audit(action: string, target: string, detail: string): AuditEvent {
  return { id: `ae-x${auditSeq++}`, at: `${TODAY}T09:45`, actorUserId: 'u-dana', action, target, detail };
}

function reducer(state: AppState, a: Action): AppState {
  switch (a.type) {
    case 'reschedule': {
      return {
        ...state,
        variations: state.variations.map((v) => {
          if (v.id !== a.variationId) return v;
          const time = v.scheduledAt ? v.scheduledAt.slice(10) : 'T12:00';
          const status = v.status === 'idea' ? 'draft' : v.status;
          return { ...v, scheduledAt: `${a.dateKey}${time}`, status };
        }),
      };
    }
    case 'setScheduledAt':
      return {
        ...state,
        variations: state.variations.map((v) =>
          v.id === a.variationId ? { ...v, scheduledAt: a.scheduledAt } : v
        ),
      };
    case 'setStatus':
      return {
        ...state,
        variations: state.variations.map((v) => (v.id === a.variationId ? { ...v, status: a.status } : v)),
        approvals:
          a.status === 'approved'
            ? state.approvals.map((ap) =>
                ap.variationId === a.variationId && ap.decision === 'pending'
                  ? { ...ap, decision: 'approved', decidedAt: `${TODAY}T09:45` }
                  : ap
              )
            : state.approvals,
      };
    case 'bulkSetStatus':
      return {
        ...state,
        variations: state.variations.map((v) =>
          a.variationIds.includes(v.id) ? { ...v, status: a.status } : v
        ),
      };
    case 'updateVariation':
      return {
        ...state,
        variations: state.variations.map((v) =>
          v.id === a.variationId ? { ...v, ...a.patch, overridden: true } : v
        ),
      };
    case 'retryFailed': {
      const v = state.variations.find((x) => x.id === a.variationId);
      if (!v) return state;
      const account = state.accounts.find((acc) => acc.channel === v.channel);
      const healthy = account && account.status === 'connected';
      return {
        ...state,
        variations: state.variations.map((x) => {
          if (x.id !== a.variationId) return x;
          if (healthy) {
            return { ...x, status: 'published', publishedAt: `${TODAY}T09:45`, failure: null };
          }
          return {
            ...x,
            failure: x.failure && {
              ...x.failure,
              attempts: x.failure.attempts + 1,
              lastTriedAt: `${TODAY}T09:45`,
            },
          };
        }),
        audit: [
          audit(
            healthy ? 'publish.succeeded' : 'publish.failed',
            v.id,
            healthy ? 'Manual retry succeeded after reconnection.' : 'Manual retry failed — connection still expired.'
          ),
          ...state.audit,
        ],
      };
    }
    case 'reconnect':
      return {
        ...state,
        accounts: state.accounts.map((acc) =>
          acc.id === a.accountId
            ? { ...acc, status: 'connected', expiresAt: '2026-12-06', lastSyncAt: `${TODAY}T09:45` }
            : acc
        ),
        audit: [audit('connection.restored', a.accountId, 'Reconnected by Dana Reyes.'), ...state.audit],
      };
    case 'setAltText':
      return {
        ...state,
        media: state.media.map((m) => (m.id === a.mediaId ? { ...m, altText: a.altText } : m)),
      };
    case 'conversationStatus':
      return {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === a.conversationId ? { ...c, status: a.status } : c
        ),
      };
    case 'setBrand':
      return { ...state, activeBrandId: a.brandId };
    case 'duplicateVariation': {
      const src = state.variations.find((v) => v.id === a.variationId);
      if (!src) return state;
      const copy: ChannelVariation = {
        ...src,
        id: `${src.id}-copy${dupSeq++}`,
        status: 'draft',
        publishedAt: null,
        failure: null,
        scheduledAt: src.scheduledAt ? `${dateKeyOf(src.scheduledAt) < TODAY ? TODAY : dateKeyOf(src.scheduledAt)}${src.scheduledAt.slice(10)}` : null,
      };
      return { ...state, variations: [...state.variations, copy] };
    }
    case 'addCampaign':
      return {
        ...state,
        campaigns: [a.campaign, ...state.campaigns],
        items: [...state.items, ...a.items],
        variations: [...state.variations, ...a.variations],
        audit: [audit('campaign.created', a.campaign.name, a.auditDetail), ...state.audit],
      };
  }
}

const initialState: AppState = {
  campaigns: CAMPAIGNS,
  items: CONTENT_ITEMS,
  variations: VARIATIONS,
  media: MEDIA,
  accounts: ACCOUNTS,
  conversations: CONVERSATIONS,
  contacts: CONTACTS,
  approvals: APPROVALS,
  audit: AUDIT,
  activeBrandId: 'all',
};

export interface AppApi {
  state: AppState;
  dispatch: (a: Action) => void;
  // lookups
  campaignById: (id: string) => Campaign | undefined;
  brandById: (id: string) => Brand | undefined;
  itemById: (id: string) => ContentItem | undefined;
  assetsFor: (v: ChannelVariation) => MediaAsset[];
  performanceFor: (campaignId: string) => CampaignPerformance | undefined;
  /** variations visible under the active brand filter */
  visibleVariations: ChannelVariation[];
  visibleCampaigns: Campaign[];
  preflightFor: (v: ChannelVariation) => PreflightWarning[];
}

const Ctx = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const api = useMemo<AppApi>(() => {
    const campaignById = (id: string) => state.campaigns.find((c) => c.id === id);
    const brandById = (id: string) => BRANDS.find((b) => b.id === id);
    const itemById = (id: string) => state.items.find((i) => i.id === id);
    const assetsFor = (v: ChannelVariation) => state.media.filter((m) => v.mediaIds.includes(m.id));
    const visibleCampaigns =
      state.activeBrandId === 'all'
        ? state.campaigns
        : state.campaigns.filter((c) => c.brandId === state.activeBrandId);
    const visibleIds = new Set(visibleCampaigns.map((c) => c.id));
    const visibleVariations = state.variations.filter((v) => visibleIds.has(v.campaignId));
    const preflightFor = (v: ChannelVariation) => {
      const campaign = campaignById(v.campaignId);
      if (!campaign) return [];
      const ctx: PreflightContext = {
        campaign,
        assets: assetsFor(v),
        accounts: state.accounts,
        allVariations: state.variations,
        campaigns: state.campaigns,
        today: TODAY,
      };
      return preflight(v, ctx);
    };
    return {
      state,
      dispatch,
      campaignById,
      brandById,
      itemById,
      assetsFor,
      performanceFor: (id) => PERFORMANCE.find((p) => p.campaignId === id),
      visibleVariations,
      visibleCampaigns,
      preflightFor,
    };
  }, [state]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

/** Variations grouped by calendar day (scheduled or published). */
export function byDay(variations: ChannelVariation[]): Map<string, ChannelVariation[]> {
  const map = new Map<string, ChannelVariation[]>();
  for (const v of variations) {
    if (!v.scheduledAt) continue;
    const key = dateKeyOf(v.scheduledAt);
    const list = map.get(key) ?? [];
    list.push(v);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1));
  }
  return map;
}

export { BRANDS, ORG, SEGMENTS, TEMPLATES, USERS, TODAY };
