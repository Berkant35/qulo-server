/**
 * Store screenshot profilleri oluşturma scripti
 * Kullanım: npx tsx scripts/seed-store-profiles.ts
 * Silme:    npx tsx scripts/seed-store-profiles.ts --delete
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STORE_EMAIL_DOMAIN = "@qulo.test";
const STORE_PASSWORD = "Test1234!";

interface StoreProfile {
  email: string;
  name: string;
  surname: string;
  age: number;
  bio: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  relationship_goal: string;
  profile_completion: number;
  green_diamonds: number;
  is_online: boolean;
  photos: string[];
  height: number;
  zodiac: string;
  job: string;
  smoking: string;
  alcohol: string;
  personality: string;
  questions: {
    question_text: string;
    correct_answer: number;
    answer_1: string;
    answer_2: string;
    answer_3: string;
    answer_4: string;
    category: string;
  }[];
}

const PROFILES: StoreProfile[] = [
  {
    email: "store_01@qulo.test",
    name: "Sophia",
    surname: "Mitchell",
    age: 24,
    bio: "Fashion runs in my veins. Always chasing the next sunset and a good espresso.",
    city: "New York",
    country: "United States",
    lat: 40.7128,
    lng: -74.0060,
    relationship_goal: "SERIOUS",
    profile_completion: 88,
    green_diamonds: 25,
    is_online: true,
    photos: [
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=80",
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&q=80",
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80",
    ],
    height: 168,
    zodiac: "Libra",
    job: "Fashion Designer",
    smoking: "NO",
    alcohol: "SOMETIMES",
    personality: "Extrovert",
    questions: [
      {
        question_text: "What would you do if your partner got a flirty DM from someone?",
        correct_answer: 2,
        answer_1: "Ignore it completely",
        answer_2: "Talk about it calmly",
        answer_3: "Check their phone immediately",
        answer_4: "Post a couple photo right away",
        category: "relationship",
      },
      {
        question_text: "What's more important — passion or loyalty?",
        correct_answer: 2,
        answer_1: "Passion, always",
        answer_2: "Loyalty, no question",
        answer_3: "They're equally important",
        answer_4: "Depends on the situation",
        category: "personality",
      },
      {
        question_text: "Your partner's ex likes all their photos. Your move?",
        correct_answer: 3,
        answer_1: "Block the ex myself",
        answer_2: "Say nothing, watch closely",
        answer_3: "Bring it up honestly",
        answer_4: "Like all their ex's photos back",
        category: "relationship",
      },
    ],
  },
  {
    email: "store_02@qulo.test",
    name: "Emma",
    surname: "Clarke",
    age: 26,
    bio: "Art curator with a weakness for rooftop sunsets and good conversation.",
    city: "London",
    country: "United Kingdom",
    lat: 51.5074,
    lng: -0.1278,
    relationship_goal: "SERIOUS",
    profile_completion: 90,
    green_diamonds: 18,
    is_online: true,
    photos: [
      "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=800&q=80",
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&q=80",
      "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=80",
    ],
    height: 170,
    zodiac: "Pisces",
    job: "Art Curator",
    smoking: "NO",
    alcohol: "SOMETIMES",
    personality: "Ambivert",
    questions: [
      {
        question_text: "How would you react if your ex texted you 'I miss you'?",
        correct_answer: 1,
        answer_1: "Show it to my partner",
        answer_2: "Reply 'me too' just to be nice",
        answer_3: "Delete it and pretend it never happened",
        answer_4: "Leave them on read forever",
        category: "relationship",
      },
      {
        question_text: "What's the one thing you'd never forgive in a relationship?",
        correct_answer: 3,
        answer_1: "A small white lie",
        answer_2: "Forgetting an anniversary",
        answer_3: "Emotional cheating",
        answer_4: "Being bad at texting",
        category: "personality",
      },
      {
        question_text: "Your partner has a close friend of the opposite gender. Thoughts?",
        correct_answer: 2,
        answer_1: "Absolutely not okay",
        answer_2: "Totally fine, trust is everything",
        answer_3: "Fine, but I want to meet them",
        answer_4: "I'd be secretly jealous",
        category: "relationship",
      },
    ],
  },
  {
    email: "store_03@qulo.test",
    name: "Olivia",
    surname: "Dubois",
    age: 23,
    bio: "Capturing the world one frame at a time. Paris is home, everywhere is inspiration.",
    city: "Paris",
    country: "France",
    lat: 48.8566,
    lng: 2.3522,
    relationship_goal: "NOT_SURE",
    profile_completion: 82,
    green_diamonds: 30,
    is_online: false,
    photos: [
      "https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&q=80",
      "https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?w=800&q=80",
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800&q=80",
      "https://images.unsplash.com/photo-1519699047748-de8e457a634e?w=800&q=80",
    ],
    height: 165,
    zodiac: "Sagittarius",
    job: "Photographer",
    smoking: "NO",
    alcohol: "NO",
    personality: "Introvert",
    questions: [
      {
        question_text: "Would you check your partner's phone if it was unlocked?",
        correct_answer: 4,
        answer_1: "Yes, just a quick peek",
        answer_2: "Only if I suspected something",
        answer_3: "I already know the passcode",
        answer_4: "Never — privacy is sacred",
        category: "relationship",
      },
      {
        question_text: "What's your love language?",
        correct_answer: 3,
        answer_1: "Words of affirmation",
        answer_2: "Gifts and surprises",
        answer_3: "Quality time together",
        answer_4: "Physical touch",
        category: "personality",
      },
      {
        question_text: "Your partner still follows their ex on Instagram. Deal breaker?",
        correct_answer: 2,
        answer_1: "Instant deal breaker",
        answer_2: "Not a big deal, it's just social media",
        answer_3: "I'd unfollow them myself",
        answer_4: "Only if they like their posts",
        category: "relationship",
      },
    ],
  },
  {
    email: "store_04@qulo.test",
    name: "Isabella",
    surname: "Santos",
    age: 27,
    bio: "Finding balance between the mat and the mountains. Namaste meets adventure.",
    city: "Los Angeles",
    country: "United States",
    lat: 34.0522,
    lng: -118.2437,
    relationship_goal: "SERIOUS",
    profile_completion: 85,
    green_diamonds: 22,
    is_online: true,
    photos: [
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80",
      "https://images.unsplash.com/photo-1524638431109-93d95c968f03?w=800&q=80",
      "https://images.unsplash.com/photo-1485893086445-ed75865251e0?w=800&q=80",
    ],
    height: 172,
    zodiac: "Aquarius",
    job: "Yoga Instructor",
    smoking: "NO",
    alcohol: "NO",
    personality: "Ambivert",
    questions: [
      {
        question_text: "Your partner cancels date night for friends — again. What do you do?",
        correct_answer: 1,
        answer_1: "Have an honest conversation about priorities",
        answer_2: "Cancel on them next time",
        answer_3: "Go out with your own friends instead",
        answer_4: "It's fine, everyone needs space",
        category: "relationship",
      },
      {
        question_text: "What matters most in the first 3 months of dating?",
        correct_answer: 2,
        answer_1: "Physical chemistry",
        answer_2: "Emotional connection",
        answer_3: "Having fun together",
        answer_4: "Meeting each other's friends",
        category: "personality",
      },
      {
        question_text: "Someone flirts with your partner right in front of you. Reaction?",
        correct_answer: 3,
        answer_1: "Confront them immediately",
        answer_2: "Pretend you didn't notice",
        answer_3: "Trust your partner to handle it",
        answer_4: "Put your arm around your partner",
        category: "relationship",
      },
    ],
  },
  {
    email: "store_05@qulo.test",
    name: "Mia",
    surname: "Fernandez",
    age: 25,
    bio: "Designing spaces by day, exploring hidden cafés by night.",
    city: "Barcelona",
    country: "Spain",
    lat: 41.3874,
    lng: 2.1686,
    relationship_goal: "FRIENDSHIP",
    profile_completion: 78,
    green_diamonds: 15,
    is_online: false,
    photos: [
      "https://images.unsplash.com/photo-1515023115894-bacee5634647?w=800&q=80",
      "https://images.unsplash.com/photo-1496440737103-cd596325d314?w=800&q=80",
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=80",
    ],
    height: 163,
    zodiac: "Leo",
    job: "Interior Designer",
    smoking: "NO",
    alcohol: "SOMETIMES",
    personality: "Extrovert",
    questions: [
      {
        question_text: "Is it okay to stay friends with an ex?",
        correct_answer: 3,
        answer_1: "Absolutely not",
        answer_2: "Only if the breakup was mutual",
        answer_3: "Yes, if boundaries are clear",
        answer_4: "Only if your partner approves",
        category: "relationship",
      },
      {
        question_text: "What's the biggest red flag on a first date?",
        correct_answer: 2,
        answer_1: "Talking too much about themselves",
        answer_2: "Being rude to the waiter",
        answer_3: "Checking their phone constantly",
        answer_4: "Not offering to split the bill",
        category: "personality",
      },
      {
        question_text: "Your partner gets a promotion and will travel more. How do you feel?",
        correct_answer: 1,
        answer_1: "Proud and supportive",
        answer_2: "Happy but worried about distance",
        answer_3: "Jealous of their success",
        answer_4: "It depends on how much travel",
        category: "lifestyle",
      },
    ],
  },
  {
    email: "store_06@qulo.test",
    name: "Charlotte",
    surname: "de Vries",
    age: 28,
    bio: "Strategy by day, jazz bars by night. Looking for someone who keeps up.",
    city: "Amsterdam",
    country: "Netherlands",
    lat: 52.3676,
    lng: 4.9041,
    relationship_goal: "SERIOUS",
    profile_completion: 90,
    green_diamonds: 28,
    is_online: true,
    photos: [
      "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=800&q=80",
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=800&q=80",
      "https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?w=800&q=80",
      "https://images.unsplash.com/photo-1504439904031-93ded9f93e4e?w=800&q=80",
    ],
    height: 174,
    zodiac: "Virgo",
    job: "Marketing Director",
    smoking: "NO",
    alcohol: "SOMETIMES",
    personality: "Extrovert",
    questions: [
      {
        question_text: "Would you move to another country for love?",
        correct_answer: 2,
        answer_1: "Without hesitation",
        answer_2: "Yes, if we plan it together",
        answer_3: "Only if they moved for me first",
        answer_4: "Never — my career comes first",
        category: "lifestyle",
      },
      {
        question_text: "Your partner's best friend doesn't like you. What's your approach?",
        correct_answer: 3,
        answer_1: "Avoid them completely",
        answer_2: "Try to win them over",
        answer_3: "Be respectful but stay authentic",
        answer_4: "Ask your partner to choose",
        category: "personality",
      },
      {
        question_text: "How soon is too soon to say 'I love you'?",
        correct_answer: 4,
        answer_1: "After the first week",
        answer_2: "After one month",
        answer_3: "After three months",
        answer_4: "When it feels right, timing doesn't matter",
        category: "relationship",
      },
    ],
  },
  {
    email: "store_07@qulo.test",
    name: "Amelia",
    surname: "Rossi",
    age: 22,
    bio: "Life is better when you're dancing. Milan dreams and big ambitions.",
    city: "Milan",
    country: "Italy",
    lat: 45.4642,
    lng: 9.1900,
    relationship_goal: "NOT_SURE",
    profile_completion: 76,
    green_diamonds: 12,
    is_online: false,
    photos: [
      "https://images.unsplash.com/photo-1464863979621-258859e62245?w=800&q=80",
      "https://images.unsplash.com/photo-1513379733131-47fc74b45fc7?w=800&q=80",
      "https://images.unsplash.com/photo-1542206395-9feb3edaa68d?w=800&q=80",
    ],
    height: 160,
    zodiac: "Aries",
    job: "Dance Student",
    smoking: "NO",
    alcohol: "NO",
    personality: "Extrovert",
    questions: [
      {
        question_text: "Your partner likes someone else's thirst trap. Thoughts?",
        correct_answer: 2,
        answer_1: "Start an argument",
        answer_2: "It's just a like, not a big deal",
        answer_3: "Unlike it from their phone",
        answer_4: "Post your own thirst trap",
        category: "relationship",
      },
      {
        question_text: "What's your ideal way to resolve a fight?",
        correct_answer: 3,
        answer_1: "Give each other space for days",
        answer_2: "Talk it out immediately, even if heated",
        answer_3: "Cool down first, then have a calm conversation",
        answer_4: "Apologize even if you're right",
        category: "personality",
      },
      {
        question_text: "Do you believe in soulmates?",
        correct_answer: 2,
        answer_1: "Yes, there's only one person for everyone",
        answer_2: "I believe in deep connections, not destiny",
        answer_3: "Not at all — love is a choice",
        answer_4: "I'm still figuring that out",
        category: "personality",
      },
    ],
  },
  {
    email: "store_08@qulo.test",
    name: "Luna",
    surname: "Park",
    age: 26,
    bio: "Somewhere between the ocean and the next adventure. Science nerd at heart.",
    city: "Sydney",
    country: "Australia",
    lat: -33.8688,
    lng: 151.2093,
    relationship_goal: "SERIOUS",
    profile_completion: 86,
    green_diamonds: 20,
    is_online: true,
    photos: [
      "https://images.unsplash.com/photo-1516726817505-f5ed825624d8?w=800&q=80",
      "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800&q=80",
      "https://images.unsplash.com/photo-1523264653568-d452bc9d6e14?w=800&q=80",
      "https://images.unsplash.com/photo-1502767089025-6572583495f9?w=800&q=80",
    ],
    height: 167,
    zodiac: "Cancer",
    job: "Marine Biologist",
    smoking: "NO",
    alcohol: "SOMETIMES",
    personality: "Introvert",
    questions: [
      {
        question_text: "What's a bigger turn-off — arrogance or insecurity?",
        correct_answer: 1,
        answer_1: "Arrogance, confidence isn't loud",
        answer_2: "Insecurity, it drains energy",
        answer_3: "Both are equally bad",
        answer_4: "Neither — everyone has flaws",
        category: "personality",
      },
      {
        question_text: "Your partner wants to read your journal. Do you let them?",
        correct_answer: 4,
        answer_1: "Sure, I have nothing to hide",
        answer_2: "Only the happy parts",
        answer_3: "Read it together so I can explain",
        answer_4: "No — some thoughts are just mine",
        category: "relationship",
      },
      {
        question_text: "Long distance — could you make it work?",
        correct_answer: 2,
        answer_1: "No way, I need physical presence",
        answer_2: "Yes, if there's an end date",
        answer_3: "Only for a few months max",
        answer_4: "I've done it and never again",
        category: "lifestyle",
      },
    ],
  },
];

async function seedStoreProfiles() {
  console.log("\n🎬 Creating 8 store screenshot profiles...\n");

  const passwordHash = await bcrypt.hash(STORE_PASSWORD, 12);
  let created = 0;

  for (const p of PROFILES) {
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", p.email)
      .maybeSingle();

    if (existing) {
      console.log(`  ⏭️  ${p.name} (${p.email}) already exists, skipping`);
      continue;
    }

    const { data: inserted, error } = await supabase
      .from("users")
      .insert({
        email: p.email,
        password_hash: passwordHash,
        name: p.name,
        surname: p.surname,
        age: p.age,
        gender: "WOMAN",
        gender_pref: "MAN",
        bio: p.bio,
        city: p.city,
        country: p.country,
        lat: p.lat,
        lng: p.lng,
        locale: "en",
        match_radius_km: 50,
        age_pref_min: Math.max(18, p.age - 5),
        age_pref_max: p.age + 8,
        relationship_goal: p.relationship_goal,
        email_verified: true,
        is_online: p.is_online,
        profile_completion: p.profile_completion,
        green_diamonds: p.green_diamonds,
        preferred_languages: ["en"],
        photos: p.photos,
        referral_code: `S${p.email.match(/\d+/)![0]}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error(`  ❌ ${p.name}: ${error.message}`);
      continue;
    }

    if (inserted) {
      await supabase.from("user_details").insert({
        user_id: inserted.id,
        height: p.height,
        zodiac: p.zodiac,
        job: p.job,
        smoking: p.smoking,
        alcohol: p.alcohol,
        personality: p.personality,
      });

      await supabase.from("user_languages").insert({
        user_id: inserted.id,
        locale: "en",
      });

      for (let qi = 0; qi < p.questions.length; qi++) {
        const q = p.questions[qi];
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
          locale: "en",
        });
      }
    }

    created++;
    console.log(`  ✅ ${p.name} (${p.city}) — ${p.questions.length} questions, ${p.photos.length} photos`);
  }

  console.log(`\n📊 Result: ${created} profiles created`);
  console.log(`📧 Emails: store_01@qulo.test → store_08@qulo.test`);
  console.log(`🔑 Password: ${STORE_PASSWORD}`);
  console.log(`\n🗑️  Delete: npx tsx scripts/seed-store-profiles.ts --delete\n`);
}

async function deleteStoreProfiles() {
  console.log("\n🗑️  Deleting store screenshot profiles...\n");

  const { data: storeUsers, error: fetchError } = await supabase
    .from("users")
    .select("id, email")
    .like("email", "store_%@qulo.test");

  if (fetchError) {
    console.error("❌ Error fetching:", fetchError.message);
    return;
  }

  if (!storeUsers || storeUsers.length === 0) {
    console.log("ℹ️  No store profiles found.");
    return;
  }

  const userIds = storeUsers.map((u) => u.id);
  console.log(`  📋 Found ${userIds.length} store profiles`);

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
      process.stdout.write(`  🧹 ${table} cleaned\n`);
    }
  }

  await supabase.from("swipes").delete().in("target_id", userIds);
  await supabase.from("matches").delete().in("user2_id", userIds);

  const { error: deleteError } = await supabase
    .from("users")
    .delete()
    .like("email", "store_%@qulo.test");

  if (deleteError) {
    console.error("❌ Delete error:", deleteError.message);
    return;
  }

  console.log(`\n✅ ${userIds.length} store profiles and related data deleted.\n`);
}

// --- Main ---
const isDelete = process.argv.includes("--delete");

if (isDelete) {
  deleteStoreProfiles().catch(console.error);
} else {
  seedStoreProfiles().catch(console.error);
}
