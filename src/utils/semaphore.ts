/**
 * Sayaçlı kilit: en fazla `limit` iş aynı anda çalışır, fazlası sırayla (FIFO) bekler.
 * Biten iş yuvasını bekleyene DOĞRUDAN devreder — sayaç düşüp yeniden artmaz, bu yüzden araya
 * giren yeni çağrı sınırı bir an bile aşamaz.
 */
export class Semafor {
  private aktif = 0;
  private readonly bekleyenler: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semafor: limit >= 1 olmali");
  }

  async calistir<T>(is: () => Promise<T>): Promise<T> {
    if (this.aktif < this.limit) this.aktif++;
    else await new Promise<void>((devret) => this.bekleyenler.push(devret));
    try {
      return await is();
    } finally {
      const sonraki = this.bekleyenler.shift();
      if (sonraki) sonraki();
      else this.aktif--;
    }
  }
}
