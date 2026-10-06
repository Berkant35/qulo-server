import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { appConfigService } from "./app-config.service.js";
import { isMutuallyCompatible } from "./compatibility.js";

/**
 * Discover filtresinin yazma yollarındaki karşılığı: doğrudan API ile uyumsuz birine beğeni
 * ya da quiz başlatılamaz. Kural compatibility.ts'te; anahtar kapalıyken hiç sorgu atılmaz.
 *
 * Uyumsuzluk var olmayan hedefle AYNI yanıtı (404 USER_NOT_FOUND) verir — eskiden 403
 * NOT_COMPATIBLE dönüyordu ve bilinen UUID'nin cinsiyet tercihi bu farktan okunuyordu
 * (spec 2026-10-06 kehanet açığı). `Errors.NOT_COMPATIBLE` eski istemci eşlemesi için duruyor.
 */
class PairCompatibilityService {
  async assertCompatible(viewerId: string, targetId: string): Promise<void> {
    if (!(await appConfigService.getMutualMatchEnabled())) return;
    const { data, error } = await supabase
      .from("users")
      .select("id, gender, gender_pref")
      .in("id", [viewerId, targetId])
      .eq("is_deleted", false);
    if (error) throw Errors.SERVER_ERROR();
    const viewer = data?.find((row) => row.id === viewerId);
    const target = data?.find((row) => row.id === targetId);
    if (!viewer || !target || !isMutuallyCompatible(viewer, target)) throw Errors.USER_NOT_FOUND();
  }
}

export const pairCompatibilityService = new PairCompatibilityService();
