/**
 * Bellek içi Supabase test double'ı.
 *
 * Neden var: servislerin %90'ı `config/supabase`'i doğrudan import ediyor (DI yok),
 * bu yüzden her test dosyası kendi query-builder taklidini yazıyordu — servis başına
 * ~50 satır boilerplate. Zincire yeni bir `.order()` eklendiğinde de sessizce kırılıyordu.
 *
 * Buradaki yaklaşım cevap script'lemek DEĞİL, küçük bir tablo deposu modellemek:
 * test gerçek satırlarla başlar, servisi çağırır, satırların son hâlini doğrular.
 * `.gte()` guard'ı (compare-and-swap) gibi davranışlar da böylece gerçekten test edilir.
 * `interleave` CAS yarışını simüle eder — update anında satır değiştirerek (bkz. `FakeSupabaseOptions.interleave`).
 *
 * Kapsam bilinçli olarak dar: sadece kod tabanının gerçekten kullandığı operasyonlar.
 * Yeni bir zincir gerekince buraya eklenir — spekülatif genellik yok.
 */

export type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export interface SupabaseError {
  message: string;
  code?: string;
}

/** Hangi tablo+operasyonun hata döneceği — hata dallarını test etmek için. */
export interface FailureSpec {
  table: string;
  /** `upsert` da `insert` olarak hedeflenir. */
  op: 'select' | 'update' | 'insert' | 'delete';
  error?: SupabaseError;
  /**
   * Kaç başarılı çağrıdan SONRA patlasın (varsayılan 0 = hemen).
   * Çok adımlı akışların ortasını hedeflemek için: aynı tabloya iki kez yazan bir
   * metodun sadece ikinci yazımını bozup ilkinin geri alınmadığını gösterebilmek gerekiyor.
   */
  failAfter?: number;
  /**
   * Kaç çağrı patlasın (varsayılan: `failAfter`'dan sonrakilerin hepsi) — `StorageFailureSpec.times` gibi.
   * "İlk deneme hata, tek yeniden deneme başarılı" dalı için (ör. itfa insert'ünde FK 23503 → kaynaksız tekrar).
   */
  times?: number;
  /**
   * İşlem UYGULANIR ama hata döner (commit edildi, cevap yolda kayboldu) — belirsiz yazım
   * dallarını sınamak için. Varsayılan false: eski davranış (hiçbir şey yazılmadan hata döner).
   */
  committed?: boolean;
}

/** Depolama hata enjeksiyonu — `FailureSpec`'in storage karşılığı. */
export interface StorageFailureSpec {
  bucket: string;
  op: 'list' | 'remove' | 'upload';
  error?: SupabaseError;
  /** Kaç başarılı çağrıdan SONRA patlasın (varsayılan 0 = hemen). */
  failAfter?: number;
  /** Kaç çağrı patlasın (varsayılan: sonrakilerin hepsi) — tek bir klasörün hatasını hedeflemek için. */
  times?: number;
}

export interface FakeSupabaseOptions {
  failOn?: FailureSpec[];
  /**
   * Tablo basina benzersiz kisitlar: tek kolon (`{ campaign_events: ['dedupe_key'] }`) ya da bilesik
   * anahtar (`{ reward_redemptions: ['user_id,idempotency_key'] }`). Ayni degerle ikinci insert Postgres
   * gibi `23505` doner; anahtarin herhangi bir kolonu NULL/undefined ise kisita takilmaz.
   * Claim-then-send desenleri boyle sinanir.
   */
  unique?: Record<string, string[]>;
  /** rpc(name, args) çağrılarına verilecek cevaplar. */
  rpc?: Record<string, { data?: unknown; error?: SupabaseError }>;
  /** Başlangıçtaki depolama dosyaları: `{ photos: ['user-id/a.jpg'] }`. */
  storage?: Record<string, string[]>;
  /** Depolama hata enjeksiyonu (bkz. `StorageFailureSpec`). */
  storageFailOn?: StorageFailureSpec[];
  /**
   * Eşzamanlı yazma (compare-and-swap yarışı) sınamak için: `update()` çağrıldığı anda,
   * sorgu çalışmadan ÖNCE tablonun satırlarını değiştirir — servis okuduktan sonra başka
   * bir istek araya girmiş gibi. `times` kadar tetiklenir (varsayılan 1).
   * `op: 'select'`: tetik `select()` anında — iki okuma arasına giren yazımı (ör. ön kontrol boş
   * gördükten sonra aynı anahtarlı talebin yazılması) sınamak için. Varsayılan `'update'`.
   */
  interleave?: Array<{ table: string; op?: 'update' | 'select'; mutate: (rows: Row[]) => void; times?: number }>;
  /**
   * Okuma-yazma yarışı için: tablonun İLK `select`'i sonucunu çağrı anında hesaplar (anlık görüntü)
   * ama cevabı `until` çözülene kadar teslim etmez. Okuma sürerken araya giren yazım ve geç dönen
   * ESKİ sonuç böyle modellenir (ör. ban anında süren önbellek dolumu, 2026-09-28).
   */
  holdRead?: { table: string; until: Promise<unknown> };
  /**
   * PostgREST `max-rows` (Supabase varsayılanı 1000): okuma sonucu range/limit'ten SONRA bu sayıyla
   * kesilir, `count` gerçek toplamı döner. Opt-in — verilmezse kırpma yok. Sayfalamayı (`fetchAll`)
   * unutan sorgu, bununla testte de eksik satır görür.
   */
  maxRows?: number;
}

type FilterOp = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'is' | 'notIs' | 'notIn' | 'like' | 'ilike';

/**
 * PostgREST LIKE deseni → RegExp: `%` = herhangi dizi, `_` = tek karakter, `\` (Postgres'in
 * varsayılan LIKE escape karakteri) kendinden sonraki karakteri literal yapar — `\%`, `\_`, `\\`
 * jokerlik yapmaz. Kaçış olmayan her karakter regex için ayrıca kaçışlanır.
 */
function likeToRegExp(pattern: string, ignoreCase: boolean): RegExp {
  const regexEscape = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let body = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '\\' && i + 1 < pattern.length) {
      body += regexEscape(pattern[i + 1]!);
      i++;
      continue;
    }
    if (ch === '%') {
      body += '.*';
    } else if (ch === '_') {
      body += '.';
    } else {
      body += regexEscape(ch);
    }
  }
  return new RegExp(`^${body}$`, ignoreCase ? 'is' : 's');
}
interface Filter {
  op: FilterOp;
  column: string;
  value: any;
}

interface Result<T> {
  data: T;
  error: SupabaseError | null;
  count?: number;
}

/**
 * PostgREST gövdeyi `JSON.stringify` ile gönderir: değeri `undefined` olan alan
 * isteğe hiç girmez, satırdaki mevcut değer korunur. `Object.assign` ise onu
 * undefined ile ezer — fake prod'da olmayan bir veri kaybı gösterirdi.
 * Değer KOPYALANIR: gerçek istekte çağıranın dizisi/nesnesi depoyla paylaşılmaz.
 */
function assignDefined(target: Row, patch: Row): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) target[key] = structuredClone(value);
  }
}

const NOT_ONE_ROW: SupabaseError = {
  message: 'JSON object requested, multiple (or no) rows returned',
  code: 'PGRST116',
};

/** Otomatik birincil anahtar sayacı (bkz. run()). */
let autoId = 0;

/** PostgREST `in` degeri: `(a,b,c)` — bos liste `()`. */
function isPostgrestInList(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('(') && value.endsWith(')');
}

function parsePostgrestInList(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((v) => v.trim().replace(/^"(.*)"$/, '$1'));
}

/** `a.eq.1,and(b.eq.2,c.eq.3)` -> ['a.eq.1', 'and(b.eq.2,c.eq.3)'] (parantez icini bolmez). */
function splitTopLevel(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expression) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** `column.op.value` -> Filter. Deger nokta icerebilir (UUID, tarih). */
function parseFilterExpression(part: string): Filter {
  const [column, op, ...rest] = part.split('.');
  return { op: op as FilterOp, column, value: rest.join('.') };
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    switch (f.op) {
      case 'eq':
        return actual === f.value;
      case 'neq':
        return actual !== f.value;
      case 'gte':
        return actual >= f.value;
      case 'lte':
        return actual <= f.value;
      case 'gt':
        return actual > f.value;
      case 'lt':
        return actual < f.value;
      case 'in':
        return Array.isArray(f.value) && f.value.includes(actual);
      case 'is':
        // PostgREST `.is(col, null)` → yalnizca NULL satirlar. Soft-delete
        // sorgularinda kullaniliyor (`deleted_at is null`), yani "silinmemis"
        // demek. `undefined` da NULL sayilir: fake store'da alan hic yazilmamis
        // olabilir ve gercek DB'de o kolon NULL olurdu.
        return f.value === null ? actual === null || actual === undefined : actual === f.value;
      case 'notIs':
        // PostgREST .not(col, 'is', null) → NULL olmayan satirlar.
        return f.value === null ? actual !== null && actual !== undefined : actual !== f.value;
      case 'notIn':
        return !(Array.isArray(f.value) && f.value.includes(actual));
      case 'like':
        return typeof actual === 'string' && likeToRegExp(String(f.value), false).test(actual);
      case 'ilike':
        return typeof actual === 'string' && likeToRegExp(String(f.value), true).test(actual);
    }
  });
}

class QueryBuilder implements PromiseLike<Result<any>> {
  private readonly filters: Filter[] = [];
  /** Her grup kendi içinde OR; gruplar birbiriyle ve `filters` ile AND. */
  /**
   * `.or()` gruplari. Yapi: grup -> alternatifler -> AND'li filtreler.
   * Ucuncu seviye, PostgREST'in `and(a.eq.1,b.eq.2)` sozdizimi icin: o
   * alternatifin TUM filtreleri eslesmeli.
   */
  private readonly orGroups: Filter[][][] = [];
  /** Zincirdeki her `.order()` sirayla anahtar olur (PostgREST: ilk cagri birincil). */
  private readonly orderBy: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private rangeBounds: { from: number; to: number } | null = null;
  private limitCount: number | null = null;
  private returnRows = false;

  constructor(
    private readonly store: Tables,
    private readonly table: string,
    private readonly mode: 'select' | 'update' | 'insert' | 'upsert' | 'delete',
    private readonly payload: Row | Row[] | null,
    private readonly wantCount: boolean,
    private readonly failure: SupabaseError | null,
    private readonly onConflict?: string,
    private readonly uniqueColumns: string[] = [],
    /** bkz. `FailureSpec.committed` — true ise işlem uygulanır, hata SONRA döner. */
    private readonly committed: boolean = false,
    /** bkz. `FakeSupabaseOptions.maxRows` — yalnız okumada uygulanır. */
    private readonly maxRows: number | null = null,
    /** bkz. `FakeSupabaseOptions.holdRead` — sonuç hesaplanır, teslimi bu söz çözülünce. */
    private readonly hold: Promise<unknown> | null = null,
  ) {
    // select zaten satır döndürür; update/delete için .select() çağrılması gerekir.
    this.returnRows = mode === 'select';
  }

  private addFilter(op: FilterOp, column: string, value: any): this {
    this.filters.push({ op, column, value });
    return this;
  }

  eq(column: string, value: any) { return this.addFilter('eq', column, value); }
  neq(column: string, value: any) { return this.addFilter('neq', column, value); }
  is(column: string, value: any) { return this.addFilter('is', column, value); }
  gte(column: string, value: any) { return this.addFilter('gte', column, value); }
  lte(column: string, value: any) { return this.addFilter('lte', column, value); }
  gt(column: string, value: any) { return this.addFilter('gt', column, value); }
  lt(column: string, value: any) { return this.addFilter('lt', column, value); }
  in(column: string, values: any[]) { return this.addFilter('in', column, values); }
  like(column: string, pattern: string) { return this.addFilter('like', column, pattern); }
  ilike(column: string, pattern: string) { return this.addFilter('ilike', column, pattern); }

  /**
   * PostgREST `.not(col, op, value)` — filtreyi tersleyerek uygular.
   *
   * postgrest-js `.not()` degeri HAM sozdizimi olarak URL'e gomer; `in` icin
   * cagiran taraf parantezi kendisi kurmak zorunda (`'(a,b)'`). Dizi gecilirse
   * gercek PostgREST parse hatasi doner — bu yuzden fake de diziyi REDDEDER,
   * aksi halde test uretimde patlayan bir sorguyu yesil gosterir.
   */
  not(column: string, op: 'is' | 'in' | 'eq', value: any) {
    if (op === 'in') {
      if (!isPostgrestInList(value)) {
        throw new Error(
          `not(${column}, 'in', ...) icin PostgREST parantezli liste bekler, alinan: ${JSON.stringify(value)}`,
        );
      }
      return this.addFilter('notIn', column, parsePostgrestInList(value));
    }
    if (op === 'eq') return this.addFilter('neq', column, value);
    return this.addFilter('notIs', column, value);
  }

  /**
   * PostgREST OR sözdizimi: `user1_id.eq.abc,user2_id.eq.abc`.
   * Sadece kod tabanının kullandığı `col.op.value` biçimi destekleniyor.
   */
  or(expression: string) {
    // PostgREST `.or()` iki bicim aliyor:
    //   "a.eq.1,b.eq.2"                        -> iki alternatif, her biri tek filtre
    //   "and(a.eq.1,b.eq.2),and(a.eq.2,b.eq.1)" -> iki alternatif, her biri IKI filtre
    // Ikincisi cift yonlu iliski sorgularinda kullaniliyor (block/quiz/user
    // servislerinde dort yerde) ve eskiden bu helper onu yanlis ayristiriyordu:
    // `and(a` bir kolon adi saniliyordu, yani sorgu sessizce hicbir satiri
    // eslemiyordu ve testler gercegi yansitmiyordu.
    const group = splitTopLevel(expression).map((part) => {
      const inner = part.startsWith('and(') && part.endsWith(')')
        ? splitTopLevel(part.slice(4, -1))
        : [part];
      return inner.map(parseFilterExpression);
    });
    this.orGroups.push(group);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = opts?.ascending ?? true;
    // Postgres varsayilani: ASC'de NULL en sonda, DESC'de en basta.
    this.orderBy.push({ column, ascending, nullsFirst: opts?.nullsFirst ?? !ascending });
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = { from, to };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  /** update/insert sonrası "değişen satırları döndür". */
  select(_columns?: string) {
    this.returnRows = true;
    return this;
  }

  private rows(): Row[] {
    return (this.store[this.table] ??= []);
  }

  /** Filtre + sıralama + sayfalama uygulanmış satırlar; mutasyon için referans döner. */
  private resolveRows(): { affected: Row[]; total: number } {
    const all = this.rows();
    let selected = all.filter(
      (r) =>
        matches(r, this.filters) &&
        this.orGroups.every((group) => group.some((alternative) => matches(r, alternative))),
    );
    const total = selected.length;

    if (this.orderBy.length > 0) {
      // Eskiden yalniz SON `.order()` tutuluyordu: `order(last_seen_at).order(id)`
      // zinciri testte sadece id'ye gore siralaniyor, birincil anahtar sessizce
      // kayboluyordu. Simdi anahtarlar sirayla, esitlikte bir sonrakine gecerek.
      selected = [...selected].sort((a, b) => {
        for (const { column, ascending, nullsFirst } of this.orderBy) {
          const av = a[column];
          const bv = b[column];
          if (av === bv) continue;
          if (av == null) return nullsFirst ? -1 : 1;
          if (bv == null) return nullsFirst ? 1 : -1;
          const cmp = av > bv ? 1 : -1;
          return ascending ? cmp : -cmp;
        }
        return 0;
      });
    }
    if (this.rangeBounds) {
      selected = selected.slice(this.rangeBounds.from, this.rangeBounds.to + 1);
    }
    if (this.limitCount !== null) {
      selected = selected.slice(0, this.limitCount);
    }
    if (this.mode === 'select' && this.maxRows !== null) {
      selected = selected.slice(0, this.maxRows);
    }

    return { affected: selected, total };
  }

  /** Asıl iş — her terminal operasyon buradan geçer. */
  private run(): Result<Row[]> {
    // `committed` değilse eski davranış: hiçbir şey uygulanmadan hemen hata.
    // `committed` ise işlem AŞAĞIDA uygulanır, hata en sonda döner (commit sonrası kayıp cevap).
    if (this.failure && !this.committed) return { data: [], error: this.failure, count: 0 };

    if (this.mode === 'insert' || this.mode === 'upsert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const written: Row[] = [];

      // Bileşik anahtar da olabilir ("user_id,consent_type,version"): çakışma için
      // HEPSİ eşleşmeli. Eskiden virgüllü anahtar tek kolon adı sanılıyordu —
      // `row['a,b']` hep undefined → upsert her seferinde yeni satır ekliyordu.
      const keys = this.onConflict?.split(',').map((k) => k.trim()) ?? [];
      for (const row of incoming) {
        // Postgres'te NULL/undefined benzersizlik kısıtına takılmaz — her zaman yeni satır.
        const hasKey = keys.length > 0 && keys.every((k) => row[k] !== undefined && row[k] !== null);
        const existing =
          this.mode === 'upsert' && hasKey
            ? this.rows().find((r) => keys.every((k) => r[k] === row[k]))
            : undefined;

        if (existing) {
          assignDefined(existing, row);
          written.push(existing);
        } else {
          // Benzersiz kısıt (options.unique): tek kolon ya da "a,b" bileşik anahtar — Postgres 23505.
          // Anahtarın bir kolonu NULL ise kısıt uygulanmaz (Postgres'te NULL'lar birbirine eşit değil).
          const clash = this.uniqueColumns.find((spec) => {
            const cols = spec.split(',').map((c) => c.trim());
            if (cols.some((c) => row[c] == null)) return false;
            return this.rows().some((r) => cols.every((c) => r[c] === row[c]));
          });
          if (clash) {
            return {
              data: [],
              error: { message: `duplicate key value violates unique constraint (${this.table}.${clash})`, code: '23505' },
              count: 0,
            };
          }
          // Postgres birincil anahtarı kendi üretir. Fake de üretmeli: aksi halde
          // `id` undefined kalır ve `.eq('id', undefined)` tüm satırlara çarpar.
          // Deterministik sayaç — testlerin tekrarlanabilirliği için rastgelelik yok.
          const created = structuredClone(row);
          if (created.id === undefined) created.id = `fake-${++autoId}`;
          this.rows().push(created);
          written.push(created);
        }
      }

      // Satır(lar) yazıldı; `committed` enjeksiyonu varsa şimdi devreye girer (yazım kalıcı, hata dönüyor).
      if (this.failure) return { data: [], error: this.failure, count: 0 };
      return { data: this.returnRows ? written : [], error: null, count: written.length };
    }

    const { affected, total } = this.resolveRows();

    if (this.mode === 'update') {
      // Postgres semantiği: filtreler GÜNCEL değerlere göre değerlendirilir.
      // `.gte()` guard'ı bu yüzden compare-and-swap gibi davranır.
      for (const row of affected) assignDefined(row, this.payload as Row);
    } else if (this.mode === 'delete') {
      const remaining = this.rows().filter((r) => !affected.includes(r));
      this.store[this.table] = remaining;
    }

    // update/delete uygulandı; `committed` enjeksiyonu varsa hata burada döner (yazım kalıcı).
    if (this.failure) return { data: [], error: this.failure, count: 0 };

    return {
      // Derin kopya: dönen satırdaki dizi (ör. `photos`) çağıranda değişirse depoya SIZMAMALI —
      // sığ kopyada `photos.push()` depoyu değiştiriyor, `update` hiç yapılmasa da test geçiyordu (2026-09-28).
      data: this.returnRows ? affected.map((r) => structuredClone(r)) : [],
      error: null,
      count: this.wantCount ? total : undefined,
    };
  }

  async single(): Promise<Result<Row | null>> {
    const result = this.run();
    if (this.hold) await this.hold;
    if (result.error) return { data: null, error: result.error };
    if (result.data.length !== 1) return { data: null, error: NOT_ONE_ROW };
    return { data: result.data[0], error: null };
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    const result = this.run();
    if (this.hold) await this.hold;
    if (result.error) return { data: null, error: result.error };
    if (result.data.length > 1) return { data: null, error: NOT_ONE_ROW };
    return { data: result.data[0] ?? null, error: null };
  }

  /** `await builder` — single()/maybeSingle() olmadan doğrudan beklenen zincirler için. */
  then<TResult1 = Result<any>, TResult2 = never>(
    onfulfilled?: ((value: Result<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.run();
    const teslim = this.hold ? this.hold.then(() => result) : Promise.resolve(result);
    return teslim.then(onfulfilled, onrejected);
  }
}

export interface FakeSupabase {
  /** `config/supabase` modülünün yerine geçen nesne. */
  client: any;
  /** Bir tablonun güncel satırları — assert için. */
  table(name: string): Row[];
  /** Yapılan rpc çağrıları, sırayla. */
  rpcCalls: Array<{ name: string; args: unknown }>;
  /**
   * Yapılan tablo istekleri (`from(t).select/update/...`), sırayla. Her biri gerçekte bir
   * HTTP isteğidir; 10 sn'lik cron'larda istek SAYISI da bir davranıştır (2026-09-27: tik
   * başına ~39 istekle günde 337 bin istek). N+1'i sınamak için.
   */
  queries: Array<{ table: string; op: 'select' | 'update' | 'insert' | 'upsert' | 'delete' }>;
  /** Bir bucket'ta kalan dosya yolları — assert için. */
  storageFiles(bucket: string): string[];
  /**
   * Başarılı `upload` çağrıları, sırayla: gövde ve seçenekler (contentType, cacheControl) —
   * depoya GERÇEKTE ne yazıldığını sınamak için (ör. PNG değil JPEG, önbellek başlığı).
   */
  storageUploads: Array<{ bucket: string; path: string; body: unknown; opts?: StorageUploadOptions }>;
}

/** `storage.from(b).upload` seçeneklerinin kod tabanında kullanılan kısmı. */
export interface StorageUploadOptions { upsert?: boolean; contentType?: string; cacheControl?: string }

export function createFakeSupabase(
  seed: Tables = {},
  options: FakeSupabaseOptions = {},
): FakeSupabase {
  // Seed'i derin kopyala — aynı fixture'ı birden çok testte kullanmak güvenli olsun.
  const store: Tables = Object.fromEntries(
    Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => structuredClone(r))]),
  );
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const storageUploads: FakeSupabase['storageUploads'] = [];
  const queries: FakeSupabase['queries'] = [];
  const storageFiles: Record<string, string[]> = Object.fromEntries(
    Object.entries(options.storage ?? {}).map(([bucket, paths]) => [bucket, [...paths]]),
  );

  // failAfter'ı sayabilmek için (tablo, op) başına çağrı sayacı.
  const opCounts = new Map<string, number>();

  // holdRead yalnız İLK eşleşen okumaya uygulanır.
  let holdKullanildi = false;
  const holdFor = (table: string): Promise<unknown> | null => {
    if (!options.holdRead || holdKullanildi || options.holdRead.table !== table) return null;
    holdKullanildi = true;
    return options.holdRead.until;
  };

  // interleave spec'i başına kalan tetiklenme sayısı.
  const interleaveLeft = new Map<number, number>();
  const runInterleave = (table: string, op: 'update' | 'select') => {
    options.interleave?.forEach((spec, index) => {
      if (spec.table !== table || (spec.op ?? 'update') !== op) return;
      const left = interleaveLeft.get(index) ?? spec.times ?? 1;
      if (left <= 0) return;
      interleaveLeft.set(index, left - 1);
      spec.mutate((store[table] ??= []));
    });
  };

  const failureFor = (
    table: string,
    op: FailureSpec['op'],
  ): { error: SupabaseError; committed: boolean } | null => {
    const spec = options.failOn?.find((f) => f.table === table && f.op === op);
    if (!spec) return null;

    const key = `${table}:${op}`;
    const seen = opCounts.get(key) ?? 0;
    opCounts.set(key, seen + 1);
    const start = spec.failAfter ?? 0;
    if (seen < start) return null;
    if (spec.times !== undefined && seen >= start + spec.times) return null;

    return {
      error: spec.error ?? { message: `fake failure: ${op} on ${table}` },
      committed: spec.committed ?? false,
    };
  };

  // Depolama hata enjeksiyonu için (bucket, op) başına çağrı sayacı.
  const storageOpCounts = new Map<string, number>();

  const storageFailureFor = (bucket: string, op: StorageFailureSpec['op']): SupabaseError | null => {
    const spec = options.storageFailOn?.find((f) => f.bucket === bucket && f.op === op);
    if (!spec) return null;

    const key = `${bucket}:${op}`;
    const seen = storageOpCounts.get(key) ?? 0;
    storageOpCounts.set(key, seen + 1);
    const start = spec.failAfter ?? 0;
    if (seen < start) return null;
    if (spec.times !== undefined && seen >= start + spec.times) return null;

    return spec.error ?? { message: `fake storage failure: ${op} on ${bucket}` };
  };

  const client = {
    from(table: string) {
      const kaydet = (op: FakeSupabase['queries'][number]['op']) => queries.push({ table, op });
      return {
        select: (_columns?: string, opts?: { count?: string }) => {
          kaydet('select');
          runInterleave(table, 'select');
          const fail = failureFor(table, 'select');
          return new QueryBuilder(
            store, table, 'select', null, opts?.count === 'exact',
            fail?.error ?? null, undefined, [], fail?.committed ?? false, options.maxRows ?? null,
            holdFor(table),
          );
        },
        update: (patch: Row) => {
          kaydet('update');
          runInterleave(table, 'update');
          const fail = failureFor(table, 'update');
          return new QueryBuilder(
            store, table, 'update', patch, false,
            fail?.error ?? null, undefined, [], fail?.committed ?? false,
          );
        },
        insert: (payload: Row | Row[]) => {
          kaydet('insert');
          const fail = failureFor(table, 'insert');
          return new QueryBuilder(
            store, table, 'insert', payload, false,
            fail?.error ?? null, undefined, options.unique?.[table] ?? [], fail?.committed ?? false,
          );
        },
        upsert: (payload: Row | Row[], opts?: { onConflict?: string }) => {
          kaydet('upsert');
          const fail = failureFor(table, 'insert');
          return new QueryBuilder(
            store, table, 'upsert', payload, false,
            fail?.error ?? null, opts?.onConflict, [], fail?.committed ?? false,
          );
        },
        // `count` secenegi ONEMLI: PostgREST `.delete({ count: 'exact' })` ile
        // silinen satir sayisini donuyor ve servisler "hicbir sey silinmedi"yi
        // (baskasinin kaydini silmeye calismak) bundan anliyor. Eskiden bu
        // secenek yok sayiliyordu, yani fake her zaman `count: undefined`
        // donuyordu ve o kontrol testlerde hic tetiklenmiyordu.
        delete: (opts?: { count?: 'exact' }) => {
          kaydet('delete');
          const fail = failureFor(table, 'delete');
          return new QueryBuilder(
            store, table, 'delete', null, opts?.count === 'exact',
            fail?.error ?? null, undefined, [], fail?.committed ?? false,
          );
        },
      };
    },
    /**
     * Depolama — kod tabanının kullandığı `list`, `remove`, `upload`, `getPublicUrl`.
     * Dosyalar `bucket → path` haritasında tutulur; `list(prefix)` o önekin
     * altındaki dosya adlarını döner (Supabase `{ name }` listesi gibi).
     * Gerçek Storage'a sadık üç kural:
     * - Sayfalı: `limit` verilmezse 100 dosya — sayfalamayı unutan kod testte de dosya bırakır.
     * - Tek seviyeli: alt klasördeki dosyalar dönmez (klasör girdileri modellenmez).
     * - `upload` var olan yola `upsert` verilmeden yazamaz (Storage 409 döner).
     */
    storage: {
      from(bucket: string) {
        // Dizi her çağrıda yeniden okunur: `remove` yeni dizi yazıyor; `from()` anında
        // yakalanan kopya bayat kalır, aynı nesneyle ikinci çağrı silineni geri getirirdi.
        const files = () => (storageFiles[bucket] ??= []);
        return {
          async upload(path: string, body: unknown, opts?: StorageUploadOptions) {
            const failure = storageFailureFor(bucket, 'upload');
            if (failure) return { data: null, error: failure };
            if (files().includes(path) && !opts?.upsert) {
              return { data: null, error: { message: 'The resource already exists', code: '409' } };
            }
            if (!files().includes(path)) files().push(path);
            storageUploads.push({ bucket, path, body, opts });
            return { data: { path }, error: null };
          },
          // Gerçek istemcide senkron ve hatasızdır; URL biçimi prod ile aynı kalıpta.
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
          },
          async list(prefix: string, opts?: { limit?: number; offset?: number }) {
            const failure = storageFailureFor(bucket, 'list');
            if (failure) return { data: null, error: failure };
            // `offset` gerçek API'deki gibi sayfalar: offset'i yok sayan bir fake, sayfalayan
            // kodu testte sonsuz döngüye sokar (her çağrı ilk sayfayı döner).
            const start = opts?.offset ?? 0;
            const data = files()
              .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
              .slice(start, start + (opts?.limit ?? 100))
              .map((path) => ({ name: path.slice(prefix.length + 1) }));
            return { data, error: null };
          },
          async remove(paths: string[]) {
            const failure = storageFailureFor(bucket, 'remove');
            if (failure) return { data: null, error: failure };
            storageFiles[bucket] = files().filter((path) => !paths.includes(path));
            return { data: null, error: null };
          },
        };
      },
    },
    async rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });
      const configured = options.rpc?.[name];
      return { data: configured?.data ?? null, error: configured?.error ?? null };
    },
  };

  return {
    client,
    table: (name: string) => (store[name] ??= []),
    rpcCalls,
    queries,
    storageFiles: (bucket: string) => (storageFiles[bucket] ??= []),
    storageUploads,
  };
}
