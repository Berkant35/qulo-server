import { createRequire } from 'node:module';
import { getFcm, isFcmAvailable } from '../config/firebase.js';
import { supabase } from '../config/supabase.js';

const require = createRequire(import.meta.url);

const locales: Record<string, Record<string, Record<string, string>>> = {
  en: require('../locales/en.json'),
  tr: require('../locales/tr.json'),
};

export const PUSH_TYPES = [
  'new_message',
  'new_message_image',
  'new_match',
  'new_match_solver',
  'new_match_badge',
  'quiz_started',
  'passport_expired',
  'chat_question_answered',
  'campaign',
] as const;

export type PushType = typeof PUSH_TYPES[number];
export const SUPPORTED_LOCALES = ['tr', 'en'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export type ResolvedTemplate = { title: string; body: string } | null;

interface NotificationTypeConfig {
  actionUrl?: string;
  category?: string;
  /** Template key override; if absent, PushType itself is used */
  templateKey?: string;
  /** Badge-variant template key (used when params.badge is present) */
  badgeTemplateKey?: string;
}

const NOTIFICATION_CONFIG: Record<PushType, NotificationTypeConfig> = {
  new_message:            { category: 'messages' },
  new_message_image:      { category: 'messages' },
  new_match:              { actionUrl: '/matches', category: 'matches', badgeTemplateKey: 'new_match_badge' },
  new_match_solver:       { actionUrl: '/matches', category: 'matches' },
  new_match_badge:        { actionUrl: '/matches', category: 'matches' },
  quiz_started:           { category: 'matches' },
  passport_expired:       { actionUrl: '/profile/passport' },
  campaign:               { category: 'campaigns' },
  chat_question_answered: { category: 'matches' },
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
    type: PushType,
    locale: SupportedLocale,
  ): Promise<ResolvedTemplate> {
    const safeLocale = locales[locale] ? locale : 'en';
    const rawDefault = locales[safeLocale]?.push?.[type] as unknown;
    let defaultTitle: string | undefined;
    let defaultBody: string | undefined;
    if (typeof rawDefault === 'string') {
      defaultTitle = 'Qulo';
      defaultBody = rawDefault;
    } else if (rawDefault && typeof rawDefault === 'object') {
      const obj = rawDefault as { title?: string; body?: string };
      defaultTitle = obj.title;
      defaultBody = obj.body;
    }

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
   * Returns true if FCM push was actually sent, false otherwise.
   * Notification is always persisted to DB regardless of FCM status.
   */
  static async sendPush(
    userId: string,
    type: PushType,
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
    try {
      // 1. Get user's push_token and locale
      const { data: user, error } = await supabase
        .from('users')
        .select('push_token, locale, notification_preferences')
        .eq('id', userId)
        .single();

      if (error || !user) {
        console.warn(`[NotificationService] User not found: ${userId}`);
        return false;
      }

      // 2. Resolve title and body
      let title: string;
      let body: string;
      let skipFcm = false;

      if (type === 'campaign' && options?.title) {
        // Campaign notifications use custom title/body from campaign data
        title = options.title;
        body = params.body ?? options.title;
      } else {
        const locale = user.locale && locales[user.locale] ? user.locale : 'en';
        const safeLocale: SupportedLocale = (locale === 'tr' || locale === 'en') ? locale : 'en';

        // Provide locale-aware fallback for {name} if empty
        if ('name' in params && !params.name) {
          params.name = locale === 'tr' ? 'Birisi' : 'Someone';
        }

        // Use badge-specific template if badge param is present
        const config = NOTIFICATION_CONFIG[type];
        const templateKey = (params.badge && config.badgeTemplateKey) ? config.badgeTemplateKey : (config.templateKey ?? type);

        const resolved = await NotificationService.getTemplate(templateKey as PushType, safeLocale);
        if (!resolved) {
          console.warn(`[NotificationService] No push template for type=${templateKey}, locale=${safeLocale} — DB persisted, FCM skipped`);
          body = `[${type}]`;
          title = options?.title ?? 'Qulo';
          skipFcm = true;
        } else {
          body = interpolate(resolved.body, params);
          title = options?.title ?? interpolate(resolved.title, params);
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

      // Check notification preferences — if category disabled, skip push but keep DB record
      const category = NOTIFICATION_CONFIG[type].category;
      if (category) {
        const prefs = user.notification_preferences as Record<string, boolean> | null;
        const enabled = prefs?.[category] ?? true; // NULL = all enabled
        if (!enabled) {
          console.log(`[NotificationService] Push suppressed: user=${userId} disabled category=${category} (type=${type})`);
          return false;
        }
      }
      // System notifications (no category mapping) always send push

      // If template resolution failed, DB has been persisted but skip FCM
      if (skipFcm) {
        return false;
      }

      // 5. Send via FCM
      if (!user.push_token) {
        console.warn(`[NotificationService] User ${userId} has no push_token — DB saved, FCM skipped`);
        return false;
      }

      const fcm = getFcm();
      if (!fcm) {
        console.warn(`[NotificationService] FCM not available — DB saved, push skipped for user=${userId}`);
        return false;
      }

      await fcm.send({
        token: user.push_token,
        notification: { title, body },
        data: {
          type,
          ...(notification?.id ? { notification_id: notification.id } : {}),
          ...(actionUrl ? { action_url: actionUrl } : {}),
          ...data,
        },
      });

      return true;
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

      return false;
    }
  }
}
