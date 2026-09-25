import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeRes() {
  const out: { path?: string; data?: Record<string, unknown> } = {};
  const res: any = {
    statusCode: 0,
    status(code: number) { this.statusCode = code; return this; },
    render(p: string, data?: Record<string, unknown>) { out.path = p; out.data = data; return this; },
  };
  return { res, out };
}

async function setup(row: Record<string, unknown> | null, submitSonuc = true) {
  const findAppeal = vi.fn().mockResolvedValue(row);
  const submitAppeal = vi.fn().mockResolvedValue(submitSonuc);
  vi.doMock('../../src/services/ban.service.js', () => ({
    banService: { findAppeal, submitAppeal }, APPEAL_MESSAGE_MAX: 1000,
  }));
  const mod = await import('../../src/routes/ban-appeal.routes.js');
  return { mod, findAppeal, submitAppeal };
}

beforeEach(() => vi.resetModules());

describe('GET /ban-appeal', () => {
  it('token yoksa 404 invalid, servis sorgulanmaz', async () => {
    const { mod, findAppeal } = await setup(null);
    const { res, out } = makeRes();
    await mod.banAppealFormHandler({ query: {} } as any, res);
    expect(res.statusCode).toBe(404);
    expect(out.path).toContain('invalid.ejs');
    expect(findAppeal).not.toHaveBeenCalled();
  });

  it('bilinmeyen token 404 invalid', async () => {
    const { mod } = await setup(null);
    const { res, out } = makeRes();
    await mod.banAppealFormHandler({ query: { token: 'x' } } as any, res);
    expect(res.statusCode).toBe(404);
    expect(out.path).toContain('invalid.ejs');
  });

  it('pending token formu token ve uzunluk siniriyla render eder', async () => {
    const { mod } = await setup({ token: 't1', status: 'pending' });
    const { res, out } = makeRes();
    await mod.banAppealFormHandler({ query: { token: ' t1 ' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(out.path).toContain('form.ejs');
    expect(out.data).toEqual({ token: 't1', maxLength: 1000 });
  });

  it('resolved token (unban edildi, itiraz yok) -> 404 invalid', async () => {
    const { mod } = await setup({ token: 't1', status: 'resolved' });
    const { res, out } = makeRes();
    await mod.banAppealFormHandler({ query: { token: 't1' } } as any, res);
    expect(res.statusCode).toBe(404);
    expect(out.path).toContain('invalid.ejs');
  });

  it('gonderilmis token submitted sayfasini gosterir', async () => {
    const { mod } = await setup({ token: 't1', status: 'submitted' });
    const { res, out } = makeRes();
    await mod.banAppealFormHandler({ query: { token: 't1' } } as any, res);
    expect(out.path).toContain('submitted.ejs');
  });
});

describe('POST /ban-appeal', () => {
  it('pending token: submitAppeal true -> submitted sayfasi, ek sorgu yok', async () => {
    const { mod, submitAppeal, findAppeal } = await setup({ token: 't1', status: 'pending' }, true);
    const { res, out } = makeRes();
    await mod.banAppealSubmitHandler({ body: { token: 't1', message: 'yanlislik var' } } as any, res);
    expect(submitAppeal).toHaveBeenCalledWith('t1', 'yanlislik var');
    expect(findAppeal).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(out.path).toContain('submitted.ejs');
  });

  it('gonderilmis token: submitAppeal false + kayit var -> yine submitted sayfasi (idempotent)', async () => {
    const { mod } = await setup({ token: 't1', status: 'submitted' }, false);
    const { res, out } = makeRes();
    await mod.banAppealSubmitHandler({ body: { token: 't1', message: 'tekrar' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(out.path).toContain('submitted.ejs');
  });

  it('token yok -> servis cagrilmadan 404; bilinmeyen token -> 404 invalid', async () => {
    const { mod, submitAppeal } = await setup(null, false);
    const { res, out } = makeRes();
    await mod.banAppealSubmitHandler({ body: {} } as any, res);
    expect(res.statusCode).toBe(404);
    expect(out.path).toContain('invalid.ejs');
    expect(submitAppeal).not.toHaveBeenCalled();
    await mod.banAppealSubmitHandler({ body: { token: 'yok' } } as any, res);
    expect(res.statusCode).toBe(404);
    expect(out.path).toContain('invalid.ejs');
  });

  it('servis hatasi asili istek degil, 500 invalid sayfasi', async () => {
    const { mod, submitAppeal } = await setup({ token: 't1', status: 'pending' });
    submitAppeal.mockRejectedValueOnce(new Error('db down'));
    const { res, out } = makeRes();
    await mod.banAppealSubmitHandler({ body: { token: 't1' } } as any, res);
    expect(res.statusCode).toBe(500);
    expect(out.path).toContain('invalid.ejs');
  });
});
