import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import { join } from 'node:path';
import { buildPagination } from '../../src/admin/utils/pagination.js';

/** user-detail.ejs gercek dosyadan render edilir; "Matches" bolumu, baglantilar ve bos durum. */
const VIEW = join(process.cwd(), 'src', 'admin', 'views', 'user-detail.ejs');
const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Ali', surname: 'Veli', email: 'ali@test.dev', photos: [], is_deleted: false };
const OTHER = '22222222-2222-4222-8222-222222222222';
const MATCH_ID = '66666666-6666-4666-8666-666666666666';

const row = (over: Record<string, unknown> = {}) => ({
  id: MATCH_ID, matched_at: '2026-01-05T10:00:00Z', is_active: true, unread_count: 3,
  other_id: OTHER, other_name: 'Ayse Yilmaz', other_photo: 'https://cdn.test/a1.jpg',
  other_is_seed: false, other_is_test: false, ...over,
});

const render = (locals: Record<string, unknown>) =>
  ejs.renderFile(VIEW, {
    user: USER, details: null, questions: [], swipeCount: 0, error: null,
    session: { adminId: 'adm1', adminRole: 'SUPER_ADMIN', adminEmail: 'a@qulo.test' }, csrfToken: 'tok',
    userMatches: [], matchesTotal: 0, matchesError: false,
    matchesPagination: buildPagination({ basePath: `/admin/users/${USER.id}`, page: 1, totalPages: 0, pageParam: 'matchesPage' }),
    ...locals,
  });

describe('user-detail.ejs — Matches bolumu', () => {
  it('baslik toplam sayiyi gosterir ve satirda karsi tarafin detay + eslesme baglantilari olur', async () => {
    const html = await render({ userMatches: [row()], matchesTotal: 1 });

    expect(html).toContain('Matches (1)');
    expect(html).toContain(`href="/admin/users/${OTHER}"`);
    expect(html).toContain(`href="/admin/matches/${MATCH_ID}"`);
    expect(html).toContain('Ayse Yilmaz');
    expect(html).toContain('badge-online');
    expect(html).toContain('src="https://cdn.test/a1.jpg"');
  });

  it('seed ve test hesap isaretleri satirda gorunur; pasif eslesme Inactive', async () => {
    const html = await render({
      userMatches: [row({ other_is_seed: true, other_is_test: true, is_active: false })],
      matchesTotal: 1,
    });

    expect(html).toContain('>Seed<');
    expect(html).toContain('>Test<');
    expect(html).toContain('>Inactive<');
  });

  it('eslesme yoksa bos durum metni; eslesme tablosu yok', async () => {
    const html = await render({});

    expect(html).toContain('Matches (0)');
    expect(html).toContain('This user has no matches.');
    expect(html).not.toContain('View Chat');
  });

  it('eslesme sorgusu hata verirse hata metni; kullanici detayi yine acilir', async () => {
    const html = await render({ matchesError: true });

    expect(html).toContain('Matches could not be loaded.');
    expect(html).toContain('Profile');
    expect(html).not.toContain('This user has no matches.');
  });

  it('sayfalama: ikinci sayfa baglantisi matchesPage kullanir ve diger sorgu parametrelerini korur', async () => {
    const pagination = buildPagination({
      basePath: `/admin/users/${USER.id}`, page: 1, totalPages: 3, pageParam: 'matchesPage',
      params: { error: 'x' },
    });
    const html = await render({ userMatches: [row()], matchesTotal: 45, matchesPagination: pagination });

    expect(html).toContain(`href="/admin/users/${USER.id}?matchesPage=2&amp;error=x"`);
    expect(html).not.toContain('?page=2');
  });
});
