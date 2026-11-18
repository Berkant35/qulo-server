/**
 * Admin listelerinin sayfalama mantığı (saf fonksiyonlar, I/O yok).
 *
 * Sayfa numaraları `windowSize`'lık bloklarla gösterilir: 1–5, 6–10, … Geçerli sayfanın bloğu
 * basılır; blok dışına "önceki/sonraki blok" ve "ilk/son" bağlantıları ile çıkılır.
 */

export const DEFAULT_WINDOW_SIZE = 5;

export interface PageWindow {
  /** Sınırlara kırpılmış geçerli sayfa (1..totalPages; sayfa yoksa 1). */
  current: number;
  totalPages: number;
  /** Sayfalama yalnız totalPages > 1 iken basılır. */
  visible: boolean;
  /** Geçerli bloktaki sayfa numaraları (son blok eksik olabilir). */
  pages: number[];
  /** Önceki bloğun ilk sayfası; önceki blok yoksa null. */
  prevBlock: number | null;
  /** Sonraki bloğun ilk sayfası; sonraki blok yoksa null. */
  nextBlock: number | null;
  /** Bir önceki sayfa; ilk sayfadaysa null. */
  prev: number | null;
  /** Bir sonraki sayfa; son sayfadaysa null. */
  next: number | null;
  first: number;
  last: number;
}

function toInt(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

export function buildPageWindow(
  currentPage: number,
  totalPages: number,
  windowSize: number = DEFAULT_WINDOW_SIZE,
): PageWindow {
  const size = Math.max(1, toInt(windowSize, DEFAULT_WINDOW_SIZE));
  const total = Math.max(0, toInt(totalPages, 0));
  const visible = total > 1;
  if (!visible) {
    return {
      current: 1, totalPages: total, visible: false, pages: [],
      prevBlock: null, nextBlock: null, prev: null, next: null,
      first: 1, last: total,
    };
  }
  const current = Math.min(Math.max(1, toInt(currentPage, 1)), total);
  const blockStart = Math.floor((current - 1) / size) * size + 1;
  const blockEnd = Math.min(blockStart + size - 1, total);
  const pages: number[] = [];
  for (let p = blockStart; p <= blockEnd; p++) pages.push(p);
  return {
    current,
    totalPages: total,
    visible,
    pages,
    prevBlock: blockStart > 1 ? blockStart - size : null,
    nextBlock: blockStart + size <= total ? blockStart + size : null,
    prev: current > 1 ? current - 1 : null,
    next: current < total ? current + 1 : null,
    first: 1,
    last: total,
  };
}

export type QueryParams = Record<string, string | number | null | undefined>;

export interface PageLink {
  page: number;
  href: string;
}

export interface PaginationModel {
  visible: boolean;
  windowSize: number;
  current: number;
  first: PageLink | null;
  prevBlock: PageLink | null;
  pages: Array<PageLink & { active: boolean }>;
  nextBlock: PageLink | null;
  last: PageLink | null;
}

/** `basePath?page=N&k=v…` (sayfa anahtarı `pageParam` ile değişir) — mevcut sorgu parametreleri aynen korunur. */
export function buildPageHref(basePath: string, page: number, params: QueryParams = {}, pageParam = 'page'): string {
  const query = [`${encodeURIComponent(pageParam)}=${page}`];
  for (const [key, value] of Object.entries(params)) {
    query.push(`${encodeURIComponent(key)}=${encodeURIComponent(value == null ? '' : String(value))}`);
  }
  return `${basePath}?${query.join('&')}`;
}

/** Görünümlerin partial'a verdiği hazır model: her bağlantının href'i dahil. */
export function buildPagination(options: {
  basePath: string;
  page: number;
  totalPages: number;
  params?: QueryParams;
  windowSize?: number;
  /** Sayfa numarasının sorgu anahtarı; aynı sayfada birden çok sayfalama varsa ayrılır (varsayılan `page`). */
  pageParam?: string;
}): PaginationModel {
  const win = buildPageWindow(options.page, options.totalPages, options.windowSize);
  const size = Math.max(1, toInt(options.windowSize ?? DEFAULT_WINDOW_SIZE, DEFAULT_WINDOW_SIZE));
  const link = (page: number): PageLink => ({
    page,
    href: buildPageHref(options.basePath, page, options.params, options.pageParam),
  });
  if (!win.visible) {
    return { visible: false, windowSize: size, current: win.current, first: null, prevBlock: null, pages: [], nextBlock: null, last: null };
  }
  return {
    visible: true,
    windowSize: size,
    current: win.current,
    first: win.current > 1 ? link(win.first) : null,
    prevBlock: win.prevBlock !== null ? link(win.prevBlock) : null,
    pages: win.pages.map((p) => ({ ...link(p), active: p === win.current })),
    nextBlock: win.nextBlock !== null ? link(win.nextBlock) : null,
    last: win.current < win.totalPages ? link(win.last) : null,
  };
}
