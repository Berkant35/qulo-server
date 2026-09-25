import { describe, it, expect, vi } from 'vitest';
import { createFakeSupabase } from '../helpers/fake-supabase.js';

const NOW = new Date('2026-09-07T16:00:00.000Z');
const H = 3600 * 1000;

async function boot(campaigns: Array<Record<string, unknown>>, fcmAvailable = true) {
  vi.resetModules();
  // recurrence='none': tek seferlik kuyruk; daily kampanyalar ayri gondericide (campaign-recurring)
  const fake = createFakeSupabase({ campaigns: campaigns.map((c) => ({ recurrence: 'none', ...c })) });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client, ensureStorageBuckets: async () => {} }));
  vi.doMock('../../src/config/firebase.js', () => ({ getFcm: () => null, isFcmAvailable: () => fcmAvailable, firebaseAdmin: {} }));
  const { campaignService } = await import('../../src/services/campaign.service.js');
  return { fake, campaignService };
}

describe('campaignService.dispatchDueCampaigns', () => {
  it('sadece status=scheduled ve vadesi gelmis kampanyalar gonderilir', async () => {
    const { campaignService } = await boot([
      { id: 'c-due', status: 'scheduled', scheduled_at: new Date(NOW.getTime() - H).toISOString() },
      { id: 'c-future', status: 'scheduled', scheduled_at: new Date(NOW.getTime() + H).toISOString() },
      { id: 'c-draft', status: 'draft', scheduled_at: new Date(NOW.getTime() - H).toISOString() },
      { id: 'c-sent', status: 'sent', scheduled_at: new Date(NOW.getTime() - H).toISOString() },
    ]);
    const spy = vi.spyOn(campaignService, 'sendCampaign').mockResolvedValue({ totalSent: 1, totalDelivered: 1, totalTargeted: 1 });
    const r = await campaignService.dispatchDueCampaigns(NOW);
    expect(r).toEqual({ dispatched: ['c-due'], failed: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('c-due');
  });

  it('bir kampanya patlarsa digerleri yine gonderilir, patlayan failed listesine girer', async () => {
    const { campaignService } = await boot([
      { id: 'c1', status: 'scheduled', scheduled_at: new Date(NOW.getTime() - 2 * H).toISOString() },
      { id: 'c2', status: 'scheduled', scheduled_at: new Date(NOW.getTime() - H).toISOString() },
    ]);
    vi.spyOn(campaignService, 'sendCampaign')
      .mockRejectedValueOnce(new Error('FCM not configured'))
      .mockResolvedValueOnce({ totalSent: 1, totalDelivered: 1, totalTargeted: 1 });
    const r = await campaignService.dispatchDueCampaigns(NOW);
    expect(r.failed).toEqual(['c1']);
    expect(r.dispatched).toEqual(['c2']);
  });

  it('FCM yapilandirilmamissa hicbir kampanyaya dokunmaz (scheduled kalir, tek uyari)', async () => {
    const { fake, campaignService } = await boot(
      [{ id: 'c-due', status: 'scheduled', scheduled_at: new Date(NOW.getTime() - H).toISOString() }],
      false,
    );
    const spy = vi.spyOn(campaignService, 'sendCampaign');
    expect(await campaignService.dispatchDueCampaigns(NOW)).toEqual({ dispatched: [], failed: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(fake.table('campaigns')[0]!.status).toBe('scheduled');
  });

  it('tekrarlayan (daily) kampanya scheduled olsa da tek seferlik kuyruga girmez', async () => {
    const { campaignService } = await boot([
      { id: 'c-daily', status: 'scheduled', recurrence: 'daily', scheduled_at: null },
    ]);
    const spy = vi.spyOn(campaignService, 'sendCampaign');
    expect(await campaignService.dispatchDueCampaigns(NOW)).toEqual({ dispatched: [], failed: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('vadesi gelen yoksa hicbir gonderim yapilmaz', async () => {
    const { campaignService } = await boot([]);
    const spy = vi.spyOn(campaignService, 'sendCampaign');
    expect(await campaignService.dispatchDueCampaigns(NOW)).toEqual({ dispatched: [], failed: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});
