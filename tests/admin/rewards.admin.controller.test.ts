import { describe, it, expect, beforeEach, vi } from 'vitest';

function fakeRes() {
  const res: any = {
    statusCode: 200,
    rendered: null as null | { view: string; locals: any },
    redirectedTo: null as string | null,
    status(code: number) { res.statusCode = code; return res; },
    render(view: string, locals: any) { res.rendered = { view, locals }; return res; },
    redirect(url: string) { res.redirectedTo = url; return res; },
  };
  return res;
}

/** Geçerli talep/ürün kimliği (admin `:id` parametresi uuid olmalı). */
const RID = '6b3f2a1e-9c4d-4e5f-8a7b-1c2d3e4f5a6b';

const req = (over: Record<string, unknown> = {}) =>
  ({ params: {}, query: {}, body: {}, session: { adminId: 'adm1', adminRole: 'SUPER_ADMIN', csrfToken: 't' }, ...over }) as any;

async function setup(service: Record<string, unknown> = {}) {
  const { AppError } = await import('../../src/utils/errors.js');
  // İki servis (katalog + kuyruk) tek düz nesnede: test yalnız override ettiği metodu verir.
  const rewardsAdminService = {
    listCountries: vi.fn(async () => [{ country_code: 'TH', currency: 'THB', enabled: false, android_enabled: true, ios_enabled: false, updated_at: null }]),
    getSummary: vi.fn(async () => ({ pending: 2, fulfilledThisMonth: 0, rainbowFulfilledThisMonth: 0, rainbowInCirculation: 0, estimatedLiabilityUsd: 0, flaggedUsers: 0 })),
    updateCountry: vi.fn(async () => {}),
    listCatalog: vi.fn(async () => ({ items: [{ id: 'a', cost_usd: 1.51, rainbow_price: 60 }, { id: 'b', cost_usd: null, rainbow_price: 20 }], total: 2, page: 1, pageSize: 50 })),
    getCatalogItem: vi.fn(async () => null),
    createCatalogItem: vi.fn(async () => ({})),
    updateCatalogItem: vi.fn(async () => {}),
    setCatalogActive: vi.fn(async () => {}),
    softDeleteCatalogItem: vi.fn(async () => {}),
    listRedemptions: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 30 })),
    fulfill: vi.fn(async () => {}),
    reject: vi.fn(async () => ({ refunded: true })),
    ...service,
  };
  vi.doMock('../../src/services/rewards-catalog-admin.service.js', () => ({ rewardsCatalogAdminService: rewardsAdminService }));
  vi.doMock('../../src/services/rewards-queue.service.js', () => ({ rewardsQueueService: rewardsAdminService }));
  vi.doMock('../../src/services/economy-config.service.js', () => ({
    economyConfigService: {
      getConfig: vi.fn(async () => ({
        rainbow: { suggestedUsdPerRainbow: 0.03, monthlyRedeemCap: 150, minAccountAgeDays: 30, subscriptionPaidShare: { free: 0, plus: 0.3, premium: 0.2 } },
      })),
    },
  }));
  const { rewardsAdminController } = await import('../../src/admin/rewards.admin.controller.js');
  return { rewardsAdminController, rewardsAdminService, AppError };
}

beforeEach(() => {
  vi.resetModules();
});

describe('Rainbow Market yetkisi', () => {
  it('alt router ilk katmanı superAdminOnly (teslim kodları nakit değerinde)', async () => {
    await setup();
    const { default: rewardsRoutes } = await import('../../src/admin/rewards.admin.routes.js');
    const { superAdminOnly } = await import('../../src/admin/admin.middleware.js');
    const stack = (rewardsRoutes as unknown as { stack: Array<{ handle: unknown }> }).stack;
    expect(stack[0].handle).toBe(superAdminOnly);
  });
});

describe('ülkeler sayfası', () => {
  it('ülkeler, özet ve kurallar render edilir; ?error= kodu mesaja çevrilir, bilinmeyen kod yok sayılır', async () => {
    const { rewardsAdminController } = await setup();
    const res = fakeRes();
    await rewardsAdminController.countries(req({ query: { error: 'failed' } }), res);

    expect(res.rendered.view).toBe('rewards-countries');
    expect(res.rendered.locals.countries).toHaveLength(1);
    expect(res.rendered.locals.summary.pending).toBe(2);
    expect(res.rendered.locals.rules.monthlyRedeemCap).toBe(150);
    expect(res.rendered.locals.error).toMatch(/başarısız/);

    const res2 = fakeRes();
    await rewardsAdminController.countries(req({ query: { error: 'constructor' } }), res2);
    expect(res2.rendered.locals.error).toBeNull(); // prototip üyesi mesaj sayılmaz
  });

  it('anahtar formu: kod büyük harfe, işaretsiz kutu false; başarı notice=saved', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.updateCountry(req({ params: { code: 'th' }, body: { enabled: 'on' } }), res);

    expect(rewardsAdminService.updateCountry).toHaveBeenCalledWith('TH', { enabled: true, android_enabled: false, ios_enabled: false });
    expect(res.redirectedTo).toBe('/admin/rewards?notice=saved');
  });

  it('servis VALIDATION_ERROR → ?error=invalid_input', async () => {
    const { AppError } = await import('../../src/utils/errors.js');
    const { rewardsAdminController } = await setup({
      updateCountry: vi.fn(async () => { throw new AppError('VALIDATION_ERROR', 400); }),
    });
    const res = fakeRes();
    await rewardsAdminController.updateCountry(req({ params: { code: 'SG' }, body: {} }), res);
    expect(res.redirectedTo).toBe('/admin/rewards?error=invalid_input');
  });
});

describe('katalog', () => {
  it('liste satırlarına önerilen fiyat eklenir (maliyet yoksa null); bozuk filtre varsayılana düşer', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.catalogList(req({ query: { brand: 'UBER', status: '?' } }), res);

    expect(rewardsAdminService.listCatalog).toHaveBeenCalledWith({ status: 'all', page: 1 });
    expect(res.rendered.locals.items.map((i: any) => i.suggested_price)).toEqual([51, null]);
  });

  it('geçersiz form: servis çağrılmaz, form girilen değerlerle 400 ile yeniden gösterilir', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.catalogCreate(
      req({ body: { brand_key: 'GRAB', country_code: 'TH', face_value: '0', rainbow_price: '51' } }),
      res,
    );

    expect(rewardsAdminService.createCatalogItem).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.rendered.view).toBe('rewards-catalog-edit');
    expect(res.rendered.locals.item).toMatchObject({ brand_key: 'GRAB', face_value: '0' });
    expect(res.rendered.locals.error).toMatch(/face_value/);
  });

  it('geçerli form: tiplenmiş veriyle oluşturulur, listeye döner', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.catalogCreate(
      req({ body: { brand_key: 'GRAB', country_code: 'TH', face_value: '50', cost_usd: '1.51', rainbow_price: '51', is_active: 'on' } }),
      res,
    );
    expect(rewardsAdminService.createCatalogItem).toHaveBeenCalledWith(expect.objectContaining({ face_value: 50, rainbow_price: 51, is_active: true }));
    expect(res.redirectedTo).toBe('/admin/rewards/catalog?notice=saved');
  });

  it('aktiflik formu istenen durumu gönderir (active=0 → false)', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.catalogSetActive(req({ params: { id: RID }, body: { active: '0' } }), res);
    expect(rewardsAdminService.setCatalogActive).toHaveBeenCalledWith(RID, false);
  });
});

describe('talepler', () => {
  it('kod da link de yoksa teslim formu servise gitmez', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.fulfill(req({ params: { id: RID }, body: { delivery_code: ' ' } }), res);
    expect(rewardsAdminService.fulfill).not.toHaveBeenCalled();
    expect(res.redirectedTo).toBe('/admin/rewards/redemptions?error=invalid_input');
  });

  it('teslim: admin kimliğiyle çağrılır; zaten sonuçlanmışsa ?error=already_decided', async () => {
    const { AppError } = await import('../../src/utils/errors.js');
    const { rewardsAdminController, rewardsAdminService } = await setup({
      fulfill: vi.fn(async () => { throw new AppError('REWARD_ALREADY_DECIDED', 409); }),
    });
    const res = fakeRes();
    await rewardsAdminController.fulfill(req({ params: { id: RID }, body: { delivery_code: 'GRAB-1' } }), res);

    expect(rewardsAdminService.fulfill).toHaveBeenCalledWith(RID, expect.objectContaining({ delivery_code: 'GRAB-1' }), 'adm1');
    expect(res.redirectedTo).toBe('/admin/rewards/redemptions?error=already_decided');
  });

  it('ret iadesi yazılamazsa ?error=refund_failed', async () => {
    const { AppError } = await import('../../src/utils/errors.js');
    const { rewardsAdminController } = await setup({
      reject: vi.fn(async () => { throw new AppError('REWARD_REFUND_FAILED', 500); }),
    });
    const res = fakeRes();
    await rewardsAdminController.reject(req({ params: { id: RID }, body: { reject_reason: 'stok yok' } }), res);
    expect(res.redirectedTo).toBe('/admin/rewards/redemptions?error=refund_failed');
  });

  it('beklenmeyen hata loglanır, ?error=failed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rewardsAdminController } = await setup({ reject: vi.fn(async () => { throw new Error('boom'); }) });
    const res = fakeRes();
    await rewardsAdminController.reject(req({ params: { id: RID }, body: { reject_reason: 'x' } }), res);
    expect(res.redirectedTo).toBe('/admin/rewards/redemptions?error=failed');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('ret: iade yazıldıysa notice=rejected; iade yoksa (hesap silinmiş / zaten iade edilmiş) notice=rejected_no_refund', async () => {
    const { rewardsAdminController } = await setup();
    const res = fakeRes();
    await rewardsAdminController.reject(req({ params: { id: RID }, body: { reject_reason: 'stok yok' } }), res);
    expect(res.redirectedTo).toBe('/admin/rewards/redemptions?notice=rejected');

    vi.resetModules(); // ikinci servis mock'u yeni controller örneğine girsin
    const { rewardsAdminController: c2 } = await setup({ reject: vi.fn(async () => ({ refunded: false })) });
    const res2 = fakeRes();
    await c2.reject(req({ params: { id: RID }, body: { reject_reason: 'stok yok' } }), res2);
    expect(res2.redirectedTo).toBe('/admin/rewards/redemptions?notice=rejected_no_refund');
  });

  it('teslim: rainbow zaten iade edilmişse ?error=already_refunded; hesap kalıcı silinmişse ?error=account_deleted', async () => {
    const { AppError } = await import('../../src/utils/errors.js');
    const { rewardsAdminController } = await setup({
      fulfill: vi.fn(async () => { throw new AppError('REWARD_ALREADY_REFUNDED', 409); }),
    });
    const res = fakeRes();
    await rewardsAdminController.fulfill(req({ params: { id: RID }, body: { delivery_code: 'GRAB-1' } }), res);
    expect(res.redirectedTo).toBe('/admin/rewards/redemptions?error=already_refunded');

    vi.resetModules(); // ikinci servis mock'u yeni controller örneğine girsin
    const { AppError: AppError2 } = await import('../../src/utils/errors.js');
    const { rewardsAdminController: c2 } = await setup({
      fulfill: vi.fn(async () => { throw new AppError2('REWARD_ACCOUNT_PURGED', 403); }),
    });
    const res2 = fakeRes();
    await c2.fulfill(req({ params: { id: RID }, body: { delivery_code: 'GRAB-1' } }), res2);
    expect(res2.redirectedTo).toBe('/admin/rewards/redemptions?error=account_deleted');
  });

  it('yeni ekran mesajları tanımlı (bilinmeyen kod gösterilmez kuralı bunları yutmasın)', async () => {
    const { REWARDS_ERRORS, REWARDS_NOTICES } = await import('../../src/admin/rewards.admin.controller.js');
    expect(REWARDS_ERRORS.already_refunded).toBe("Bu talebin Rainbow'u zaten iade edilmiş — teslim etme, reddet.");
    expect(REWARDS_NOTICES.rejected_no_refund).toBe(
      'Talep reddedildi (iade yok: hesap silinmiş ya da Rainbow zaten iade edilmiş).',
    );
  });

  it('liste: aylık tavan görünüme gider (tavan aşımı rozeti), kullanıcı filtresi servise geçer', async () => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await rewardsAdminController.redemptions(req({ query: { status: 'ALL', user: RID } }), res);

    expect(res.rendered.view).toBe('rewards-redemptions');
    expect(res.rendered.locals.monthlyCap).toBe(150);
    expect(rewardsAdminService.listRedemptions).toHaveBeenCalledWith(expect.objectContaining({ status: 'ALL', user: RID }));
  });
});

describe('admin :id parametresi (uuid değilse servis çağrılmaz)', () => {
  it.each([
    ['catalogEdit', {}, 'getCatalogItem', '/admin/rewards/catalog?error=item_unavailable'],
    ['catalogUpdate', { brand_key: 'GRAB', country_code: 'TH', face_value: '50', rainbow_price: '51' }, 'updateCatalogItem', '/admin/rewards/catalog?error=item_unavailable'],
    ['catalogSetActive', { active: '1' }, 'setCatalogActive', '/admin/rewards/catalog?error=item_unavailable'],
    ['catalogDelete', {}, 'softDeleteCatalogItem', '/admin/rewards/catalog?error=item_unavailable'],
    ['fulfill', { delivery_code: 'GRAB-1' }, 'fulfill', '/admin/rewards/redemptions?error=not_found'],
    ['reject', { reject_reason: 'stok yok' }, 'reject', '/admin/rewards/redemptions?error=not_found'],
  ] as const)('%s: bozuk id → yönlendirme, servis çağrılmaz', async (action, body, serviceMethod, target) => {
    const { rewardsAdminController, rewardsAdminService } = await setup();
    const res = fakeRes();
    await (rewardsAdminController[action] as (rq: unknown, rs: unknown) => Promise<void>)(
      req({ params: { id: "1' or '1'='1" }, body }),
      res,
    );
    expect(res.redirectedTo).toBe(target);
    expect(rewardsAdminService[serviceMethod]).not.toHaveBeenCalled();
  });
});
