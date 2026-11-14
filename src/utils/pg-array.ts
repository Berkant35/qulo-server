/**
 * PostgREST `eq` filtresi için `text[]` literali: `{"a","b,c"}`.
 *
 * PostgREST `eq.` sonrasını virgüller dahil olduğu gibi alır ve sütun tipine çevirir; kaçış
 * PostgREST'in kendi `pgBuildArrayLiteral`'ı ile aynı (önce `\`, sonra `"`). Dizi sütununda
 * iyimser kilit (compare-and-swap) için: `.eq("photos", pgTextArrayLiteral(okunanDizi))`.
 */
export function pgTextArrayLiteral(values: readonly string[]): string {
  const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `{${values.map(quote).join(",")}}`;
}
