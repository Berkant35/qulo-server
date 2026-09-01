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
  op: 'select' | 'update' | 'insert' | 'delete';
  error?: SupabaseError;
  /**
   * Kaç başarılı çağrıdan SONRA patlasın (varsayılan 0 = hemen).
   * Çok adımlı akışların ortasını hedeflemek için: aynı tabloya iki kez yazan bir
   * metodun sadece ikinci yazımını bozup ilkinin geri alınmadığını gösterebilmek gerekiyor.
   */
  failAfter?: number;
}

export interface FakeSupabaseOptions {
  failOn?: FailureSpec[];
  /** rpc(name, args) çağrılarına verilecek cevaplar. */
  rpc?: Record<string, { data?: unknown; error?: SupabaseError }>;
}

type FilterOp = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in';
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

const NOT_ONE_ROW: SupabaseError = {
  message: 'JSON object requested, multiple (or no) rows returned',
  code: 'PGRST116',
};

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
    }
  });
}

class QueryBuilder implements PromiseLike<Result<any>> {
  private readonly filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rangeBounds: { from: number; to: number } | null = null;
  private limitCount: number | null = null;
  private returnRows = false;

  constructor(
    private readonly store: Tables,
    private readonly table: string,
    private readonly mode: 'select' | 'update' | 'insert' | 'delete',
    private readonly payload: Row | Row[] | null,
    private readonly wantCount: boolean,
    private readonly failure: SupabaseError | null,
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
  gte(column: string, value: any) { return this.addFilter('gte', column, value); }
  lte(column: string, value: any) { return this.addFilter('lte', column, value); }
  gt(column: string, value: any) { return this.addFilter('gt', column, value); }
  lt(column: string, value: any) { return this.addFilter('lt', column, value); }
  in(column: string, values: any[]) { return this.addFilter('in', column, values); }

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
    let selected = all.filter((r) => matches(r, this.filters));
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

    if (this.mode === 'insert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const inserted = incoming.map((r) => ({ ...r }));
      this.rows().push(...inserted);
      return { data: this.returnRows ? inserted : [], error: null, count: inserted.length };
    }

    const { affected, total } = this.resolveRows();

    if (this.mode === 'update') {
      // Postgres semantiği: filtreler GÜNCEL değerlere göre değerlendirilir.
      // `.gte()` guard'ı bu yüzden compare-and-swap gibi davranır.
      for (const row of affected) Object.assign(row, this.payload);
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

  const client = {
    from(table: string) {
      return {
        select: (_columns?: string, opts?: { count?: string }) =>
          new QueryBuilder(store, table, 'select', null, opts?.count === 'exact', failureFor(table, 'select')),
        update: (patch: Row) =>
          new QueryBuilder(store, table, 'update', patch, false, failureFor(table, 'update')),
        insert: (payload: Row | Row[]) =>
          new QueryBuilder(store, table, 'insert', payload, false, failureFor(table, 'insert')),
        delete: () =>
          new QueryBuilder(store, table, 'delete', null, false, failureFor(table, 'delete')),
      };
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
  };
}
