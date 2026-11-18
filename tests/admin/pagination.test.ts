import { describe, it, expect } from 'vitest';
import ejs from 'ejs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPageWindow, buildPagination, buildPageHref } from '../../src/admin/utils/pagination.js';

const VIEWS = join(process.cwd(), 'src', 'admin', 'views');
const PARTIAL = join(VIEWS, '_pagination.ejs');

/** Partial'ı gerçek dosyadan render eder; bağlantıları `<a …>…</a>` parçalarına böler. */
async function renderLinks(model: ReturnType<typeof buildPagination>) {
  const html = await ejs.renderFile(PARTIAL, { pagination: model });
  const anchors = [...html.matchAll(/<a href="([^"]*)"(?: class="([^"]*)")?>([^<]*)<\/a>/g)].map(
    ([, href, cls, text]) => ({ href, active: cls === 'active', text }),
  );
  return { html, anchors, numbers: anchors.filter((a) => /^\d+$/.test(a.text)) };
}

describe('buildPageWindow — kenar durumları', () => {
  it('totalPages 0: sayfalama yok, sayfa numarası yok', () => {
    const w = buildPageWindow(1, 0);
    expect(w.visible).toBe(false);
    expect(w.pages).toEqual([]);
    expect(w.prevBlock).toBeNull();
    expect(w.nextBlock).toBeNull();
  });

  it('totalPages 1: sayfalama basılmaz', () => {
    const w = buildPageWindow(1, 1);
    expect(w.visible).toBe(false);
    expect(w.pages).toEqual([]);
  });

  it('ilk blok: 1–5, önceki blok yok, sonraki blok 6', () => {
    const w = buildPageWindow(1, 37);
    expect(w.visible).toBe(true);
    expect(w.pages).toEqual([1, 2, 3, 4, 5]);
    expect(w.prevBlock).toBeNull();
    expect(w.nextBlock).toBe(6);
    expect(w.prev).toBeNull();
    expect(w.next).toBe(2);
    expect(w.first).toBe(1);
    expect(w.last).toBe(37);
  });

  it('blok sınırı: geçerli 5 hâlâ ilk blokta, 6 ikinci bloğa geçer', () => {
    expect(buildPageWindow(5, 37).pages).toEqual([1, 2, 3, 4, 5]);
    const w = buildPageWindow(6, 37);
    expect(w.pages).toEqual([6, 7, 8, 9, 10]);
    expect(w.prevBlock).toBe(1);
    expect(w.nextBlock).toBe(11);
  });

  it('son blok eksik: 36–37, sonraki blok yok', () => {
    const w = buildPageWindow(37, 37);
    expect(w.pages).toEqual([36, 37]);
    expect(w.prevBlock).toBe(31);
    expect(w.nextBlock).toBeNull();
    expect(w.next).toBeNull();
  });

  it('currentPage sınır dışıysa sınırlara kırpılır', () => {
    expect(buildPageWindow(0, 37).current).toBe(1);
    expect(buildPageWindow(-3, 37).current).toBe(1);
    expect(buildPageWindow(99, 37).current).toBe(37);
    expect(buildPageWindow(Number.NaN, 37).current).toBe(1);
  });

  it('windowSize parametresi bloğu değiştirir', () => {
    const w = buildPageWindow(4, 7, 3);
    expect(w.pages).toEqual([4, 5, 6]);
    expect(w.prevBlock).toBe(1);
    expect(w.nextBlock).toBe(7);
  });
});

describe('buildPagination — bağlantılar', () => {
  it('mevcut sorgu parametrelerini korur ve değerleri kaçışlar', () => {
    const m = buildPagination({
      basePath: '/admin/users', page: 2, totalPages: 3,
      params: { search: 'a b&c', gender: '', days: 30 },
    });
    expect(m.pages[0].href).toBe('/admin/users?page=1&search=a%20b%26c&gender=&days=30');
    expect(buildPageHref('/admin/x', 4, { status: null, q: undefined })).toBe('/admin/x?page=4&status=&q=');
  });

  it('geçerli sayfa aktif işaretlenir', () => {
    const m = buildPagination({ basePath: '/admin/blocks', page: 3, totalPages: 4 });
    expect(m.pages.map((p) => [p.page, p.active])).toEqual([[1, false], [2, false], [3, true], [4, false]]);
  });
});

describe('_pagination.ejs — gerçek dosyadan render', () => {
  it('37 sayfa, sayfa 20: en fazla 5 numara, 16–20 arası, 20 aktif', async () => {
    const { numbers, html } = await renderLinks(buildPagination({
      basePath: '/admin/users', page: 20, totalPages: 37,
      params: { search: 'ayse', gender: 'F' },
    }));
    expect(numbers.map((a) => a.text)).toEqual(['16', '17', '18', '19', '20']);
    expect(numbers.find((a) => a.active)?.text).toBe('20');
    expect(numbers.filter((a) => a.active)).toHaveLength(1);
    expect(html).toContain('« İlk');
    expect(html).toContain('‹ Önceki 5');
    expect(html).toContain('Sonraki 5 ›');
    expect(html).toContain('Son »');
  });

  it('sorgu parametreleri tüm bağlantılarda korunur', async () => {
    const { anchors } = await renderLinks(buildPagination({
      basePath: '/admin/transactions', page: 20, totalPages: 37,
      params: { type: 'diamond', userId: 'u-1' },
    }));
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a.href).toContain('type=diamond');
      expect(a.href).toContain('userId=u-1');
      expect(a.href).toMatch(/^\/admin\/transactions\?page=\d+/);
    }
  });

  it('ilk sayfada « ve ‹ yok, son blok 6 bağlantısı ile başlar', async () => {
    const { html, numbers } = await renderLinks(buildPagination({ basePath: '/admin/blocks', page: 1, totalPages: 37 }));
    expect(numbers.map((a) => a.text)).toEqual(['1', '2', '3', '4', '5']);
    expect(html).not.toContain('« İlk');
    expect(html).not.toContain('‹ Önceki');
    expect(html).toContain('Sonraki 5 ›');
  });

  it('tek sayfada hiçbir şey basılmaz', async () => {
    const { html } = await renderLinks(buildPagination({ basePath: '/admin/blocks', page: 1, totalPages: 1 }));
    expect(html.trim()).toBe('');
  });
});

describe('görünümler — döngü yerine ortak parça', () => {
  const views = readdirSync(VIEWS).filter((f) => f.endsWith('.ejs') && f !== '_pagination.ejs');
  const paged = views.filter((f) => readFileSync(join(VIEWS, f), 'utf8').includes('totalPages'));

  it('sayfalı görünümler var (test boş geçmesin)', () => {
    expect(paged.length).toBeGreaterThanOrEqual(13);
  });

  // question-bank sayfalamayı istemci tarafında (renderPagination JS) çizer; ayrı iş kalemidir.
  it.each(paged.filter((f) => f !== 'question-bank.ejs'))('%s: _pagination parçasını kullanır, tüm sayfa döngüsü yok', (file) => {
    const html = readFileSync(join(VIEWS, file), 'utf8');
    expect(html).toContain("include('_pagination'");
    expect(html).not.toMatch(/<=\s*(Math\.min\()?totalPages/);
  });
});

describe('pageParam — ayni sayfada iki sayfalama (kullanici detayi: matchesPage)', () => {
  it('varsayilan anahtar page; pageParam verilirse yalniz o anahtar degisir, diger parametreler korunur', () => {
    expect(buildPageHref('/admin/users/x', 2, { error: 'e' })).toBe('/admin/users/x?page=2&error=e');
    expect(buildPageHref('/admin/users/x', 2, { error: 'e' }, 'matchesPage')).toBe('/admin/users/x?matchesPage=2&error=e');
  });

  it('buildPagination pageParam ile bloklarin tum bağlantılarında matchesPage üretir', () => {
    const model = buildPagination({ basePath: '/admin/users/x', page: 6, totalPages: 12, pageParam: 'matchesPage' });
    expect(model.prevBlock?.href).toBe('/admin/users/x?matchesPage=1');
    expect(model.pages[0].href).toBe('/admin/users/x?matchesPage=6');
    expect(model.last?.href).toBe('/admin/users/x?matchesPage=12');
    expect(model.pages.every((p) => p.href.includes('matchesPage='))).toBe(true);
  });
});
