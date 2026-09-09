import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';

/**
 * Engelleme servisi — guvenlik ve veri izolasyonu yolu.
 *
 * En kritik davranis `isBlocked`'in CIFT YONLU olmasi: A, B'yi engellediyse
 * B de A'yi gormemeli. Tek yonlu olsaydi engellenen kisi engelleyeni kesifte
 * gormeye devam ederdi — engellemenin amaci tam olarak bu degil.
 *
 * Ikinci kritik davranis: engelleme ESLESMEYI DE pasiflestiriyor. Yoksa
 * engelledikten sonra sohbet acik kalirdi.
 *
 * Not: bu testler `fake-supabase`'in `.or()` icinde `and(...)` destegini
 * kullaniyor; o destek bu dosyayla birlikte helper'a eklendi (eskiden
 * `and(a` bir kolon adi saniliyor ve sorgu sessizce bos donuyordu).
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

async function setup(seed: Tables = {}, opts?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(
    { blocks: [], matches: [], users: [], ...seed },
    opts,
  );
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { blockService } = await import('../../src/services/block.service.js');
  return { fake, blockService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('block', () => {
  it('kaydi yazar ve satiri doner', async () => {
    const { fake, blockService } = await setup();

    const row = await blockService.block(A, B);

    expect(fake.table('blocks')).toHaveLength(1);
    expect(row).toMatchObject({ blocker_id: A, blocked_id: B });
  });

  it('kendini engelleme reddedilir ve hicbir satir yazilmaz', async () => {
    const { fake, blockService } = await setup();

    await expect(blockService.block(A, A)).rejects.toMatchObject({
      code: 'CANNOT_BLOCK_SELF',
    });
    expect(fake.table('blocks')).toHaveLength(0);
  });

  it('gecersiz uuid reddedilir — enjeksiyon yuzeyi kapali', async () => {
    // Bu degerler `.or()` ifadesine string olarak GOMULUYOR (satir 40, 63),
    // yani uuid dogrulamasi bir guvenlik kontrolu.
    const { blockService } = await setup();

    await expect(blockService.block("' OR 1=1--", B)).rejects.toBeTruthy();
  });

  it('ESLESMEYI de pasiflestirir — engelledikten sonra sohbet acik kalmasin', async () => {
    const { fake, blockService } = await setup({
      matches: [{ id: 'm1', user1_id: A, user2_id: B, is_active: true }],
    });

    await blockService.block(A, B);

    expect(fake.table('matches')[0].is_active).toBe(false);
  });

  it('eslesme TERS yonde kayitliysa da pasiflesir', async () => {
    // `and(user1.eq.A,user2.eq.B),and(user1.eq.B,user2.eq.A)` — cift yonlu.
    const { fake, blockService } = await setup({
      matches: [{ id: 'm1', user1_id: B, user2_id: A, is_active: true }],
    });

    await blockService.block(A, B);

    expect(fake.table('matches')[0].is_active).toBe(false);
  });

  it('BASKALARININ eslesmesine dokunmaz', async () => {
    const { fake, blockService } = await setup({
      matches: [
        { id: 'm1', user1_id: A, user2_id: B, is_active: true },
        { id: 'm2', user1_id: A, user2_id: C, is_active: true },
        { id: 'm3', user1_id: B, user2_id: C, is_active: true },
      ],
    });

    await blockService.block(A, B);

    const byId = Object.fromEntries(fake.table('matches').map((m) => [m.id, m.is_active]));
    expect(byId).toEqual({ m1: false, m2: true, m3: true });
  });

  it('zaten engellenmisse ALREADY_BLOCKED', async () => {
    const { blockService } = await setup({}, {
      failOn: [{ table: 'blocks', op: 'insert', error: { code: '23505', message: 'duplicate' } }],
    });

    await expect(blockService.block(A, B)).rejects.toMatchObject({
      code: 'ALREADY_BLOCKED',
    });
  });
});

describe('isBlocked — CIFT YONLU', () => {
  it('engelleyen icin true', async () => {
    const { blockService } = await setup({
      blocks: [{ id: 'b1', blocker_id: A, blocked_id: B }],
    });

    expect(await blockService.isBlocked(A, B)).toBe(true);
  });

  it('ENGELLENEN icin de true — tek yonlu olsaydi engellenen kisi engelleyeni gorurdu', async () => {
    // Asil guvenlik iddiasi bu.
    const { blockService } = await setup({
      blocks: [{ id: 'b1', blocker_id: A, blocked_id: B }],
    });

    expect(await blockService.isBlocked(B, A)).toBe(true);
  });

  it('ilgisiz cift icin false', async () => {
    const { blockService } = await setup({
      blocks: [{ id: 'b1', blocker_id: A, blocked_id: B }],
    });

    expect(await blockService.isBlocked(A, C)).toBe(false);
    expect(await blockService.isBlocked(B, C)).toBe(false);
  });

  it('hic engelleme yoksa false', async () => {
    const { blockService } = await setup();

    expect(await blockService.isBlocked(A, B)).toBe(false);
  });
});

describe('getBlockedIds / getBlockerIds — yonler AYRI', () => {
  it('getBlockedIds yalnizca BENIM engelledigim kisileri doner', async () => {
    const { blockService } = await setup({
      blocks: [
        { id: 'b1', blocker_id: A, blocked_id: B },
        { id: 'b2', blocker_id: C, blocked_id: A },
      ],
    });

    expect(await blockService.getBlockedIds(A)).toEqual([B]);
  });

  it('getBlockerIds yalnizca BENI engelleyenleri doner', async () => {
    // Iki yon ayri: kesif filtresi ikisini de kullaniyor ama farkli amaclarla.
    const { blockService } = await setup({
      blocks: [
        { id: 'b1', blocker_id: A, blocked_id: B },
        { id: 'b2', blocker_id: C, blocked_id: A },
      ],
    });

    expect(await blockService.getBlockerIds(A)).toEqual([C]);
  });

  it('bos liste doner, null degil', async () => {
    const { blockService } = await setup();

    expect(await blockService.getBlockedIds(A)).toEqual([]);
    expect(await blockService.getBlockerIds(A)).toEqual([]);
  });
});

describe('getBlockedUsers', () => {
  it('kullanici bilgisiyle birlestirir', async () => {
    const { blockService } = await setup({
      blocks: [{ id: 'b1', blocker_id: A, blocked_id: B, created_at: '2026-09-01T00:00:00Z' }],
      users: [{ id: B, name: 'Ada', photos: ['p1.jpg'] }],
    });

    const list = await blockService.getBlockedUsers(A);

    expect(list).toHaveLength(1);
    expect(list[0].user).toMatchObject({ id: B, name: 'Ada' });
  });

  it('kullanici satiri yoksa Unknown fallback — liste patlamaz', async () => {
    // Silinmis hesabi engellemis olabilirsin; ekran cokmemeli.
    const { blockService } = await setup({
      blocks: [{ id: 'b1', blocker_id: A, blocked_id: B, created_at: '2026-09-01T00:00:00Z' }],
      users: [],
    });

    const list = await blockService.getBlockedUsers(A);

    expect(list[0].user).toEqual({ id: B, name: 'Unknown', photos: [] });
  });

  it('hic engelleme yoksa bos liste', async () => {
    const { blockService } = await setup();

    expect(await blockService.getBlockedUsers(A)).toEqual([]);
  });
});
