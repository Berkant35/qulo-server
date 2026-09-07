import { describe, it, expect } from 'vitest';
import { LIFECYCLE_RULES_BY_KEY, LIFECYCLE_RULES } from '../../../src/services/notification-engine/rules.js';
import type { EngineContext, EngineUser } from '../../../src/services/notification-engine/context.js';

const NOW = new Date('2026-09-07T16:00:00.000Z');
const H = 3600 * 1000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function user(overrides: Partial<EngineUser> & { id: string }): EngineUser {
  return {
    name: `Name-${overrides.id}`,
    locale: 'tr',
    lng: 29,
    push_token: `tok-${overrides.id}`,
    last_active_at: ago(5 * D),
    last_seen_at: null,
    created_at: ago(60 * D),
    question_count: 2,
    photos: ['p.jpg'],
    email_verified: true,
    notification_preferences: null,
    is_deleted: false,
    is_banned: false,
    is_test_account: false,
    is_seed_profile: false,
    ...overrides,
  };
}

function ctx(partial: Partial<EngineContext> = {}): EngineContext {
  const users = partial.users ?? [];
  return {
    now: NOW,
    users,
    usersById: new Map(users.map((u) => [u.id, u])),
    matchesByUser: new Map(),
    messagesByMatch: new Map(),
    expiredQuizBySolver: new Map(),
    likesByTarget: new Map(),
    newVisibleUsers7d: 0,
    logByUser: new Map(),
    campaignSendsByUser: new Map(),
    ...partial,
  };
}

const A = user({ id: 'A' });
const B = user({ id: 'B', name: 'Bora' });
const match = { id: 'm1', user1_id: 'A', user2_id: 'B', matched_at: ago(3 * D) };

describe('rules — oncelik sirasi ve anahtarlar', () => {
  it('7 kural, oncelik dizilimi sabit', () => {
    expect(LIFECYCLE_RULES.map((r) => r.key)).toEqual([
      'lifecycle_unread_message',
      'lifecycle_match_waiting',
      'lifecycle_likes_waiting',
      'lifecycle_quiz_unfinished',
      'lifecycle_profile_incomplete',
      'lifecycle_new_people',
      'lifecycle_winback',
    ]);
  });
});

describe('lifecycle_unread_message', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_unread_message;
  const base = () =>
    ctx({
      users: [A, B],
      matchesByUser: new Map([['A', [match]], ['B', [match]]]),
    });

  it('24 saatten eski okunmamis mesaj + kullanici o zamandan beri girmemis → chat linki, gonderen adi', () => {
    const c = base();
    c.messagesByMatch.set('m1', [{ id: 'x', match_id: 'm1', sender_id: 'B', read_at: null, created_at: ago(2 * D), deleted_at: null }]);
    const me = user({ id: 'A', last_active_at: ago(3 * D) });
    expect(rule.evaluate(me, c)).toEqual({ params: { name: 'Bora' }, actionUrl: '/chat/m1' });
  });

  it('kullanici mesajdan sonra girdiyse (gordu sayilir) → yok', () => {
    const c = base();
    c.messagesByMatch.set('m1', [{ id: 'x', match_id: 'm1', sender_id: 'B', read_at: null, created_at: ago(2 * D), deleted_at: null }]);
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(1 * D) }), c)).toBeNull();
  });

  it('mesaj okunmus veya 24 saatten yeni → yok', () => {
    const c = base();
    c.messagesByMatch.set('m1', [
      { id: 'x', match_id: 'm1', sender_id: 'B', read_at: ago(1 * D), created_at: ago(2 * D), deleted_at: null },
      { id: 'y', match_id: 'm1', sender_id: 'B', read_at: null, created_at: ago(2 * H), deleted_at: null },
    ]);
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(3 * D) }), c)).toBeNull();
  });

  it('kendi mesaji sayilmaz', () => {
    const c = base();
    c.messagesByMatch.set('m1', [{ id: 'x', match_id: 'm1', sender_id: 'A', read_at: null, created_at: ago(2 * D), deleted_at: null }]);
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(3 * D) }), c)).toBeNull();
  });
});

describe('lifecycle_match_waiting', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_match_waiting;

  it('24 saati gecmis eslesmede hic yazmamis → chat linki, karsi tarafin adi', () => {
    const c = ctx({ users: [A, B], matchesByUser: new Map([['A', [match]]]) });
    expect(rule.evaluate(A, c)).toEqual({ params: { name: 'Bora' }, actionUrl: '/chat/m1' });
  });

  it('kullanici zaten yazdiysa → yok (karsi taraf yazmis olsa da)', () => {
    const c = ctx({ users: [A, B], matchesByUser: new Map([['A', [match]]]) });
    c.messagesByMatch.set('m1', [{ id: 'x', match_id: 'm1', sender_id: 'A', read_at: null, created_at: ago(2 * D), deleted_at: null }]);
    expect(rule.evaluate(A, c)).toBeNull();
  });

  it('eslesme 24 saatten yeni → yok; karsi taraf silinmis → yok', () => {
    const fresh = { ...match, matched_at: ago(2 * H) };
    expect(rule.evaluate(A, ctx({ users: [A, B], matchesByUser: new Map([['A', [fresh]]]) }))).toBeNull();
    expect(rule.evaluate(A, ctx({ users: [A], matchesByUser: new Map([['A', [match]]]) }))).toBeNull();
  });
});

describe('lifecycle_likes_waiting', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_likes_waiting;

  it('son girisinden sonra gelen begeniler sayilir, oncekiler sayilmaz', () => {
    const c = ctx({ users: [A, B] });
    c.likesByTarget.set('A', [
      { swiper_id: 'B', target_id: 'A', created_at: ago(2 * D) },
      { swiper_id: 'B', target_id: 'A', created_at: ago(10 * D) },
    ]);
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(5 * D) }), c)).toEqual({ params: { count: '1' }, actionUrl: '/discover' });
  });

  it('bugun aktifse → yok; begeni yoksa → yok; begenen silinmisse sayilmaz', () => {
    const c = ctx({ users: [A] });
    c.likesByTarget.set('A', [{ swiper_id: 'ghost', target_id: 'A', created_at: ago(2 * D) }]);
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(2 * H) }), c)).toBeNull();
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(5 * D) }), c)).toBeNull();
  });
});

describe('lifecycle_quiz_unfinished', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_quiz_unfinished;

  it('suresi dolmus quiz → hedefin profil linki ve adi (en yeni oturum)', () => {
    const c = ctx({ users: [A, B] });
    c.expiredQuizBySolver.set('A', [
      { id: 'q1', solver_id: 'A', target_id: 'B', started_at: ago(3 * D), expires_at: ago(3 * D + 1) },
    ]);
    expect(rule.evaluate(A, c)).toEqual({ params: { name: 'Bora' }, actionUrl: '/profile-detail/B' });
  });

  it('hedef silinmis → yok; bugun aktif → yok', () => {
    const c = ctx({ users: [A] });
    c.expiredQuizBySolver.set('A', [{ id: 'q1', solver_id: 'A', target_id: 'gone', started_at: ago(3 * D), expires_at: ago(2 * D) }]);
    expect(rule.evaluate(A, c)).toBeNull();
    const c2 = ctx({ users: [A, B] });
    c2.expiredQuizBySolver.set('A', [{ id: 'q1', solver_id: 'A', target_id: 'B', started_at: ago(3 * D), expires_at: ago(2 * D) }]);
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(1 * H) }), c2)).toBeNull();
  });
});

describe('lifecycle_profile_incomplete', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_profile_incomplete;

  it('soru eksik → /profile/questions; sadece foto eksik → /profile/edit', () => {
    expect(rule.evaluate(user({ id: 'A', question_count: 1, photos: [] }), ctx())).toEqual({ params: {}, actionUrl: '/profile/questions' });
    expect(rule.evaluate(user({ id: 'A', question_count: 2, photos: [] }), ctx())).toEqual({ params: {}, actionUrl: '/profile/edit' });
  });

  it('profil tam → yok; kayit 24 saatten yeni → yok; bugun aktif → yok', () => {
    expect(rule.evaluate(user({ id: 'A' }), ctx())).toBeNull();
    expect(rule.evaluate(user({ id: 'A', question_count: 0, created_at: ago(2 * H), last_active_at: ago(2 * H) }), ctx())).toBeNull();
    expect(rule.evaluate(user({ id: 'A', question_count: 0, last_active_at: ago(1 * H) }), ctx())).toBeNull();
  });
});

describe('lifecycle_new_people', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_new_people;

  it('3-30 gun inaktif ve bu hafta ≥3 gorunur yeni kullanici → sayi ile', () => {
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(5 * D) }), ctx({ newVisibleUsers7d: 4 }))).toEqual({ params: { count: '4' }, actionUrl: '/discover' });
  });

  it('yeni kullanici az, cok taze inaktif veya 30+ gun → yok', () => {
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(5 * D) }), ctx({ newVisibleUsers7d: 2 }))).toBeNull();
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(1 * D) }), ctx({ newVisibleUsers7d: 9 }))).toBeNull();
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(31 * D) }), ctx({ newVisibleUsers7d: 9 }))).toBeNull();
  });
});

describe('lifecycle_winback', () => {
  const rule = LIFECYCLE_RULES_BY_KEY.lifecycle_winback;

  it('last_active_at NULL ama presence (last_seen_at) taze → aktif sayilir, winback yok', () => {
    expect(rule.evaluate(user({ id: 'A', last_active_at: null, last_seen_at: ago(2 * H), created_at: ago(45 * D) }), ctx())).toBeNull();
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(40 * D), last_seen_at: ago(1 * D) }), ctx())).toBeNull();
  });

  it('30+ gun inaktif → discover; 29 gun → yok; hic girmemis kullanicida kayit tarihi esas', () => {
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(31 * D) }), ctx())).toEqual({ params: {}, actionUrl: '/discover' });
    expect(rule.evaluate(user({ id: 'A', last_active_at: ago(29 * D) }), ctx())).toBeNull();
    expect(rule.evaluate(user({ id: 'A', last_active_at: null, created_at: ago(45 * D) }), ctx())).toEqual({ params: {}, actionUrl: '/discover' });
  });
});
