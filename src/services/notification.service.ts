import { getFcm, isFcmAvailable } from '../config/firebase.js';
import { supabase } from '../config/supabase.js';
import { resolveLocale } from '../utils/locales.js';
import { serverLocales as locales } from '../utils/server-locales.js';
import { LIFECYCLE_RULE_KEYS, LIFECYCLE_RULES } from './notification-engine/rules.js';
import type { LifecycleRuleKey } from './notification-engine/rules.js';

// Admin-editable push template types (shown in /admin/push-messages panel).
// Validator (pushTemplateParamsSchema) accepts only these.
export const PUSH_TYPES = [
  'new_message',
  'new_message_image',
  'new_match',
  'new_match_solver',
  'new_match_badge',
  'chat_question_answered',
  // Lifecycle (bildirim motoru) tipleri — rules.ts tek kaynak; admin panelinde dil dil duzenlenir/susturulur
  ...LIFECYCLE_RULE_KEYS,
] as const;

export type PushType = typeof PUSH_TYPES[number];

// Internal push types — invoked by sendPush() but NOT editable from the admin panel.
// Body comes from caller params (e.g. campaign.push_body), template lookup is bypassed.
export const INTERNAL_PUSH_TYPES = ['campaign'] as const;
export type InternalPushType = typeof INTERNAL_PUSH_TYPES[number];

// Union accepted by sendPush, getTemplate, and NOTIFICATION_CONFIG.
export type AnyPushType = PushType | InternalPushType;

import type { SupportedLocale } from '../constants/locales.js';

export type ResolvedTemplate = { title: string; body: string } | null;

export const DEFAULT_PUSH_TITLE = 'Qulo';

/**
 * Resolve the locale-file default template for a (type, locale) pair.
 * Handles BOTH legacy bare-string entries (body-only) and future {title, body} object shape.
 * Returns { title: '', body: '' } when no entry exists.
 */
export function loadDefaultTemplate(
  type: AnyPushType,
  locale: SupportedLocale,
): { title: string; body: string } {
  // Nesne dogrulugu gercek bir koruma degildi ('constructor' gecerdi); liste kontrolu.
  const safeLocale = resolveLocale(locale);
  const raw = locales[safeLocale]?.push?.[type] as unknown;
  if (typeof raw === 'string') return { title: DEFAULT_PUSH_TITLE, body: raw };
  if (raw && typeof raw === 'object') {
    const r = raw as { title?: string; body?: string };
    return { title: r.title ?? DEFAULT_PUSH_TITLE, body: r.body ?? '' };
  }
  return { title: '', body: '' };
}

interface NotificationTypeConfig {
  actionUrl?: string;
  category?: string;
  /** Template key override; if absent, PushType itself is used */
  templateKey?: string;
  /** Badge-variant template key (used when params.badge is present) */
  badgeTemplateKey?: string;
}

const NOTIFICATION_CONFIG: Record<AnyPushType, NotificationTypeConfig> = {
  new_message:            { category: 'messages' },
  new_message_image:      { category: 'messages' },
  new_match:              { actionUrl: '/matches', category: 'matches', badgeTemplateKey: 'new_match_badge' },
  new_match_solver:       { actionUrl: '/matches', category: 'matches' },
  new_match_badge:        { actionUrl: '/matches', category: 'matches' },
  chat_question_answered: { category: 'matches' },
  campaign:               { category: 'campaigns' },
  // Lifecycle — kategori rules.ts'ten (tek kaynak); action_url motor tarafindan karar basina verilir
  ...(Object.fromEntries(LIFECYCLE_RULES.map((r) => [r.key, { category: r.category }])) as Record<LifecycleRuleKey, NotificationTypeConfig>),
};

/** sendPushDetailed'in gonderMEme sebebi — push_log'a yazilir, backoffice'te gorunur. */
export type PushSkipReason =
  | 'user_not_found'
  | 'template_missing'
  | 'pref_disabled'
  | 'no_token'
  | 'fcm_unavailable'
  | 'fcm_error';

export interface PushSendResult {
  /** FCM'e gercekten gitti mi. */
  sent: boolean;
  reason: PushSkipReason | null;
  /** notifications (inbox) satiri — tercih kapali olsa da yazilir (mevcut davranis). */
  notificationId: string | null;
  title: string | null;
  body: string | null;
}

// 16 dilde "Birisi" karşılığı — push body'lerde {name} placeholder'ı boş kalırsa kullanılır
const NAME_FALLBACK: Record<SupportedLocale, string> = {
  tr: 'Birisi',
  en: 'Someone',
  de: 'Jemand',
  fr: 'Quelqu\'un',
  es: 'Alguien',
  ar: 'شخص ما',
  ru: 'Кто-то',
  pt: 'Alguém',
  it: 'Qualcuno',
  ja: '誰か',
  ko: '누군가',
  zh: '有人',
  nl: 'Iemand',
  pl: 'Ktoś',
  sv: 'Någon',
  hi: 'कोई',
  th: 'ใครบางคน',
  id: 'Seseorang',
};

function interpolate(template: string, params: Record<string, string>): string {
  // Replace known params, strip any remaining unresolved placeholders
  const result = template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '');
  // Clean up: trim and collapse multiple spaces (e.g. when {name} was empty)
  return result.replace(/\s+/g, ' ').trim();
}

export class NotificationService {
  /**
   * Fetch a user's display name for push notification placeholders.
   */
  static async getUserDisplayName(userId: string): Promise<string> {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', userId)
        .single();

      return user?.name ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Resolve a push notification template for (type, locale).
   *
   * Lookup order:
   *   1. push_messages DB override (per type+locale)
   *   2. locales JSON default (src/locales/{locale}.json → push.<type>)
   *
   * Behavior:
   * - If override row has is_active=false → returns null (push muted).
   * - Override title/body are nullable — null fields fall back to locale default.
   * - Locale defaults may be a plain string (legacy body-only) or { title, body }.
   *   For string defaults, title falls back to 'Qulo'.
   * - DB errors are swallowed (warn-logged) and we fall back to locale default.
   * - Returns null when neither override nor default yields a usable title+body
   *   (e.g. unknown type with no override row).
   */
  static async getTemplate(
    type: AnyPushType,
    locale: SupportedLocale,
  ): Promise<ResolvedTemplate> {
    const safeLocale: SupportedLocale = resolveLocale(locale);
    const def = loadDefaultTemplate(type, safeLocale);
    // Empty strings from loadDefaultTemplate (unknown type) → treat as "no default".
    const defaultTitle = def.title || undefined;
    const defaultBody = def.body || undefined;

    type OverrideRow = { title: string | null; body: string | null; is_active: boolean };
    let override: OverrideRow | null = null;
    try {
      const { data } = await supabase
        .from('push_messages')
        .select('title, body, is_active')
        .eq('type', type)
        .eq('locale', safeLocale)
        .maybeSingle();
      override = (data as OverrideRow | null) ?? null;
    } catch (err) {
      console.warn('[NotificationService] push_messages fetch failed, using locale default:', err);
    }

    if (override?.is_active === false) return null;

    const title = override?.title ?? defaultTitle;
    const body = override?.body ?? defaultBody;
    if (!title || !body) return null;

    return { title, body };
  }

  /**
   * (type, locale, params) icin baslik+metni cozer ve doldurur. Gondermez, DB'ye yazmaz.
   * Bildirim motoru dry-run/onizlemede, sendPushDetailed gercek gonderimde kullanir.
   */
  static async renderPush(
    type: AnyPushType,
    locale: SupportedLocale,
    params: Record<string, string> = {},
  ): Promise<{ title: string; body: string } | null> {
    const filled = { ...params };
    // Provide locale-aware fallback for {name} if empty
    if ('name' in filled && !filled.name) {
      filled.name = NAME_FALLBACK[locale];
    }

    // Use badge-specific template if badge param is present
    const config = NOTIFICATION_CONFIG[type];
    const templateKey = (filled.badge && config.badgeTemplateKey) ? config.badgeTemplateKey : (config.templateKey ?? type);

    const resolved = await NotificationService.getTemplate(templateKey as AnyPushType, locale);
    if (!resolved) return null;
    return { title: interpolate(resolved.title, filled), body: interpolate(resolved.body, filled) };
  }

  /**
   * Returns true if FCM push was actually sent, false otherwise.
   * Notification is always persisted to DB regardless of FCM status.
   */
  static async sendPush(
    userId: string,
    type: AnyPushType,
    params: Record<string, string> = {},
    data?: Record<string, string>,
    options?: {
      title?: string;
      imageUrl?: string;
      actionUrl?: string;
      actionLabel?: string;
      campaignId?: string;
    },
  ): Promise<boolean> {
    const result = await NotificationService.sendPushDetailed(userId, type, params, data, options);
    return result.sent;
  }

  /**
   * sendPush'un sebep doneni: neden gitmedigini ve inbox satirinin id'sini de verir.
   * Davranis sendPush ile birebir ayni (inbox satiri her durumda yazilir, tercih kapaliysa FCM atlanir).
   */
  static async sendPushDetailed(
    userId: string,
    type: AnyPushType,
    params: Record<string, string> = {},
    data?: Record<string, string>,
    options?: {
      title?: string;
      imageUrl?: string;
      actionUrl?: string;
      actionLabel?: string;
      campaignId?: string;
    },
  ): Promise<PushSendResult> {
    const skipped = (reason: PushSkipReason, notificationId: string | null = null, title: string | null = null, body: string | null = null): PushSendResult =>
      ({ sent: false, reason, notificationId, title, body });
    // try disinda: FCM hatasinda da inbox satiri cogu zaman yazilmis olur, catch bunu geri vermeli
    let notificationId: string | null = null;
    let title = '';
    let body = '';

    try {
      // 1. Get user's push_token and locale
      const { data: user, error } = await supabase
        .from('users')
        .select('push_token, locale, notification_preferences')
        .eq('id', userId)
        .single();

      if (error || !user) {
        console.warn(`[NotificationService] User not found: ${userId}`);
        return skipped('user_not_found');
      }

      // 2. Resolve title and body
      let skipFcm = false;

      if (type === 'campaign' && options?.title) {
        // Campaign notifications use custom title/body from campaign data
        title = options.title;
        body = params.body ?? options.title;
      } else {
        // Import edilen resolveLocale ile single source of truth — 16 dil
        const safeLocale: SupportedLocale = resolveLocale(user.locale);
        const rendered = await NotificationService.renderPush(type, safeLocale, params);
        if (!rendered) {
          console.warn(`[NotificationService] No push template for type=${type}, locale=${safeLocale} — DB persisted, FCM skipped`);
          body = `[${type}]`;
          title = options?.title ?? 'Qulo';
          skipFcm = true;
        } else {
          body = rendered.body;
          title = options?.title ?? rendered.title;
        }
      }

      const actionUrl = options?.actionUrl ?? NOTIFICATION_CONFIG[type].actionUrl ?? null;

      // 4. Persist notification to DB (always, even if FCM unavailable)
      const { data: notification } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          campaign_id: options?.campaignId ?? null,
          type,
          title,
          body,
          image_url: options?.imageUrl ?? null,
          action_url: actionUrl,
          action_label: options?.actionLabel ?? null,
        })
        .select('id')
        .single();
      notificationId = notification?.id ?? null;

      // Check notification preferences — if category disabled, skip push but keep DB record
      const category = NOTIFICATION_CONFIG[type].category;
      if (category) {
        const prefs = user.notification_preferences as Record<string, boolean> | null;
        const enabled = prefs?.[category] ?? true; // NULL = all enabled
        if (!enabled) {
          console.log(`[NotificationService] Push suppressed: user=${userId} disabled category=${category} (type=${type})`);
          return skipped('pref_disabled', notificationId, title, body);
        }
      }
      // System notifications (no category mapping) always send push

      // If template resolution failed, DB has been persisted but skip FCM
      if (skipFcm) {
        return skipped('template_missing', notificationId, title, body);
      }

      // 5. Send via FCM
      if (!user.push_token) {
        console.warn(`[NotificationService] User ${userId} has no push_token — DB saved, FCM skipped`);
        return skipped('no_token', notificationId, title, body);
      }

      const fcm = getFcm();
      if (!fcm) {
        console.warn(`[NotificationService] FCM not available — DB saved, push skipped for user=${userId}`);
        return skipped('fcm_unavailable', notificationId, title, body);
      }

      await fcm.send({
        token: user.push_token,
        notification: { title, body },
        data: {
          type,
          ...(notificationId ? { notification_id: notificationId } : {}),
          ...(actionUrl ? { action_url: actionUrl } : {}),
          ...data,
        },
      });

      return { sent: true, reason: null, notificationId, title, body };
    } catch (err: any) {
      const errorCode = err?.errorInfo?.code ?? err?.code ?? '';
      console.error(`[NotificationService] Failed to send push (type=${type}, user=${userId}, code=${errorCode}):`, err?.message ?? err);

      // Stale/invalid token — clear from DB so client re-registers on next launch
      const staleTokenCodes = [
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
        'messaging/mismatched-credential',
      ];
      if (staleTokenCodes.includes(errorCode)) {
        console.warn(`[NotificationService] Clearing stale push_token for user=${userId} (code=${errorCode})`);
        await supabase
          .from('users')
          .update({ push_token: null })
          .eq('id', userId);
      }

      return skipped('fcm_error', notificationId, title || null, body || null);
    }
  }
}
