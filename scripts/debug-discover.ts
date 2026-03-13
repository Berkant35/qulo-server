import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
);

async function debug() {
  // 1. Gerçek hesaplar
  const { data: realUsers } = await supabase
    .from("users")
    .select("id, email, gender, gender_pref, age_pref_min, age_pref_max, match_radius_km, lat, lng, passport_lat, passport_lng, preferred_languages, is_deleted, email_verified")
    .not("email", "like", "%@qulo.test")
    .eq("is_deleted", false)
    .eq("email_verified", true);

  console.log("=== GERÇEK HESAPLAR ===");
  for (const u of realUsers || []) {
    console.log(JSON.stringify(u, null, 2));
  }

  // 2. Test kullanıcılarından örnek
  const { data: testers } = await supabase
    .from("users")
    .select("id, email, gender, age, lat, lng, last_seen_at, email_verified, is_deleted")
    .like("email", "%@qulo.test")
    .limit(3);

  console.log("\n=== TEST KULLANICILARI (3 örnek) ===");
  for (const t of testers || []) {
    console.log(JSON.stringify(t, null, 2));
  }

  // 3. Test kullanıcılarının soru sayısı
  const { data: allTesters } = await supabase
    .from("users")
    .select("id")
    .like("email", "%@qulo.test");

  const testerIds = (allTesters || []).map((t: any) => t.id);
  const { data: questions } = await supabase
    .from("questions")
    .select("user_id")
    .in("user_id", testerIds);

  const qMap = new Map<string, number>();
  for (const q of questions || []) {
    qMap.set(q.user_id as string, (qMap.get(q.user_id as string) || 0) + 1);
  }

  let has2Plus = 0;
  for (const [, count] of qMap) {
    if (count >= 2) has2Plus++;
  }
  console.log("\n=== SORU İSTATİSTİĞİ ===");
  console.log("Toplam test user:", testerIds.length);
  console.log("2+ sorusu olan:", has2Plus);

  // 4. Senin hesabınla discover simülasyonu
  if (realUsers && realUsers.length > 0) {
    const me = realUsers[0];
    console.log("\n=== DISCOVER SİMÜLASYONU ===");
    console.log("Senin gender_pref:", me.gender_pref);
    console.log("Senin age range:", me.age_pref_min, "-", me.age_pref_max);
    console.log("Senin konum:", me.lat, me.lng);
    console.log("Senin radius:", me.match_radius_km);
    console.log("Senin diller:", me.preferred_languages);

    // Gender pref'e göre kaç test user uyuyor
    const { data: genderMatch } = await supabase
      .from("users")
      .select("id, gender, age")
      .like("email", "%@qulo.test")
      .eq("is_deleted", false)
      .eq("email_verified", true);

    const genderFiltered = (genderMatch || []).filter((u: any) => {
      if (me.gender_pref === "BOTH") return true;
      return u.gender === me.gender_pref;
    });
    console.log("\nGender filter sonrası:", genderFiltered.length, "/", (genderMatch || []).length);

    const ageFiltered = genderFiltered.filter((u: any) => {
      return u.age >= (me.age_pref_min || 18) && u.age <= (me.age_pref_max || 99);
    });
    console.log("Age filter sonrası:", ageFiltered.length);

    // 7 gün kontrolü
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: activeTesters } = await supabase
      .from("users")
      .select("id, last_seen_at")
      .like("email", "%@qulo.test")
      .gte("last_seen_at", sevenDaysAgo);
    console.log("7-gün aktif olanlar:", (activeTesters || []).length);
  }
}

debug().catch(console.error);
