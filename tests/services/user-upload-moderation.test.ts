import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

/**
 * Fotograf yukleme -> cinsel icerik taramasi yukleme aninda tetiklenir (cron beklenmez),
 * ama yukleme cevabi taramayi BEKLEMEZ ve tarama hatasi yuklemeyi bozmaz.
 */
const U1 = '11111111-1111-4111-8111-111111111111';
/** Gercek (kucuk) PNG: yukleme artik icerigi cozup JPEG'e normalize ediyor; sahte bayt 400 alir. */
const PNG = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#c33' } }).png().toBuffer();

async function setup(moderasyon: () => Promise<unknown>) {
  const fake = createFakeSupabase({ users: [{ id: U1, photos: [], is_deleted: false }] });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const moderateUploadedPhoto = vi.fn(moderasyon);
  vi.doMock('../../src/services/photo-moderation.service.js', () => ({ moderateUploadedPhoto }));
  const { userService } = await import('../../src/services/user.service.js');
  return { userService, fake, moderateUploadedPhoto };
}

beforeEach(() => vi.resetModules());

describe('uploadPhoto -> moderateUploadedPhoto', () => {
  it('yuklenen URL ile taramayi tetikler, cevap taramayi beklemez', async () => {
    let cozuldu = false;
    const { userService, moderateUploadedPhoto } = await setup(() => new Promise((r) => setTimeout(() => { cozuldu = true; r(null); }, 50)));
    const r = await userService.uploadPhoto(U1, await PNG());
    expect(moderateUploadedPhoto).toHaveBeenCalledWith(U1, r.url);
    expect(cozuldu).toBe(false);
    expect(r.photos).toEqual([r.url]);
  });

  it('tarama reddedilse bile yukleme basarili', async () => {
    const { userService } = await setup(() => Promise.reject(new Error('nim down')));
    const r = await userService.uploadPhoto(U1, await PNG());
    expect(r.url).toContain(U1);
  });
});
