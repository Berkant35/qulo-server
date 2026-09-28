/**
 * Süreç içi, TTL'li küçük önbellek — nadiren değişen ama sık okunan veri için Supabase
 * isteği biriktirmemek (ör. her API çağrısındaki ban kontrolü, her resume'daki config).
 *
 * Tek Railway instance'ı varsayar: `delete`/`clear` yalnız bu sürecin kopyasını temizler.
 * İkinci replika açılırsa her kopya kendi önbelleğini tutar ve bir kopyadaki yazım diğerine
 * en geç TTL sonunda yansır (bkz. `.claude/skills/businessCaseSkills/supabase-cost-guard.md`).
 *
 * Doldurmak için `getOrLoad` kullan: hata sonucunu yazmaz ve okuma sürerken yapılan temizliği
 * ezmez. Elle `get` + `await` + `set` yazma — bu yarışa açıktır (2026-09-28 review).
 */
export class TtlCache<K, V> {
  private readonly kayitlar = new Map<K, { deger: V; bitis: number }>();
  /** `delete`/`clear` her çağrıda artar; `getOrLoad` okuma boyunca değiştiyse sonucu yazmaz. */
  private nesil = 0;

  constructor(
    private readonly ttlMs: number,
    /** Anahtar sayısı sınırı: kullanıcı başına anahtarlı önbellek sınırsız büyümesin. */
    private readonly maxBoyut = 10_000,
    // Çağrı anında çözülür: modül yüklendikten SONRA kurulan sahte saat de görülsün.
    private readonly simdi: () => number = () => Date.now(),
  ) {}

  get(key: K): V | undefined {
    const kayit = this.kayitlar.get(key);
    if (!kayit) return undefined;
    if (this.simdi() >= kayit.bitis) {
      this.kayitlar.delete(key);
      return undefined;
    }
    return kayit.deger;
  }

  set(key: K, deger: V): void {
    if (!this.kayitlar.has(key) && this.kayitlar.size >= this.maxBoyut) this.yerAc();
    this.kayitlar.set(key, { deger, bitis: this.simdi() + this.ttlMs });
  }

  /**
   * Önbellekte varsa döner; yoksa `yukle` ile okur ve sonucu yazar.
   * - `undefined` sonuç (ör. okuma hatası) ve fırlatılan hata YAZILMAZ.
   * - Okuma sürerken `delete`/`clear` çağrıldıysa sonuç YAZILMAZ: yazımdan önce başlamış bir okuma
   *   eski değeri TTL boyunca geri getirmesin (ör. ban anındaki eşzamanlı istek). Nesil tüm önbellek
   *   için tek sayaçtır; başka anahtarın temizliği yalnız fazladan bir okumaya mal olur.
   */
  async getOrLoad(key: K, yukle: () => Promise<V | undefined>): Promise<V | undefined> {
    const onbellekte = this.get(key);
    if (onbellekte !== undefined) return onbellekte;
    const baslangicNesli = this.nesil;
    const deger = await yukle();
    if (deger !== undefined && baslangicNesli === this.nesil) this.set(key, deger);
    return deger;
  }

  delete(key: K): void {
    this.kayitlar.delete(key);
    this.nesil++;
  }

  clear(): void {
    this.kayitlar.clear();
    this.nesil++;
  }

  get size(): number {
    return this.kayitlar.size;
  }

  /** Önce süresi dolanları atar; yer açılmadıysa en eski eklenen kaydı (Map ekleme sırası). */
  private yerAc(): void {
    const t = this.simdi();
    for (const [key, kayit] of this.kayitlar) {
      if (t >= kayit.bitis) this.kayitlar.delete(key);
    }
    if (this.kayitlar.size < this.maxBoyut) return;
    const enEski = this.kayitlar.keys().next();
    if (!enEski.done) this.kayitlar.delete(enEski.value);
  }
}
