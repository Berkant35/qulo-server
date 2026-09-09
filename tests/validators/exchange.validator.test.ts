import { describe, it, expect } from 'vitest';
import { convertSchema, buyPowerSchema } from '../../src/validators/exchange.validator.js';
import { ECONOMY_BOUNDARIES } from '../../src/types/economy-config.schema.js';

/**
 * Donusum orani SABIT DEGIL — `greenToPurpleRatio` economy config'te ve
 * backoffice'ten degistirilebiliyor. Validator eskiden `min(3)` + `% 3`
 * varsayiyordu; oran 4'e cekilseydi mobil (orani config'ten okuyor) 4'un
 * katini gonderir, validator reddederdi ve donusum tamamen kirilirdi.
 *
 * Asil kontrol `exchange.service.ts`'te, config'ten okunan oranla yapiliyor.
 */
describe('convertSchema — oran varsayimi yok', () => {
  it('3un kati olmayan miktar validator katmanindan GECER', () => {
    // Oran 4 iken 8 gecerli bir istektir; validator bunu bloklamamali.
    expect(convertSchema.safeParse({ green_amount: 8 }).success).toBe(true);
    expect(convertSchema.safeParse({ green_amount: 5 }).success).toBe(true);
  });

  it('sinirin izin verdigi HER oran icin en kucuk gecerli istek gecer', () => {
    // Asil sozlesme bu: config orani 1..10 arasina cekilebiliyor ve her oran
    // icin en kucuk mesru istek `green_amount === ratio`. Sabiti kendine
    // dogrulamak (`min).toBe(1)`) invaryant kurmaz — sinir genisletilirse ya da
    // validator'a yeniden bir taban konursa bu dongu yakalar.
    const { min, max } = ECONOMY_BOUNDARIES.greenToPurpleRatio;
    for (let ratio = min; ratio <= max; ratio++) {
      expect(
        convertSchema.safeParse({ green_amount: ratio }).success,
        `oran ${ratio} icin en kucuk gecerli miktar (${ratio}) validator'dan gecmeli`,
      ).toBe(true);
    }
  });

  it('sifir ve negatif reddedilir', () => {
    expect(convertSchema.safeParse({ green_amount: 0 }).success).toBe(false);
    expect(convertSchema.safeParse({ green_amount: -3 }).success).toBe(false);
  });

  it('ondalik reddedilir', () => {
    expect(convertSchema.safeParse({ green_amount: 3.5 }).success).toBe(false);
  });

  it('makul ust sinir korunuyor', () => {
    // 999_999 bilincli: 3'un kati oldugu icin ESKI semada da gecerdi. Boylece
    // bu test yalnizca ust sinir kontrolunu olcuyor, oran varsayimini degil
    // (1_000_000 secilseydi eski semada `% 3` yuzunden de kirmizi olurdu ve
    // mutasyon testi yanlis sebepten yesil/kirmizi verirdi).
    expect(convertSchema.safeParse({ green_amount: 999_999 }).success).toBe(true);
    expect(convertSchema.safeParse({ green_amount: 1_000_001 }).success).toBe(false);
  });
});

describe('buyPowerSchema', () => {
  it('POWER_BLOCK ve POWER_UNBLOCK enum icinde', () => {
    // Bu iki guc sonradan eklendi; enum'dan dusmesi sessizce 400 uretirdi.
    for (const power of ['ORACLE', 'HALF', 'SKIP', 'SKIP_ALL', 'TIME_EXTEND', 'HINT', 'POWER_BLOCK', 'POWER_UNBLOCK']) {
      expect(
        buyPowerSchema.safeParse({ power_name: power, diamond_type: 'GREEN', quantity: 1 }).success,
        `${power} kabul edilmeli`,
      ).toBe(true);
    }
  });

  it('bilinmeyen guc adi reddedilir', () => {
    expect(
      buyPowerSchema.safeParse({ power_name: 'TELEPORT', diamond_type: 'GREEN', quantity: 1 }).success,
    ).toBe(false);
  });

  it('diamond_type yalnizca GREEN veya PURPLE', () => {
    expect(buyPowerSchema.safeParse({ power_name: 'SKIP', diamond_type: 'PURPLE', quantity: 1 }).success).toBe(true);
    expect(buyPowerSchema.safeParse({ power_name: 'SKIP', diamond_type: 'BLUE', quantity: 1 }).success).toBe(false);
  });

  it('quantity 1-50 arasi; sinirlar dahil, disi degil', () => {
    expect(buyPowerSchema.safeParse({ power_name: 'SKIP', diamond_type: 'GREEN', quantity: 1 }).success).toBe(true);
    expect(buyPowerSchema.safeParse({ power_name: 'SKIP', diamond_type: 'GREEN', quantity: 50 }).success).toBe(true);
    expect(buyPowerSchema.safeParse({ power_name: 'SKIP', diamond_type: 'GREEN', quantity: 0 }).success).toBe(false);
    expect(buyPowerSchema.safeParse({ power_name: 'SKIP', diamond_type: 'GREEN', quantity: 51 }).success).toBe(false);
  });
});
