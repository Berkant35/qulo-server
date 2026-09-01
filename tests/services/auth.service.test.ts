import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow } from '../helpers/economy-config.fixture.js';
import { hashToken, hashPassword } from '../../src/utils/hash.js';

/**
 * Kimlik doğrulama — 536 satır, ürünün kapısı.
 * E-posta ve sosyal giriş gerçek kod; sadece dış dünyaya çıkan iki şey mock'lu:
 * e-posta gönderimi ve Google/Apple token doğrulaması.
 */

const NOW = new Date('2026-09-01T12:00:00Z');
// hardDeleteUser assertUuid çağırıyor — soft-delete kurtarma yollarında gerçek UUID şart.
const UID = '11111111-1111-4111-8111-111111111111';
const UID2 = '22222222-2222-4222-8222-222222222222';

const sentVerification: Array<{ email: string; token: string }> = [];
const sentReset: Array<{ email: string; token: string }> = [];
let socialPayload: { email: string; providerId: string; name?: string; surname?: string } | Error =
  { email: 'social@qulo.test', providerId: 'google-123', name: 'Ada', surname: 'Lovelace' };

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { economy_config_versions: [activeConfigRow()], ...seed },
    options,
  );

  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  vi.doMock('../../src/utils/email.js', () => ({
    sendVerificationEmail: async (email: string, token: string) => {
      sentVerification.push({ email, token });
    },
    sendPasswordResetEmail: async (email: string, token: string) => {
      sentReset.push({ email, token });
    },
  }));
  vi.doMock('../../src/utils/social-auth.js', () => ({
    verifyGoogleToken: async () => {
      if (socialPayload instanceof Error) throw socialPayload;
      return socialPayload;
    },
    verifyAppleToken: async () => {
      if (socialPayload instanceof Error) throw socialPayload;
      return socialPayload;
    },
  }));

  const { authService } = await import('../../src/services/auth.service.js');
  return { fake, authService };
}

type RegisterInput = Parameters<Awaited<ReturnType<typeof setup>>['authService']['register']>[0];

/** Şemaya birebir uyan geçerli kayıt girdisi (gender MAN|WOMAN|OTHER, tos zorunlu). */
const registerInput = (over: Partial<RegisterInput> = {}): RegisterInput => ({
  email: 'yeni@qulo.test',
  password: 'Sifre1234!',
  name: 'Ada',
  surname: 'Lovelace',
  age: 28,
  gender: 'WOMAN',
  locale: 'tr',
  tos_accepted: true,
  ...over,
});

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sentVerification.length = 0;
  sentReset.length = 0;
  socialPayload = { email: 'social@qulo.test', providerId: 'google-123', name: 'Ada', surname: 'Lovelace' };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('register', () => {
  it('kullanıcıyı doğrulanmamış olarak oluşturur', async () => {
    const { fake, authService } = await setup({ users: [] });

    const result = await authService.register(registerInput());

    expect(result.email).toBe('yeni@qulo.test');
    expect(fake.table('users')[0]).toMatchObject({
      email: 'yeni@qulo.test', name: 'Ada', age: 28, email_verified: false,
    });
  });

  /** Şifre asla düz metin saklanmamalı. */
  it('şifreyi hash\'ler, düz metin saklamaz', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput({ password: 'Sifre1234!' }));

    const row = fake.table('users')[0];
    expect(row.password_hash).toBeTruthy();
    expect(row.password_hash).not.toBe('Sifre1234!');
    expect(JSON.stringify(row)).not.toContain('Sifre1234!');
  });

  it('e-postayı normalize eder (büyük harf ve boşluk)', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput({ email: '  YENI@Qulo.Test  ' }));
    expect(fake.table('users')[0].email).toBe('yeni@qulo.test');
  });

  it('kayıtlı e-posta ile ikinci kayıt reddedilir', async () => {
    const { fake, authService } = await setup({
      users: [{ id: UID, email: 'yeni@qulo.test', is_deleted: false }],
    });

    await expect(authService.register(registerInput())).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS', statusCode: 409,
    });
    expect(fake.table('users')).toHaveLength(1);
  });

  it('büyük harfli varyantla da ikinci kayıt reddedilir', async () => {
    const { authService } = await setup({
      users: [{ id: UID, email: 'yeni@qulo.test', is_deleted: false }],
    });
    await expect(authService.register(registerInput({ email: 'YENI@QULO.TEST' }))).rejects.toMatchObject({
      code: 'EMAIL_ALREADY_EXISTS',
    });
  });

  /** Silinmiş hesabın e-postası tekrar kullanılabilmeli. */
  it('soft-delete edilmiş hesabın e-postasıyla yeniden kayıt olunabilir', async () => {
    const { fake, authService } = await setup({
      users: [{ id: UID, email: 'yeni@qulo.test', is_deleted: true }],
      questions: [{ id: 'q1', user_id: UID }],
      refresh_tokens: [{ id: 'rt1', user_id: UID }],
    }, { storage: { photos: [`${UID}/a.jpg`] } });

    await authService.register(registerInput());

    const rows = fake.table('users');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(UID);
    expect(rows[0].email_verified).toBe(false);
    // Eski hesabın izleri temizlenmeli.
    expect(fake.table('questions')).toHaveLength(0);
    expect(fake.table('refresh_tokens')).toHaveLength(0);
    expect(fake.storageFiles('photos')).toHaveLength(0);
  });

  it('doğrulama e-postası token ile gönderilir ve token hash\'li saklanır', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput());

    expect(sentVerification).toHaveLength(1);
    expect(sentVerification[0].email).toBe('yeni@qulo.test');
    expect(fake.table('users')[0].verify_token).toBe(hashToken(sentVerification[0].token));
  });

  it('doğrulama token\'ı 24 saat sonra sona erer', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput());

    expect(fake.table('users')[0].token_expires_at)
      .toBe(new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it('gender_pref verilirse zaman damgası da yazılır (setup gate 3. kartı)', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput({ gender_pref: 'MAN' }));

    expect(fake.table('users')[0]).toMatchObject({
      gender_pref: 'MAN', gender_pref_set_at: NOW.toISOString(),
    });
  });

  it('gender_pref yoksa alanlar hiç yazılmaz', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput());
    expect(fake.table('users')[0].gender_pref_set_at).toBeUndefined();
  });

  it('yeni kullanıcıya başlangıç gücü verilir', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput());
    await vi.waitFor(() => expect(fake.table('user_power_inventory')).toHaveLength(1));

    expect(fake.table('user_power_inventory')[0]).toMatchObject({
      power_name: 'ORACLE', count: 2,
    });
  });

  it('davet kodu uygulanır', async () => {
    const { fake, authService } = await setup({
      users: [{ id: UID, email: 'ref@qulo.test', referral_code: 'AAAA2222', is_deleted: false }],
    });

    await authService.register(registerInput({ referral_code: 'AAAA2222' }));

    expect(fake.table('referrals')[0]).toMatchObject({ referrer_id: UID, status: 'pending' });
  });

  /** Davet kodu yan bir özellik — kaydı düşürmemeli. */
  it('geçersiz davet kodu kaydı engellemez', async () => {
    const { fake, authService } = await setup({ users: [] });

    await expect(authService.register(registerInput({ referral_code: 'YOKKOD11' }))).resolves.toBeTruthy();
    expect(fake.table('users')).toHaveLength(1);
    expect(fake.table('referrals')).toHaveLength(0);
  });

  it('kullanıcının dili user_languages\'e eklenir', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.register(registerInput({ locale: 'de' }));
    expect(fake.table('user_languages')[0]).toMatchObject({ language_code: 'de' });
  });
});

describe('verifyEmail', () => {
  const token = 'dogrulama-token';
  const verifiable = (over: Record<string, unknown> = {}) => ({
    id: UID, email: 'a@qulo.test', email_verified: false,
    verify_token: hashToken(token),
    token_expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
    ...over,
  });

  it('geçerli token e-postayı doğrular ve token\'ı temizler', async () => {
    const { fake, authService } = await setup({ users: [verifiable()] });

    await expect(authService.verifyEmail(token)).resolves.toEqual({ userId: UID });
    expect(fake.table('users')[0]).toMatchObject({
      email_verified: true, verify_token: null, token_expires_at: null,
    });
  });

  it('geçersiz token reddedilir', async () => {
    const { authService } = await setup({ users: [verifiable()] });
    await expect(authService.verifyEmail('sahte')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('süresi geçmiş token reddedilir', async () => {
    const { fake, authService } = await setup({
      users: [verifiable({ token_expires_at: new Date(NOW.getTime() - 1000).toISOString() })],
    });

    await expect(authService.verifyEmail(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(fake.table('users')[0].email_verified).toBe(false);
  });

  it('zaten doğrulanmış hesapta token ikinci kez çalışmaz', async () => {
    const { authService } = await setup({ users: [verifiable({ email_verified: true })] });
    await expect(authService.verifyEmail(token)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

describe('login', () => {
  const PASSWORD = 'Sifre1234!';
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  const account = (over: Record<string, unknown> = {}) => ({
    id: UID, email: 'a@qulo.test', password_hash: passwordHash,
    email_verified: true, is_deleted: false, ...over,
  });

  it('doğru bilgilerle token üretir ve refresh token saklar', async () => {
    const { fake, authService } = await setup({ users: [account()] });

    const result = await authService.login('a@qulo.test', PASSWORD);

    expect(result.userId).toBe(UID);
    expect(result.accessToken).toBeTruthy();
    expect(fake.table('refresh_tokens')[0]).toMatchObject({
      user_id: UID, token_hash: hashToken(result.refreshToken),
    });
  });

  it('kullanıcıyı çevrimiçi işaretler', async () => {
    const { fake, authService } = await setup({ users: [account()] });
    await authService.login('a@qulo.test', PASSWORD);

    expect(fake.table('users')[0]).toMatchObject({
      is_online: true, last_seen_at: NOW.toISOString(),
    });
  });

  it('e-postayı normalize eder', async () => {
    const { authService } = await setup({ users: [account()] });
    await expect(authService.login('  A@Qulo.Test ', PASSWORD)).resolves.toBeTruthy();
  });

  /** Hesabın var olup olmadığı sızmamalı — iki durum da aynı hatayı vermeli. */
  it('yanlış şifre ve olmayan hesap aynı hatayı verir', async () => {
    const { authService } = await setup({ users: [account()] });

    await expect(authService.login('a@qulo.test', 'YanlisSifre1!')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', statusCode: 401,
    });
    await expect(authService.login('yok@qulo.test', PASSWORD)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS', statusCode: 401,
    });
  });

  it('yanlış şifrede refresh token yaratmaz', async () => {
    const { fake, authService } = await setup({ users: [account()] });
    await expect(authService.login('a@qulo.test', 'YanlisSifre1!')).rejects.toBeTruthy();
    expect(fake.table('refresh_tokens')).toHaveLength(0);
  });

  it('silinmiş hesap giriş yapamaz ve varlığını sızdırmaz', async () => {
    const { authService } = await setup({ users: [account({ is_deleted: true })] });
    await expect(authService.login('a@qulo.test', PASSWORD)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('doğrulanmamış e-posta ile giriş yapılamaz', async () => {
    const { authService } = await setup({ users: [account({ email_verified: false })] });
    await expect(authService.login('a@qulo.test', PASSWORD)).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED', statusCode: 403,
    });
  });

  it('sosyal giriş kullanıcısı şifreyle giremez', async () => {
    const { authService } = await setup({ users: [account({ password_hash: null })] });
    await expect(authService.login('a@qulo.test', PASSWORD)).rejects.toMatchObject({
      code: 'SOCIAL_LOGIN_ONLY',
    });
  });
});

describe('refresh', () => {
  async function loggedIn() {
    const passwordHash = await hashPassword('Sifre1234!');
    const ctx = await setup({
      users: [{
        id: UID, email: 'a@qulo.test', password_hash: passwordHash,
        email_verified: true, is_deleted: false,
      }],
    });
    const session = await ctx.authService.login('a@qulo.test', 'Sifre1234!');
    // JWT `iat` saniye çözünürlüklü: aynı saniyede aynı payload birebir aynı token
    // üretir. Rotasyonun gerçekten yeni token verdiğini görebilmek için saati ilerlet.
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    return { ...ctx, session };
  }

  it('yeni token çifti üretir', async () => {
    const { authService, session } = await loggedIn();

    const refreshed = await authService.refresh(session.refreshToken);

    expect(refreshed.accessToken).toBeTruthy();
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
  });

  it('eski refresh token rotasyon sonrası çalışmaz', async () => {
    const { authService, session } = await loggedIn();

    await authService.refresh(session.refreshToken);

    await expect(authService.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('yeni token saklanır, eskisi silinir', async () => {
    const { fake, authService, session } = await loggedIn();

    const refreshed = await authService.refresh(session.refreshToken);

    const rows = fake.table('refresh_tokens');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(refreshed.refreshToken));
  });

  it('bozuk token reddedilir', async () => {
    const { authService } = await loggedIn();
    await expect(authService.refresh('bu-jwt-degil')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('geçerli imzalı ama DB\'de olmayan token reddedilir', async () => {
    const { fake, authService, session } = await loggedIn();
    fake.table('refresh_tokens').length = 0;

    await expect(authService.refresh(session.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });
});

describe('logout', () => {
  it('refresh token\'ı siler ve çevrimdışı yapar', async () => {
    const { fake, authService } = await setup({
      users: [{ id: UID, is_online: true }],
      refresh_tokens: [{ id: 'rt1', user_id: UID, token_hash: hashToken('tok') }],
    });

    await authService.logout(UID, 'tok');

    expect(fake.table('refresh_tokens')).toHaveLength(0);
    expect(fake.table('users')[0].is_online).toBe(false);
  });

  it('token verilmezse de çevrimdışı yapar', async () => {
    const { fake, authService } = await setup({ users: [{ id: UID, is_online: true }] });
    await authService.logout(UID);
    expect(fake.table('users')[0].is_online).toBe(false);
  });

  it('başka kullanıcının token\'ını silmez', async () => {
    const { fake, authService } = await setup({
      users: [{ id: UID, is_online: true }],
      refresh_tokens: [
        { id: 'rt1', user_id: UID, token_hash: hashToken('benim') },
        { id: 'rt2', user_id: UID2, token_hash: hashToken('baskasinin') },
      ],
    });

    await authService.logout(UID, 'benim');

    expect(fake.table('refresh_tokens').map((r) => r.id)).toEqual(['rt2']);
  });
});

describe('forgotPassword', () => {
  /** Hesap var mı bilgisi sızmamalı — iki durumda da sessizce döner. */
  it('olmayan e-posta için hata atmaz ve token yazmaz', async () => {
    const { fake, authService } = await setup({ users: [] });

    await expect(authService.forgotPassword('yok@qulo.test')).resolves.toBeUndefined();
    expect(sentReset).toHaveLength(0);
    expect(fake.table('users')).toHaveLength(0);
  });

  it('kayıtlı e-postaya sıfırlama bağlantısı gönderir', async () => {
    const { fake, authService } = await setup({
      users: [{ id: UID, email: 'a@qulo.test', locale: 'tr' }],
    });

    await authService.forgotPassword('a@qulo.test');

    expect(sentReset).toHaveLength(1);
    expect(fake.table('users')[0].verify_token).toBe(hashToken(sentReset[0].token));
  });

  it('sıfırlama token\'ı 1 saat geçerli', async () => {
    const { fake, authService } = await setup({ users: [{ id: UID, email: 'a@qulo.test' }] });
    await authService.forgotPassword('a@qulo.test');

    expect(fake.table('users')[0].token_expires_at)
      .toBe(new Date(NOW.getTime() + 60 * 60 * 1000).toISOString());
  });

  it('e-postayı normalize eder', async () => {
    const { authService } = await setup({ users: [{ id: UID, email: 'a@qulo.test' }] });
    await authService.forgotPassword('  A@QULO.TEST ');
    expect(sentReset).toHaveLength(1);
  });
});

describe('resetPassword', () => {
  const token = 'sifirlama-token';
  const resettable = (over: Record<string, unknown> = {}) => ({
    id: UID, email: 'a@qulo.test', password_hash: 'eski-hash',
    email_verified: true, is_deleted: false,
    verify_token: hashToken(token),
    token_expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
    ...over,
  });

  it('şifreyi değiştirir ve token\'ı temizler', async () => {
    const { fake, authService } = await setup({ users: [resettable()] });

    await expect(authService.resetPassword(token, 'YeniSifre1!')).resolves.toEqual({ userId: UID });

    const row = fake.table('users')[0];
    expect(row.password_hash).not.toBe('eski-hash');
    expect(row.verify_token).toBeNull();
  });

  it('yeni şifreyle giriş yapılabilir', async () => {
    const { authService } = await setup({ users: [resettable()] });

    await authService.resetPassword(token, 'YeniSifre1!');
    await expect(authService.login('a@qulo.test', 'YeniSifre1!')).resolves.toBeTruthy();
  });

  /** Şifre değişince açık tüm oturumlar düşmeli — hesap ele geçirilmişse kritik. */
  it('kullanıcının tüm refresh token\'larını siler', async () => {
    const { fake, authService } = await setup({
      users: [resettable()],
      refresh_tokens: [
        { id: 'rt1', user_id: UID }, { id: 'rt2', user_id: UID },
        { id: 'rt3', user_id: UID2 },
      ],
    });

    await authService.resetPassword(token, 'YeniSifre1!');

    expect(fake.table('refresh_tokens').map((r) => r.id)).toEqual(['rt3']);
  });

  it('geçersiz token reddedilir', async () => {
    const { fake, authService } = await setup({ users: [resettable()] });

    await expect(authService.resetPassword('sahte', 'YeniSifre1!')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
    expect(fake.table('users')[0].password_hash).toBe('eski-hash');
  });

  it('süresi geçmiş token reddedilir', async () => {
    const { fake, authService } = await setup({
      users: [resettable({ token_expires_at: new Date(NOW.getTime() - 1000).toISOString() })],
    });

    await expect(authService.resetPassword(token, 'YeniSifre1!')).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(fake.table('users')[0].password_hash).toBe('eski-hash');
  });
});

describe('socialLogin', () => {
  const provider = { provider: 'google' as const, id_token: 'tok' };

  it('Case C — yeni kullanıcı yaratır ve doğrulanmış sayar', async () => {
    const { fake, authService } = await setup({ users: [] });

    const result = await authService.socialLogin(provider);

    expect(result.accessToken).toBeTruthy();
    expect(fake.table('users')[0]).toMatchObject({
      email: 'social@qulo.test', provider_id: 'google-123',
      auth_provider: 'google', email_verified: true,
    });
  });

  it('Case C — yaş yoksa profil eksik bildirilir', async () => {
    const { authService } = await setup({ users: [] });
    await expect(authService.socialLogin(provider)).resolves.toMatchObject({
      profileIncomplete: true,
    });
  });

  it('Case C — yeni sosyal kullanıcıya da başlangıç gücü verilir', async () => {
    const { fake, authService } = await setup({ users: [] });
    await authService.socialLogin(provider);
    await vi.waitFor(() => expect(fake.table('user_power_inventory')).toHaveLength(1));
  });

  it('Case A — provider_id eşleşince mevcut hesaba girer', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: 'google-123',
        is_deleted: false, is_banned: false, age: 30, name: 'Ada', surname: 'L',
      }],
    });

    await expect(authService.socialLogin(provider)).resolves.toMatchObject({
      userId: UID, profileIncomplete: false,
    });
    expect(fake.table('users')).toHaveLength(1);
  });

  it('Case A — eksik ad/soyad sağlayıcıdan tamamlanır', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: 'google-123',
        is_deleted: false, is_banned: false, age: 30, name: '', surname: '',
      }],
    });

    await authService.socialLogin(provider);

    expect(fake.table('users')[0]).toMatchObject({ name: 'Ada', surname: 'Lovelace' });
  });

  it('Case A — mevcut ad üzerine yazmaz', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: 'google-123',
        is_deleted: false, is_banned: false, age: 30, name: 'Kendi Adım', surname: 'Soyadım',
      }],
    });

    await authService.socialLogin(provider);
    expect(fake.table('users')[0].name).toBe('Kendi Adım');
  });

  it('Case A — banlı hesap girişi reddedilir', async () => {
    const { authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: 'google-123',
        is_deleted: false, is_banned: true, age: 30,
      }],
    });

    await expect(authService.socialLogin(provider)).rejects.toMatchObject({
      code: 'ACCOUNT_BANNED',
    });
  });

  it('Case B — e-posta eşleşince hesabı sağlayıcıya bağlar', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: null,
        is_deleted: false, is_banned: false, age: 25, name: 'Ada', surname: 'L',
      }],
    });

    await expect(authService.socialLogin(provider)).resolves.toMatchObject({ userId: UID });
    expect(fake.table('users')[0]).toMatchObject({
      provider_id: 'google-123', auth_provider: 'google',
    });
    expect(fake.table('users')).toHaveLength(1);
  });

  it('Case B — banlı hesap reddedilir', async () => {
    const { authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: null,
        is_deleted: false, is_banned: true, age: 25,
      }],
    });

    await expect(authService.socialLogin(provider)).rejects.toMatchObject({
      code: 'ACCOUNT_BANNED',
    });
  });

  /**
   * Bilinen 401 bug'ının alanı: Case A ve Case B silinmiş hesapta AYNI davranmalı.
   * İkisi de hard delete edip temiz hesap açmalı — biri yapıp diğeri yapmazsa
   * kullanıcı silinmiş hesapla tekrar girmeye çalıştığında 401 alıyor.
   */
  it('Case A — silinmiş hesap temizlenip yeni hesap açılır', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: 'google-123',
        is_deleted: true, is_banned: false, age: 30,
      }],
    });

    const result = await authService.socialLogin(provider);

    expect(result.userId).not.toBe(UID);
    expect(fake.table('users')).toHaveLength(1);
    expect(fake.table('users')[0].is_deleted).toBeUndefined();
  });

  it('Case B — silinmiş hesap temizlenip yeni hesap açılır', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: null,
        is_deleted: true, is_banned: false, age: 30,
      }],
    });

    const result = await authService.socialLogin(provider);

    expect(result.userId).not.toBe(UID);
    expect(fake.table('users')).toHaveLength(1);
  });

  it('silinmiş hesabın verileri de temizlenir', async () => {
    const { fake, authService } = await setup({
      users: [{
        id: UID, email: 'social@qulo.test', provider_id: 'google-123',
        is_deleted: true, is_banned: false, age: 30,
      }],
      questions: [{ id: 'q1', user_id: UID }],
      diamond_transactions: [{ id: 'd1', user_id: UID }],
    }, { storage: { photos: [`${UID}/a.jpg`] } });

    await authService.socialLogin(provider);

    expect(fake.table('questions')).toHaveLength(0);
    expect(fake.table('diamond_transactions')).toHaveLength(0);
    expect(fake.storageFiles('photos')).toHaveLength(0);
  });

  it('token doğrulaması başarısızsa reddedilir', async () => {
    socialPayload = new Error('gecersiz token');
    const { fake, authService } = await setup({ users: [] });

    await expect(authService.socialLogin(provider)).rejects.toMatchObject({
      code: 'SOCIAL_AUTH_FAILED',
    });
    expect(fake.table('users')).toHaveLength(0);
  });

  it('e-posta vermeyen sağlayıcı için yer tutucu e-posta üretir', async () => {
    socialPayload = { email: '', providerId: 'apple-999' };
    const { fake, authService } = await setup({ users: [] });

    await authService.socialLogin({ provider: 'apple', id_token: 'tok' });

    expect(fake.table('users')[0].email).toBe('apple-999@social.qulo.app');
  });

  it('oturum açınca refresh token saklanır ve çevrimiçi olur', async () => {
    const { fake, authService } = await setup({ users: [] });

    const result = await authService.socialLogin(provider);

    expect(fake.table('refresh_tokens')[0].token_hash).toBe(hashToken(result.refreshToken));
    expect(fake.table('users')[0].is_online).toBe(true);
  });
});
