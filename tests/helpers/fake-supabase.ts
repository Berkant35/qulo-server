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
}

/** Depolama hata enjeksiyonu — `FailureSpec`'in storage karşılığı. */
export interface StorageFailureSpec {
  bucket: string;
  op: 'list' | 'remove';
  error?: SupabaseError;
  /** Kaç başarılı çağrıdan SONRA patlasın (varsayılan 0 = hemen). */
  failAfter?: number;
  /** Kaç çağrı patlasın (varsayılan: sonrakilerin hepsi) — tek bir klasörün hatasını hedeflemek için. */
  times?: number;
}

export interface FakeSupabaseOptions {
  failOn?: FailureSpec[];
  /** rpc(name, args) çağrılarına verilecek cevaplar. */
  rpc?: Record<string, { data?: unknown; error?: SupabaseError }>;
  /** Başlangıçtaki depolama dosyaları: `{ photos: ['user-id/a.jpg'] }`. */
  storage?: Record<string, string[]>;
  /** Depolama hata enjeksiyonu (bkz. `StorageFailureSpec`). */
  storageFailOn?: StorageFailureSpec[];
}

type FilterOp = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'is' | 'notIs' | 'notIn';
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
 */
function assignDefined(target: Row, patch: Row): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) target[key] = value;
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
  private orderBy: { column: string; ascending: boolean } | null = null;
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

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending ?? true };
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

    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      selected = [...selected].sort((a, b) => {
        if (a[column] === b[column]) return 0;
        const cmp = a[column] > b[column] ? 1 : -1;
        return ascending ? cmp : -cmp;
      });
    }
    if (this.rangeBounds) {
      selected = selected.slice(this.rangeBounds.from, this.rangeBounds.to + 1);
    }
    if (this.limitCount !== null) {
      selected = selected.slice(0, this.limitCount);
    }

    return { affected: selected, total };
  }

  /** Asıl iş — her terminal operasyon buradan geçer. */
  private run(): Result<Row[]> {
    if (this.failure) return { data: [], error: this.failure, count: 0 };

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
          // Postgres birincil anahtarı kendi üretir. Fake de üretmeli: aksi halde
          // `id` undefined kalır ve `.eq('id', undefined)` tüm satırlara çarpar.
          // Deterministik sayaç — testlerin tekrarlanabilirliği için rastgelelik yok.
          const created = { ...row };
          if (created.id === undefined) created.id = `fake-${++autoId}`;
          this.rows().push(created);
          written.push(created);
        }
      }

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

    return {
      data: this.returnRows ? affected.map((r) => ({ ...r })) : [],
      error: null,
      count: this.wantCount ? total : undefined,
    };
  }

  async single(): Promise<Result<Row | null>> {
    const result = this.run();
    if (result.error) return { data: null, error: result.error };
    if (result.data.length !== 1) return { data: null, error: NOT_ONE_ROW };
    return { data: result.data[0], error: null };
  }

  async maybeSingle(): Promise<Result<Row | null>> {
    const result = this.run();
    if (result.error) return { data: null, error: result.error };
    if (result.data.length > 1) return { data: null, error: NOT_ONE_ROW };
    return { data: result.data[0] ?? null, error: null };
  }

  /** `await builder` — single()/maybeSingle() olmadan doğrudan beklenen zincirler için. */
  then<TResult1 = Result<any>, TResult2 = never>(
    onfulfilled?: ((value: Result<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export interface FakeSupabase {
  /** `config/supabase` modülünün yerine geçen nesne. */
  client: any;
  /** Bir tablonun güncel satırları — assert için. */
  table(name: string): Row[];
  /** Yapılan rpc çağrıları, sırayla. */
  rpcCalls: Array<{ name: string; args: unknown }>;
  /** Bir bucket'ta kalan dosya yolları — assert için. */
  storageFiles(bucket: string): string[];
}

export function createFakeSupabase(
  seed: Tables = {},
  options: FakeSupabaseOptions = {},
): FakeSupabase {
  // Seed'i derin kopyala — aynı fixture'ı birden çok testte kullanmak güvenli olsun.
  const store: Tables = Object.fromEntries(
    Object.entries(seed).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]),
  );
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const storageFiles: Record<string, string[]> = Object.fromEntries(
    Object.entries(options.storage ?? {}).map(([bucket, paths]) => [bucket, [...paths]]),
  );

  // failAfter'ı sayabilmek için (tablo, op) başına çağrı sayacı.
  const opCounts = new Map<string, number>();

  const failureFor = (table: string, op: FailureSpec['op']): SupabaseError | null => {
    const spec = options.failOn?.find((f) => f.table === table && f.op === op);
    if (!spec) return null;

    const key = `${table}:${op}`;
    const seen = opCounts.get(key) ?? 0;
    opCounts.set(key, seen + 1);
    if (seen < (spec.failAfter ?? 0)) return null;

    return spec.error ?? { message: `fake failure: ${op} on ${table}` };
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
      return {
        select: (_columns?: string, opts?: { count?: string }) =>
          new QueryBuilder(store, table, 'select', null, opts?.count === 'exact', failureFor(table, 'select')),
        update: (patch: Row) =>
          new QueryBuilder(store, table, 'update', patch, false, failureFor(table, 'update')),
        insert: (payload: Row | Row[]) =>
          new QueryBuilder(store, table, 'insert', payload, false, failureFor(table, 'insert')),
        upsert: (payload: Row | Row[], opts?: { onConflict?: string }) =>
          new QueryBuilder(
            store, table, 'upsert', payload, false,
            failureFor(table, 'insert'), opts?.onConflict,
          ),
        // `count` secenegi ONEMLI: PostgREST `.delete({ count: 'exact' })` ile
        // silinen satir sayisini donuyor ve servisler "hicbir sey silinmedi"yi
        // (baskasinin kaydini silmeye calismak) bundan anliyor. Eskiden bu
        // secenek yok sayiliyordu, yani fake her zaman `count: undefined`
        // donuyordu ve o kontrol testlerde hic tetiklenmiyordu.
        delete: (opts?: { count?: 'exact' }) =>
          new QueryBuilder(store, table, 'delete', null, opts?.count === 'exact', failureFor(table, 'delete')),
      };
    },
    /**
     * Depolama — sadece kod tabanının kullandığı `list` ve `remove`.
     * Dosyalar `bucket → path` haritasında tutulur; `list(prefix)` o önekin
     * altındaki dosya adlarını döner (Supabase `{ name }` listesi gibi).
     * Gerçek Storage'a sadık iki kural:
     * - Sayfalı: `limit` verilmezse 100 dosya — sayfalamayı unutan kod testte de dosya bırakır.
     * - Tek seviyeli: alt klasördeki dosyalar dönmez (klasör girdileri modellenmez).
     */
    storage: {
      from(bucket: string) {
        // Dizi her çağrıda yeniden okunur: `remove` yeni dizi yazıyor; `from()` anında
        // yakalanan kopya bayat kalır, aynı nesneyle ikinci çağrı silineni geri getirirdi.
        const files = () => (storageFiles[bucket] ??= []);
        return {
          async list(prefix: string, opts?: { limit?: number }) {
            const failure = storageFailureFor(bucket, 'list');
            if (failure) return { data: null, error: failure };
            const data = files()
              .filter((path) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
              .slice(0, opts?.limit ?? 100)
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
    storageFiles: (bucket: string) => (storageFiles[bucket] ??= []),
  };
}
