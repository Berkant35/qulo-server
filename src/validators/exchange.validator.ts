import { z } from "zod";

// Donusum orani SABIT DEGIL: `greenToPurpleRatio` economy config'te ve
// backoffice'ten 1-10 arasina cekilebiliyor (economy-config.schema.ts:9).
// Burada eskiden `min(3)` + `% 3` vardi; oran 4'e cekilseydi mobil config'ten
// okudugu icin 4'un katini gonderir, bu validator reddederdi (400) ve donusum
// tamamen kirilirdi. Oran 1 ya da 2 olsaydi da `min(3)` gecerli miktarlari
// bloklardi.
//
// Asil kontrol zaten dogru yerde: `exchange.service.ts:11` config'ten okudugu
// oranla `greenAmount % ratio` bakiyor ve orani iceren bir hata mesaji donuyor.
// Burasi yalnizca tip ve makul ust sinir kapisi olarak kaldi.
export const convertSchema = z.object({
  green_amount: z.number().int().min(1).max(1000000),
});

export const buyPowerSchema = z.object({
  power_name: z.enum(["ORACLE", "HALF", "SKIP", "SKIP_ALL", "TIME_EXTEND", "HINT", "POWER_BLOCK", "POWER_UNBLOCK"]),
  diamond_type: z.enum(["GREEN", "PURPLE"]),
  quantity: z.number().int().min(1).max(50),
});

export type ConvertInput = z.infer<typeof convertSchema>;
export type BuyPowerInput = z.infer<typeof buyPowerSchema>;
