import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateKeyPairSync, createPublicKey } from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Realtime JWT imzalayıcısı (082/083 RLS'inin önkoşulu). Token Supabase'in beklediği claim'leri
 * taşımalı (`role=authenticated`, `sub=<users.id>`, `aud`, `exp`). ES256 başlığında `kid` olmalı:
 * Supabase anahtarı `kid` ile bulur. API erişim token'ı olarak geçmemeli.
 */
const USER = '11111111-1111-4111-8111-111111111111';
const ISSUER = 'https://test.supabase.co/auth/v1';
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

function es256Jwk(kid = 'kid-test-1') {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...privateKey.export({ format: 'jwk' }), kid };
  const publicKey = createPublicKey(privateKey);
  return { raw: JSON.stringify(jwk), jwk, publicKey };
}

beforeEach(() => {
  vi.resetModules();
});

async function load() {
  return import('../../src/services/realtime-token.service.js');
}

describe('createRealtimeTokenService — ES256 (önerilen)', () => {
  it(`kid başlıklı ES256 token; claim'ler Supabase sözleşmesine uyar, süre 10 dk`, async () => {
    const { createRealtimeTokenService, REALTIME_TOKEN_TTL_SEC } = await load();
    const key = es256Jwk('7d68f0e0-test');
    const svc = createRealtimeTokenService({ privateJwk: key.raw, issuer: ISSUER, now: () => NOW });

    expect(svc.kind).toBe('es256');
    const { token, expiresAt } = svc.issue(USER);

    const decoded = jwt.decode(token, { complete: true })!;
    expect(decoded.header).toMatchObject({ alg: 'ES256', kid: '7d68f0e0-test', typ: 'JWT' });

    const claims = jwt.verify(token, key.publicKey, {
      algorithms: ['ES256'], audience: 'authenticated', issuer: ISSUER, clockTimestamp: NOW / 1000,
    }) as jwt.JwtPayload;
    expect(claims.sub).toBe(USER);
    expect(claims.role).toBe('authenticated');
    expect(claims.is_anonymous).toBe(false);
    expect(claims.iat).toBe(NOW / 1000);
    expect(claims.exp).toBe(NOW / 1000 + REALTIME_TOKEN_TTL_SEC);
    expect(REALTIME_TOKEN_TTL_SEC).toBe(600);
    expect(expiresAt).toBe(new Date((NOW / 1000 + 600) * 1000).toISOString());
  });

  it(`başka anahtarın public key'i ile doğrulanmaz (imza gerçekten bu anahtardan)`, async () => {
    const { createRealtimeTokenService } = await load();
    const a = es256Jwk();
    const b = es256Jwk();
    const { token } = createRealtimeTokenService({ privateJwk: a.raw, issuer: ISSUER }).issue(USER);
    expect(() => jwt.verify(token, b.publicKey, { algorithms: ['ES256'] })).toThrow();
  });

  it('ikisi de tanımlıysa ES256 kazanır', async () => {
    const { createRealtimeTokenService } = await load();
    const key = es256Jwk();
    const svc = createRealtimeTokenService({ privateJwk: key.raw, legacySecret: 'legacy-secret', issuer: ISSUER });
    expect(svc.kind).toBe('es256');
    expect(jwt.decode(svc.issue(USER).token, { complete: true })!.header.alg).toBe('ES256');
  });

  it.each([
    ['bozuk JSON', () => '{not json'],
    ['yalnız public key (d yok)', () => { const { jwk } = es256Jwk(); const { d: _d, ...pub } = jwk; return JSON.stringify(pub); }],
    ['kid yok', () => { const { jwk } = es256Jwk(); const { kid: _k, ...rest } = jwk; return JSON.stringify(rest); }],
    ['RSA anahtarı', () => {
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      return JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'r1' });
    }],
  ])(`geçersiz JWK (%s) → kapalı; legacy secret olsa bile HS256'ya sessizce düşmez`, async (_ad, raw) => {
    const { createRealtimeTokenService } = await load();
    const svc = createRealtimeTokenService({ privateJwk: raw(), legacySecret: 'legacy-secret', issuer: ISSUER });
    expect(svc.kind).toBe('disabled');
    expect(svc.disabledReason).toBeTruthy();
    expect(() => svc.issue(USER)).toThrow(expect.objectContaining({ code: 'REALTIME_TOKEN_UNAVAILABLE', statusCode: 503 }));
  });
});

describe('createRealtimeTokenService — legacy HS256 (yedek)', () => {
  it('legacy secret ile imzalı, kid başlığı yok', async () => {
    const { createRealtimeTokenService } = await load();
    const svc = createRealtimeTokenService({ legacySecret: 'legacy-secret', issuer: ISSUER, now: () => NOW });
    expect(svc.kind).toBe('hs256');
    const { token } = svc.issue(USER);
    const decoded = jwt.decode(token, { complete: true })!;
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.header.kid).toBeUndefined();
    const claims = jwt.verify(token, 'legacy-secret', { algorithms: ['HS256'], clockTimestamp: NOW / 1000 }) as jwt.JwtPayload;
    expect(claims).toMatchObject({ sub: USER, role: 'authenticated', aud: 'authenticated', iss: ISSUER });
  });

  it('boşluk-yalnız değerler tanımsız sayılır → kapalı, 503', async () => {
    const { createRealtimeTokenService } = await load();
    const svc = createRealtimeTokenService({ privateJwk: '  ', legacySecret: ' ', issuer: ISSUER });
    expect(svc.kind).toBe('disabled');
    expect(() => svc.issue(USER)).toThrow(expect.objectContaining({ statusCode: 503 }));
  });

  it('legacy secret API JWT sırrıyla aynıysa kapanır (token iki sistemde birden geçmesin)', async () => {
    const { createRealtimeTokenService } = await load();
    const svc = createRealtimeTokenService({
      legacySecret: 'test-access-secret', issuer: ISSUER, forbiddenSecrets: ['test-access-secret', 'x'],
    });
    expect(svc.kind).toBe('disabled');
  });
});

describe(`ayrışma: Realtime token API erişim token'ı değildir`, () => {
  it(`sunucunun verifyAccessToken'ı Realtime token'ını reddeder`, async () => {
    const { createRealtimeTokenService } = await load();
    const { verifyAccessToken } = await import('../../src/utils/jwt.js');
    const { token } = createRealtimeTokenService({ legacySecret: 'legacy-secret', issuer: ISSUER }).issue(USER);
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
