/** Sayfalı backoffice listesi: `total` filtreye uyan tüm satırlar, `items` yalnız istenen sayfa. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
