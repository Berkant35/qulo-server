import { createRequire } from 'node:module';
import { getFcm, isFcmAvailable } from '../config/firebase.js';
import { supabase } from '../config/supabase.js';

const require = createRequire(import.meta.url);

const locales: Record<string, Record<string, Record<string, string>>> = {
  en: require('../locales/en.json'),
  tr: require('../locales/tr.json'),
};

type PushType = 'new_message' | 'new_message_image' | 'new_match' | 'new_match_solver' | 'passport_expired' | 'campaign' | 'chat_question_answered';

const ACTION_URL_MAP: Partial<Record<PushType, string>> = {
  new_match: '/matches',
  new_match_solver: '/matches',
  passport_expired: '/profile/passport',
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
        .select('push_token, locale')
        .eq('id', userId)
        .single();

      if (error || !user) {
        console.warn(`[NotificationService] User not found: ${userId}`);
        return false;
      }

      // 2. Resolve title and body
      let title: string;
      let body: string;

      if (type === 'campaign' && options?.title) {
        // Campaign notifications use custom title/body from campaign data
        title = options.title;
        body = params.body ?? options.title;
      } else {
        const locale = user.locale && locales[user.locale] ? user.locale : 'en';

        // Provide locale-aware fallback for {name} if empty
        if ('name' in params && !params.name) {
          params.name = locale === 'tr' ? 'Birisi' : 'Someone';
        }

        // Use badge-specific template if badge param is present
        const templateKey = (type === 'new_match' && params.badge) ? 'new_match_badge' : type;
        const template = locales[locale]?.push?.[templateKey];
        if (!template) {
          console.warn(`[NotificationService] No push template for type=${templateKey}, locale=${locale} — using fallback, still persisting to DB`);
          body = `[${type}]`;
          title = options?.title ?? 'Qulo';
        } else {
          body = interpolate(template, params);
          title = options?.title ?? 'Qulo';
        }
      }

      const actionUrl = options?.actionUrl ?? ACTION_URL_MAP[type] ?? null;

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
