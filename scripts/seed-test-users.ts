/**
 * Test kullanıcıları oluşturma scripti
 * Kullanım: npx tsx scripts/seed-test-users.ts
 * Silme:    npx tsx scripts/seed-test-users.ts --delete
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_EMAIL_DOMAIN = "@qulo.test";
const TEST_PASSWORD = "Test1234!";
const TOTAL_USERS = 55;

// --- Türkçe isim havuzu ---
const FEMALE_NAMES = [
  "Elif", "Zeynep", "Ayşe", "Defne", "Ecrin", "Meryem", "Yağmur", "Nehir",
  "Sude", "Azra", "Buse", "Ceren", "Damla", "Eylül", "Funda", "Gizem",
  "Hande", "Ilgın", "Jale", "Kardelen", "Lale", "Melis", "Naz", "Öykü",
  "Pınar", "Rana", "Selin", "Tuğçe",
];

const MALE_NAMES = [
  "Yusuf", "Berat", "Eymen", "Miraç", "Ömer", "Kerem", "Burak", "Kaan",
  "Arda", "Emre", "Cem", "Deniz", "Erdem", "Furkan", "Gökhan", "Hakan",
  "Ilker", "Kağan", "Levent", "Mert", "Onur", "Polat", "Rüzgar", "Serkan",
  "Tarık", "Umut", "Volkan", "Yiğit",
];

const SURNAMES = [
  "Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Yıldız", "Yıldırım",
  "Öztürk", "Aydın", "Arslan", "Doğan", "Kılıç", "Aslan", "Çetin",
  "Koç", "Kurt", "Özdemir", "Şimşek", "Polat", "Erdoğan", "Ak", "Korkmaz",
  "Acar", "Uçar", "Tunç", "Güneş", "Başaran", "Tekin",
];

const BIOS = [
  "Hayat kısa, kahve güzel ☕",
  "Kitap kurdu 📚 Müzik aşığı 🎵",
  "Seyahat etmeyi seviyorum ✈️",
  "Spor ve doğa 🏃‍♂️🌿",
  "Film & dizi öneriniz varsa yazın 🎬",
  "Yeni insanlarla tanışmayı seviyorum",
  "Fotoğrafçılık hobim 📷",
  "Kod yazarım, kahve içerim ☕💻",
  "Mutfakta harikalar yaratan biri 🍳",
  "Yoga ve meditasyon 🧘",
  null, // bazıları bio'suz
  null,
];

// Hepsi İstanbul — discover radius'a girsin
const ISTANBUL_DISTRICTS = [
  { city: "İstanbul", lat: 41.0082, lng: 28.9784 },  // Sultanahmet
  { city: "İstanbul", lat: 41.0370, lng: 28.9850 },  // Beyoğlu
  { city: "İstanbul", lat: 41.0053, lng: 28.9770 },  // Fatih
  { city: "İstanbul", lat: 41.0595, lng: 29.0090 },  // Beşiktaş
  { city: "İstanbul", lat: 41.0766, lng: 29.0310 },  // Sarıyer
  { city: "İstanbul", lat: 40.9910, lng: 29.0230 },  // Kadıköy
  { city: "İstanbul", lat: 40.9629, lng: 29.0930 },  // Pendik
  { city: "İstanbul", lat: 41.0186, lng: 28.9516 },  // Zeytinburnu
  { city: "İstanbul", lat: 41.0500, lng: 28.9940 },  // Şişli
  { city: "İstanbul", lat: 41.1050, lng: 29.0250 },  // Maslak
];

const ZODIACS = [
  "Koç", "Boğa", "İkizler", "Yengeç", "Aslan", "Başak",
  "Terazi", "Akrep", "Yay", "Oğlak", "Kova", "Balık",
];

const JOBS = [
  "Yazılımcı", "Öğretmen", "Doktor", "Mühendis", "Tasarımcı",
  "Avukat", "Eczacı", "Mimar", "Psikolog", "Akademisyen",
  "Girişimci", "Pazarlamacı", "Hemşire", "Muhasebeci", null,
];

const RELATIONSHIP_GOALS = ["SERIOUS", "FRIENDSHIP", "NOT_SURE"];

// Soru havuzu — her kullanıcıya 2-3 soru atanacak
const QUESTION_POOL = [
  {
    question_text: "En sevdiğin mevsim hangisi?",
    correct_answer: 1,
    answer_1: "Sonbahar",
    answer_2: "İlkbahar",
    answer_3: "Yaz",
    answer_4: "Kış",
    category: "lifestyle",
  },
  {
    question_text: "Hafta sonu planın ne olur genelde?",
    correct_answer: 1,
    answer_1: "Doğa yürüyüşü",
    answer_2: "Netflix maratonu",
    answer_3: "Arkadaşlarla buluşma",
    answer_4: "Evde dinlenme",
    category: "lifestyle",
  },
  {
    question_text: "Kahve mi çay mı?",
    correct_answer: 1,
    answer_1: "Kahve",
    answer_2: "Çay",
    answer_3: "İkisi de",
    answer_4: "Hiçbiri",
    category: "lifestyle",
  },
  {
    question_text: "Hangi müzik türünü daha çok dinlersin?",
    correct_answer: 1,
    answer_1: "Pop",
    answer_2: "Rock",
    answer_3: "Rap/Hip-Hop",
    answer_4: "Klasik",
    category: "entertainment",
  },
  {
    question_text: "Bir süper gücün olsa ne olurdu?",
    correct_answer: 1,
    answer_1: "Işınlanma",
    answer_2: "Görünmezlik",
    answer_3: "Uçma",
    answer_4: "Zaman yolculuğu",
    category: "fun",
  },
  {
    question_text: "Tatilde ne yaparsın?",
    correct_answer: 1,
    answer_1: "Yeni yerler keşfederim",
    answer_2: "Sahilde uzanırım",
    answer_3: "Macera sporları",
    answer_4: "Kültürel geziler",
    category: "travel",
  },
  {
    question_text: "En sevdiğin yemek türü?",
    correct_answer: 3,
    answer_1: "Türk mutfağı",
    answer_2: "İtalyan",
    answer_3: "Uzak Doğu",
    answer_4: "Fast food",
    category: "lifestyle",
  },
  {
    question_text: "Sabah insanı mısın gece insanı mı?",
    correct_answer: 2,
    answer_1: "Gece kuşu",
    answer_2: "Sabah insanı",
    answer_3: "Duruma göre değişir",
    answer_4: "Her zaman uykulu",
    category: "personality",
  },
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateReferralCode(index: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const prefix = "T"; // T for tester
  let code = prefix + String(index).padStart(2, "0");
  while (code.length < 8) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * range * 2;
}

function generateUsers(count: number) {
  const users = [];
  const womanCount = Math.floor(count * 0.5);

  for (let i = 1; i <= count; i++) {
    const isWoman = i <= womanCount;
    const gender = isWoman ? "WOMAN" : "MAN";
    const name = isWoman ? randomItem(FEMALE_NAMES) : randomItem(MALE_NAMES);
    const surname = randomItem(SURNAMES);
    const location = randomItem(ISTANBUL_DISTRICTS);
    const age = randomInt(20, 34);

    users.push({
      email: `tester_${String(i).padStart(3, "0")}${TEST_EMAIL_DOMAIN}`,
      name,
      surname,
      age,
      gender,
      gender_pref: isWoman ? "MAN" : "WOMAN",
      bio: randomItem(BIOS),
      city: location.city,
      country: "Türkiye",
      lat: jitter(location.lat, 0.05),
      lng: jitter(location.lng, 0.05),
      locale: "tr",
      match_radius_km: randomInt(10, 100),
      age_pref_min: Math.max(18, age - randomInt(3, 6)),
      age_pref_max: age + randomInt(3, 8),
      relationship_goal: randomItem(RELATIONSHIP_GOALS),
      email_verified: true,
      is_online: Math.random() > 0.5,
      profile_completion: randomInt(40, 85),
      green_diamonds: randomInt(0, 50),
      preferred_languages: ["tr"],
      // details
      _zodiac: randomItem(ZODIACS),
      _job: randomItem(JOBS),
      _height: randomInt(155, 195),
      referral_code: generateReferralCode(i),
    });
  }
  return users;
}

async function seedUsers() {
  console.log(`\n🔄 ${TOTAL_USERS} test kullanıcısı oluşturuluyor...\n`);

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const users = generateUsers(TOTAL_USERS);

  let created = 0;
  let skipped = 0;

  for (const u of users) {
    // Check if exists
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", u.email)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    // Insert user
    const { data: inserted, error } = await supabase
      .from("users")
      .insert({
        email: u.email,
        password_hash: passwordHash,
        name: u.name,
        surname: u.surname,
        age: u.age,
        gender: u.gender,
        gender_pref: u.gender_pref,
        bio: u.bio,
        city: u.city,
        country: u.country,
        lat: u.lat,
        lng: u.lng,
        locale: u.locale,
        match_radius_km: u.match_radius_km,
        age_pref_min: u.age_pref_min,
        age_pref_max: u.age_pref_max,
        relationship_goal: u.relationship_goal,
        email_verified: u.email_verified,
        is_online: u.is_online,
        profile_completion: u.profile_completion,
        green_diamonds: u.green_diamonds,
        preferred_languages: u.preferred_languages,
        referral_code: u.referral_code,
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`❌ ${u.email}: ${error.message}`);
      continue;
    }

    // Insert user_details, user_languages, questions
    if (inserted) {
      await supabase.from("user_details").insert({
        user_id: inserted.id,
        zodiac: u._zodiac,
        job: u._job,
        height: u._height,
      });

      await supabase.from("user_languages").insert({
        user_id: inserted.id,
        locale: "tr",
      });

      // Her kullanıcıya 2-3 soru ekle
      const questionCount = randomInt(2, 3);
      const shuffled = [...QUESTION_POOL].sort(() => Math.random() - 0.5);
      const selectedQuestions = shuffled.slice(0, questionCount);

      for (let qi = 0; qi < selectedQuestions.length; qi++) {
        const q = selectedQuestions[qi];
        await supabase.from("questions").insert({
          user_id: inserted.id,
          order_num: qi + 1,
          question_text: q.question_text,
          correct_answer: q.correct_answer,
          answer_1: q.answer_1,
          answer_2: q.answer_2,
          answer_3: q.answer_3,
          answer_4: q.answer_4,
          category: q.category,
          time_limit: 30,
          locale: "tr",
        });
      }
    }

    created++;
    process.stdout.write(`\r  ✅ ${created}/${TOTAL_USERS} oluşturuldu`);
  }

  console.log(`\n\n📊 Sonuç: ${created} oluşturuldu, ${skipped} zaten vardı`);
  console.log(`📧 Email pattern: tester_001${TEST_EMAIL_DOMAIN} → tester_${String(TOTAL_USERS).padStart(3, "0")}${TEST_EMAIL_DOMAIN}`);
  console.log(`🔑 Şifre: ${TEST_PASSWORD}`);
  console.log(`\n🗑️  Silmek için: npx tsx scripts/seed-test-users.ts --delete\n`);
}

async function deleteUsers() {
  console.log(`\n🗑️  Test kullanıcıları siliniyor (${TEST_EMAIL_DOMAIN})...\n`);

  // Get all test user IDs first
  const { data: testUsers, error: fetchError } = await supabase
    .from("users")
    .select("id, email")
    .like("email", `%${TEST_EMAIL_DOMAIN}`);

  if (fetchError) {
    console.error("❌ Kullanıcılar alınamadı:", fetchError.message);
    return;
  }

  if (!testUsers || testUsers.length === 0) {
    console.log("ℹ️  Silinecek test kullanıcısı bulunamadı.");
    return;
  }

  const userIds = testUsers.map((u) => u.id);
  console.log(`  📋 ${userIds.length} test kullanıcısı bulundu`);

  // Delete related records first (foreign key constraints)
  const relatedTables = [
    "user_details",
    "user_languages",
    "refresh_tokens",
    "swipes",
    "matches",
    "messages",
    "questions",
    "diamond_transactions",
    "user_badges",
    "referrals",
    "notifications",
  ];

  for (const table of relatedTables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .in("user_id", userIds);

    if (error && !error.message.includes("does not exist")) {
      console.log(`  ⚠️  ${table}: ${error.message}`);
    } else {
      process.stdout.write(`  🧹 ${table} temizlendi\n`);
    }
  }

  // Also clean swipes/matches where test user is the target
  for (const table of ["swipes"]) {
    await supabase.from(table).delete().in("target_id", userIds);
  }
  for (const table of ["matches"]) {
    await supabase.from(table).delete().in("user2_id", userIds);
  }

  // Delete users
  const { error: deleteError } = await supabase
    .from("users")
    .delete()
    .like("email", `%${TEST_EMAIL_DOMAIN}`);

  if (deleteError) {
    console.error("❌ Silme hatası:", deleteError.message);
    return;
  }

  console.log(`\n✅ ${userIds.length} test kullanıcısı ve ilişkili verileri silindi.\n`);
}

async function addPhotos() {
  console.log(`\n📷 Test kullanıcılarına fotoğraf ekleniyor...\n`);

  const { data: testUsers, error } = await supabase
    .from("users")
    .select("id, gender")
    .like("email", `%${TEST_EMAIL_DOMAIN}`);

  if (error || !testUsers?.length) {
    console.error("❌ Kullanıcılar alınamadı:", error?.message ?? "boş liste");
    return;
  }

  let updated = 0;
  for (const user of testUsers) {
    const isMale = user.gender === "MAN";
    const gender = isMale ? "men" : "women";
    const photoCount = randomInt(2, 5);
    const usedIndices = new Set<number>();
    const photos: string[] = [];

    while (photos.length < photoCount) {
      const idx = randomInt(1, 99);
      if (usedIndices.has(idx)) continue;
      usedIndices.add(idx);
      photos.push(
        `https://randomuser.me/api/portraits/${gender}/${idx}.jpg`
      );
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ photos })
      .eq("id", user.id);

    if (updateError) {
      console.error(`❌ ${user.id}: ${updateError.message}`);
    } else {
      updated++;
    }
  }

  console.log(`✅ ${updated}/${testUsers.length} kullanıcıya fotoğraf eklendi.\n`);
}

// --- Main ---
const isDelete = process.argv.includes("--delete");
const isPhotos = process.argv.includes("--photos");

if (isDelete) {
  deleteUsers().catch(console.error);
} else if (isPhotos) {
  addPhotos().catch(console.error);
} else {
  seedUsers().catch(console.error);
}
