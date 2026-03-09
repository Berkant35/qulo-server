import { supabase } from "../config/supabase.js";
import { subscriptionService } from "./subscription.service.js";
import { Errors } from "../utils/errors.js";

export class PassportService {
  async activate(userId: string, city: string, lat: number, lng: number) {
    // 1. Premium kontrolü
    const sub = await subscriptionService.getStatus(userId);
    if (!sub.isActive || sub.plan !== "premium") {
      throw Errors.PASSPORT_REQUIRES_PREMIUM();
    }

    // 2. Zaten aktif mi kontrol
    const { data: user } = await supabase
      .from("users")
      .select("passport_city")
      .eq("id", userId)
      .single();

    if (user?.passport_city) {
      throw Errors.PASSPORT_ALREADY_ACTIVE();
    }

    // 3. Passport alanlarını güncelle
    const { error } = await supabase
      .from("users")
      .update({
        passport_city: city,
        passport_lat: lat,
        passport_lng: lng,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw Errors.SERVER_ERROR();

    return { passport_city: city, passport_lat: lat, passport_lng: lng };
  }

  async deactivate(userId: string) {
    const { error } = await supabase
      .from("users")
      .update({
        passport_city: null,
        passport_lat: null,
        passport_lng: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (error) throw Errors.SERVER_ERROR();
    return { message: "Passport deactivated" };
  }
}

export const passportService = new PassportService();
