import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const REPORTER = 'u-reporter';
const OWNER = 'u-owner';
const QID = '22222222-2222-4222-8222-222222222222';
const RID = 'r-1';

function fakeRes() {
  const res: any = { redirectedTo: null as string | null, redirect(u: string) { res.redirectedTo = u; return res; } };
  return res;
}

async function setup() {
  const fake = createFakeSupabase({
    users: [
      { id: REPORTER, email: 'a@x.com', name: 'A', surname: 'A', photos: [], is_banned: false },
      { id: OWNER, email: 'b@x.com', name: 'B', surname: 'B', photos: [], is_banned: false },
    ],
    questions: [
      { id: QID, user_id: OWNER, order_num: 2, question_text: 'S', voice_path: `${OWNER}/v.m4a`, voice_duration_ms: 1000, image_path: `${OWNER}/i.jpg`, image_status: 'approved' },
    ],
    reports: [
      { id: RID, reporter_id: REPORTER, reported_id: OWNER, reason: 'x', category: 'INAPPROPRIATE_MEDIA', status: 'PENDING', question_id: QID, created_at: '2026-11-09T00:00:00Z' },
    ],
    matches: [],
    user_details: [],
  }, { storage: { 'question-media': [`${OWNER}/v.m4a`, `${OWNER}/i.jpg`] } });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { adminController } = await import('../../src/admin/admin.controller.js');
  const { adminService } = await import('../../src/admin/admin.service.js');
  return { fake, adminController, adminService };
}

beforeEach(() => vi.resetModules());

describe('rapor detayi — soru medyasi', () => {
  it('question_id varsa imzali URL ile soru medyasi doner', async () => {
    const { adminService } = await setup();
    const d = await adminService.getReportDetail(RID);
    expect(d?.question).toMatchObject({ id: QID, order_num: 2 });
    expect(d?.question?.voice_url).toEqual(expect.any(String));
    expect(d?.question?.image_url).toEqual(expect.any(String));
  });
});

describe('reportAction — remove_media', () => {
  it('voice: dosya silinir, yalniz o slot; ban cagrilmaz, durum degismez', async () => {
    const { fake, adminController } = await setup();
    const res = fakeRes();
    await adminController.reportAction({ params: { id: RID }, body: { remove_media: 'voice' }, session: {} } as never, res);
    const q = fake.table('questions')[0];
    expect(q.voice_path).toBeNull();
    expect(q.image_path).toBe(`${OWNER}/i.jpg`);
    expect(fake.storageFiles('question-media')).toEqual([`${OWNER}/i.jpg`]);
    expect(fake.table('users').find((u) => u.id === OWNER)!.is_banned).toBe(false);
    expect(fake.table('reports')[0].status).toBe('PENDING');
    expect(res.redirectedTo).toBe(`/admin/reports/${RID}`);
  });

  it('image: gorsel slotu temizlenir', async () => {
    const { fake, adminController } = await setup();
    await adminController.reportAction({ params: { id: RID }, body: { remove_media: 'image' }, session: {} } as never, fakeRes());
    expect(fake.table('questions')[0].image_path).toBeNull();
  });

  it('gecersiz remove_media degeri hicbir sey silmez', async () => {
    const { fake, adminController } = await setup();
    await adminController.reportAction({ params: { id: RID }, body: { remove_media: 'both' }, session: {} } as never, fakeRes());
    expect(fake.table('questions')[0].voice_path).toBe(`${OWNER}/v.m4a`);
    expect(fake.table('questions')[0].image_path).toBe(`${OWNER}/i.jpg`);
  });
});
