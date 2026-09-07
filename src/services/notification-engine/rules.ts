import { DAY_MS } from './timezone.js';
import type { EngineContext, EngineUser } from './context.js';

/**
 * Faz 1 kurallari — oncelik sirasiyla. Her kural saf bir fonksiyondur: DB yok, sadece baglam.
 * Metinler locale JSON'da `push.<key>` = { title, body } (16 dil) + push_messages admin override.
 * Tasarim: docs/superpowers/specs/2026-09-07-akilli-bildirim-motoru-design.md
 */
export const LIFECYCLE_RULE_KEYS = [
  'lifecycle_unread_message',
  'lifecycle_match_waiting',
  'lifecycle_likes_waiting',
  'lifecycle_quiz_unfinished',
  'lifecycle_profile_incomplete',
  'lifecycle_new_people',
  'lifecycle_winback',
] as const;

export type LifecycleRuleKey = (typeof LIFECYCLE_RULE_KEYS)[number];
export type RuleCategory = 'messages' | 'matches' | 'campaigns';

export interface RuleMatch {
  params: Record<string, string>;
  actionUrl: string;
}

export interface LifecycleRule {
  key: LifecycleRuleKey;
  /** Backoffice'te gosterilen kisa aciklama. */
  description: string;
  category: RuleCategory;
  defaultCooldownDays: number;
  evaluate(user: EngineUser, ctx: EngineContext): RuleMatch | null;
}

/**
 * Son aktiflik = max(last_active_at, last_seen_at, created_at).
 * last_active_at sadece uygulama resume'da yazilir; giris yapip kapatan kullanicida NULL kalir
 * (prod: 69 uygun kullanicinin 18'i). last_seen_at ise 60 sn'lik presence heartbeat'i — ikisinin
 * buyugu alinmazsa aktif kullaniciya "seni ozledik" gider.
 */
export function lastActiveMs(user: EngineUser): number {
  const stamps = [user.last_active_at, user.last_seen_at, user.created_at]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => Date.parse(v))
    .filter((ms) => Number.isFinite(ms));
  return stamps.length ? Math.max(...stamps) : 0;
}

function inactiveMs(user: EngineUser, ctx: EngineContext): number {
  return ctx.now.getTime() - lastActiveMs(user);
}

function otherUserOf(match: { user1_id: string; user2_id: string }, userId: string): string {
  return match.user1_id === userId ? match.user2_id : match.user1_id;
}

const NEW_PEOPLE_MIN_COUNT = 3;

export const LIFECYCLE_RULES: LifecycleRule[] = [
  {
    key: 'lifecycle_unread_message',
    description: '24 saatten eski okunmamis mesaj var, kullanici o mesajdan beri girmedi',
    category: 'messages',
    defaultCooldownDays: 2,
    evaluate(user, ctx) {
      const cutoff = ctx.now.getTime() - DAY_MS;
      const lastActive = lastActiveMs(user);
      let best: { matchId: string; senderName: string; createdAt: number } | null = null;
      for (const match of ctx.matchesByUser.get(user.id) ?? []) {
        const sender = ctx.usersById.get(otherUserOf(match, user.id));
        if (!sender) continue;
        for (const msg of ctx.messagesByMatch.get(match.id) ?? []) {
          if (msg.sender_id === user.id || msg.read_at) continue;
          const createdAt = Date.parse(msg.created_at);
          if (createdAt > cutoff || createdAt <= lastActive) continue;
          if (!best || createdAt > best.createdAt) best = { matchId: match.id, senderName: sender.name ?? '', createdAt };
        }
      }
      return best ? { params: { name: best.senderName }, actionUrl: `/chat/${best.matchId}` } : null;
    },
  },
  {
    key: 'lifecycle_match_waiting',
    description: 'Son 30 gunde kurulmus, 24 saati gecmis eslesmede kullanici hic yazmamis',
    category: 'matches',
    defaultCooldownDays: 3,
    evaluate(user, ctx) {
      const cutoff = ctx.now.getTime() - DAY_MS;
      let best: { matchId: string; name: string; matchedAt: number } | null = null;
      for (const match of ctx.matchesByUser.get(user.id) ?? []) {
        const matchedAt = Date.parse(match.matched_at);
        if (matchedAt > cutoff) continue;
        const other = ctx.usersById.get(otherUserOf(match, user.id));
        if (!other) continue;
        const wroteAlready = (ctx.messagesByMatch.get(match.id) ?? []).some((m) => m.sender_id === user.id);
        if (wroteAlready) continue;
        if (!best || matchedAt > best.matchedAt) best = { matchId: match.id, name: other.name ?? '', matchedAt };
      }
      return best ? { params: { name: best.name }, actionUrl: `/chat/${best.matchId}` } : null;
    },
  },
  {
    key: 'lifecycle_likes_waiting',
    description: 'Son girisinden sonra begeni almis, 1+ gundur girmiyor',
    category: 'campaigns',
    defaultCooldownDays: 3,
    evaluate(user, ctx) {
      if (inactiveMs(user, ctx) < DAY_MS) return null;
      const lastActive = lastActiveMs(user);
      const count = (ctx.likesByTarget.get(user.id) ?? []).filter(
        (like) => like.swiper_id !== user.id && ctx.usersById.has(like.swiper_id) && Date.parse(like.created_at) > lastActive,
      ).length;
      return count > 0 ? { params: { count: String(count) }, actionUrl: '/discover' } : null;
    },
  },
  {
    key: 'lifecycle_quiz_unfinished',
    description: 'Son 14 gunde suresi dolmus yarim quiz var, 1+ gundur girmiyor',
    category: 'campaigns',
    defaultCooldownDays: 3,
    evaluate(user, ctx) {
      if (inactiveMs(user, ctx) < DAY_MS) return null;
      let best: { targetId: string; name: string; startedAt: number } | null = null;
      for (const session of ctx.expiredQuizBySolver.get(user.id) ?? []) {
        const target = ctx.usersById.get(session.target_id);
        if (!target) continue;
        const startedAt = session.started_at ? Date.parse(session.started_at) : 0;
        if (!best || startedAt > best.startedAt) best = { targetId: target.id, name: target.name ?? '', startedAt };
      }
      return best ? { params: { name: best.name }, actionUrl: `/profile-detail/${best.targetId}` } : null;
    },
  },
  {
    key: 'lifecycle_profile_incomplete',
    description: 'Kayit 24 saati gecmis, 2 sorudan az veya fotografsiz, 1+ gundur girmiyor',
    category: 'campaigns',
    defaultCooldownDays: 3,
    evaluate(user, ctx) {
      if (ctx.now.getTime() - Date.parse(user.created_at) < DAY_MS) return null;
      if (inactiveMs(user, ctx) < DAY_MS) return null;
      const missingQuestions = (user.question_count ?? 0) < 2;
      const missingPhoto = (user.photos?.length ?? 0) < 1;
      if (!missingQuestions && !missingPhoto) return null;
      return { params: {}, actionUrl: missingQuestions ? '/profile/questions' : '/profile/edit' };
    },
  },
  {
    key: 'lifecycle_new_people',
    description: '3-30 gundur girmiyor ve bu hafta en az 3 gorunur yeni kullanici katildi',
    category: 'campaigns',
    defaultCooldownDays: 7,
    evaluate(user, ctx) {
      const inactive = inactiveMs(user, ctx);
      if (inactive < 3 * DAY_MS || inactive >= 30 * DAY_MS) return null;
      if (ctx.newVisibleUsers7d < NEW_PEOPLE_MIN_COUNT) return null;
      return { params: { count: String(ctx.newVisibleUsers7d) }, actionUrl: '/discover' };
    },
  },
  {
    key: 'lifecycle_winback',
    description: '30+ gundur girmiyor',
    category: 'campaigns',
    defaultCooldownDays: 30,
    evaluate(user, ctx) {
      return inactiveMs(user, ctx) >= 30 * DAY_MS ? { params: {}, actionUrl: '/discover' } : null;
    },
  },
];

export const LIFECYCLE_RULES_BY_KEY: Record<LifecycleRuleKey, LifecycleRule> = Object.fromEntries(
  LIFECYCLE_RULES.map((r) => [r.key, r]),
) as Record<LifecycleRuleKey, LifecycleRule>;

export function isLifecycleRuleKey(value: string): value is LifecycleRuleKey {
  return (LIFECYCLE_RULE_KEYS as readonly string[]).includes(value);
}
