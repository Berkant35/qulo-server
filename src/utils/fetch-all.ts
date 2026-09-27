/** Supabase/PostgREST varsayilan max-rows = 1000: sayfalanmayan sorgu sessizce kirpilir. Her liste sorgusu fetchAll'dan gecer. */
const PAGE_SIZE = 1000;

type PageResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Sirali (order zorunlu) range sayfalamasiyla tum satirlari ceker. Liste sorgusu yazan HER servis bunu kullanir. */
export async function fetchAll<T>(page: (from: number, to: number) => PageResult): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
}
