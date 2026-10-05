import { supabase } from "../config/supabase.js";
import { resolveLocale } from "../utils/locales.js";
import { localeText } from "../utils/server-locales.js";
import { questionLocale } from "../constants/locales.js";
import type { SupportedLocale } from "../constants/locales.js";
import { Errors } from "../utils/errors.js";
import { resolveDistanceTier } from "../utils/distance-tier.js";
import { haversineDistance } from "../utils/math.js";
import { assertUuid, isUuid } from "../utils/validation.js";
import { appConfigService } from "./app-config.service.js";
import { blockService } from "./block.service.js";
import { bucketOf, candidatePrefFilter, wantsOf } from "./compatibility.js";
import { evaluateRetry, quizRetryService, type RetrySessionRow } from "./quiz-retry.service.js";
import { scoringService } from "./scoring.service.js";
import { subscriptionService } from "./subscription.service.js";
import { userLanguageService } from "./user-language.service.js";

const PAGE_SIZE = 10;
/** Tek seferde cekilen aday tavani. Havuz ~72; 500 rahat bir ust sinir. */
const CANDIDATE_FETCH_LIMIT = 500;
/** URL uzunlugu icin dislama listesi tavani; asilirsa kalani bellekte elenir. */
const MAX_EXCLUDE_IDS = 1000;

/**
 * Discover sira grubu: 0 = aktif gercek, 1 = seed, 2 = uyuyan gercek.
 * Seed'in kendi aktifligi bakilmaz (presence ritmi yapay); seed her zaman grup 1.
 */
function discoverGroupRank(isSeed: boolean, isDormant: boolean): number {
  if (isSeed) return 1;
  return isDormant ? 2 : 0;
}

/** `match_list_summaries` satiri (migration 070): mesajsiz eslesmede son mesaj alanlari NULL. */
interface MatchListSummary {
  match_id: string;
  content: string | null;
  sender_id: string | null;
  is_image: boolean | null;
  audio_url: string | null;
  created_at: string | null;
  unread_count: number;
}

interface CandidateRow {
  id: string;
  name: string;
  bio: string | null;
  age: number;
  gender: string;
  city: string | null;
  lat: number;
  lng: number;
  photos: string[] | null;
  profile_completion: number;
  green_diamonds: number;
  like_received_count: number;
  times_shown_count: number;
  last_seen_at: string;
  boost_until: string | null;
  relationship_goal: string | null;
  /** Seed (test) profili: gercek adaylar tukenmeden gosterilmez. */
  is_seed_profile: boolean | null;
}

interface QuestionInfo {
  count: number;
  categories: string[];
  avg_difficulty: string;
  languages: string[];
}

interface ProfileCard {
  user_id: string;
  name: string;
  age: number;
  city: string | null;
  bio: string | null;
  photos: string[] | null;
  distance_km: number;
  /** 0 = kullanicinin radius'u icinde, 3 = en uzak. Siralamada birincil anahtar. */
  distance_tier: number;
  question_count: number;
  profile_completion: number;
  is_boosted: boolean;
  question_info: QuestionInfo;
  relationship_goal: string | null;
}

export class MatchingService {
  /**
   * Discover candidates for a user.
   */
  async discover(
    userId: string,
    page = 1,
  ): Promise<{
    cards: ProfileCard[];
    page: number;
    has_more: boolean;
    empty_reason?: 'language' | 'no_candidates';
  }> {
    assertUuid(userId, "userId");
    // 1. Get current user + already-swiped IDs + basarisiz quiz gecmisi in parallel
    const [userResult, swipedResult, matchResult, retryHistory, retryDays] = await Promise.all([
      supabase
        .from("users")
        .select(
          "id, gender, gender_pref, gender_pref_set_at, pref_consent_status, age_pref_min, age_pref_max, match_radius_km, lat, lng, passport_lat, passport_lng, preferred_languages, locale, is_test_admin",
        )
        .eq("id", userId)
        .eq("is_deleted", false)
        .maybeSingle(),
      supabase
        .from("swipes")
        .select("target_id, action, created_at")
        .eq("swiper_id", userId)
        // Siralamasiz kesme, duzeltilen aday sorgusu bug'inin ayni sinifi:
        // tavan asilirsa rastgele bir alt kume gelir ve swipe edilmis
        // profiller discover'a geri doner. En yeniden basla.
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase
        .from("matches")
        // Pasif eslesme de okunur: aktif olan dislanir (eskisi gibi), pasif olan yalniz tekrar
        // hakkini kapatir (eslesip ayrilmis biri "basarisiz quiz" diye geri donmesin).
        .select("user1_id, user2_id, is_active")
        .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
        .order("matched_at", { ascending: false })
        .limit(5000),
      // Basarisiz quiz'in hedefine tek tekrar (quiz-retry.service). Tek hafif sorgu, paralel.
      quizRetryService.loadSolverHistory(userId),
      quizRetryService.getRetryDays(),
    ]);

    const { data: user, error: userError } = userResult;
    if (userError || !user) throw Errors.USER_NOT_FOUND();

    // Tercih SECILMEDEN deste kurulmaz. `gender_pref` DB varsayilani 'BOTH'
    // (legacy/001) — set_at bos iken bu bir secim degil, "henuz sorulmadi"dir.
    // Mobil complete-profile'dan hemen sonra discover'i onceden ceker, tercih
    // adimi (PATCH /me) SONRA gelir ve deste yenilenmez: prod 29 Eyl-3 Eki,
    // tercihi WOMAN olan 9 erkek bu filtresiz desteden 55 erkek kart kaydirdi.
    // Mobil kurulum kapisi da tercihi zorunlu sayar (`setupComplete` →
    // `hasGenderPref`); hata, onceden cekmeyi bozar ve Discover acilinca deste
    // dogru filtreyle yeniden cekilir.
    // Rızasını reddeden kullanıcının tercihi saklanmaz (KVKK m.6, migration 075) — "Herkes"
    // modunda deste kurulur; set_at boş olsa da bu bir seçimdir.
    if (!user.gender_pref_set_at && user.pref_consent_status !== "DECLINED") throw Errors.PROFILE_INCOMPLETE();

    // Dil tercihleri + uyuyan-aday esigi (app_config, 60 sn onbellekli — istek basina DB yok)
    const [userLanguages, dormantDays, mutualMatch] = await Promise.all([
      userLanguageService.getUserLanguages(userId),
      appConfigService.getDiscoverDormantDays(),
      appConfigService.getMutualMatchEnabled(),
    ]);
    const viewerBucket = bucketOf(user);
    if (mutualMatch && !viewerBucket) throw Errors.PROFILE_INCOMPLETE();

    // Determine location (passport overrides real)
    const myLat = (user.passport_lat as number | null) ?? user.lat;
    const myLng = (user.passport_lng as number | null) ?? user.lng;

    if (myLat == null || myLng == null) {
      throw Errors.PROFILE_INCOMPLETE();
    }

    const maxRadius: number = user.match_radius_km ?? 100;

    const { data: swipedRows } = swipedResult;
    const { data: matchRows } = matchResult;

    // Get blocked user IDs (both directions)
    const [blockedIds, blockerIds] = await Promise.all([
      blockService.getBlockedIds(userId),
      blockService.getBlockerIds(userId),
    ]);

    const matchedEverIds = new Set<string>();
    const activeMatchIds = new Set<string>();
    for (const m of matchRows ?? []) {
      const otherId = m.user1_id === userId ? (m.user2_id as string) : (m.user1_id as string);
      matchedEverIds.add(otherId);
      if (m.is_active) activeMatchIds.add(otherId);
    }

    // Basarisiz quiz gecmisi: tekrar adayi (bekleme dolmus ya da soru degisikligiyle dolabilecek)
    // swipe dislamasindan muaf tutulur; kesin karar soru zamanlari okununca (adim 5.7). Hakki
    // bitmis / ozellik kapali hedef swipe satiri olmasa da (undo) dislanir — sunucu quiz'i reddeder.
    const retryPending = new Map<string, { sessions: RetrySessionRow[]; lastFailedAt: Date }>();
    const historyExcluded = new Set<string>();
    for (const [targetId, sessions] of retryHistory ?? []) {
      if (matchedEverIds.has(targetId)) continue;
      const { verdict, lastFailedAt } = evaluateRetry(sessions, { retryDays, now: new Date() });
      if ((verdict === "eligible" || verdict === "cooldown") && lastFailedAt) {
        retryPending.set(targetId, { sessions, lastFailedAt });
      } else if (verdict === "exhausted" || verdict === "disabled") {
        historyExcluded.add(targetId);
      }
    }

    const excludedIds = new Set<string>([userId, ...blockedIds, ...blockerIds, ...activeMatchIds, ...historyExcluded]);
    for (const row of swipedRows ?? []) {
      const targetId = row.target_id as string;
      // Yalniz basarisizliktan ONCE atilmis LIKE muaf: quiz LIKE'tan sonra baslar; REJECT kalici kalir.
      // Yenilenmis LIKE (tekrar hakki kullanildi, quiz baslamadi) ilk LIKE gibi desteden cikar.
      const pending = retryPending.get(targetId);
      const likedBeforeFailure =
        pending != null && Date.parse(row.created_at as string) < pending.lastFailedAt.getTime();
      if (row.action === "LIKE" && likedBeforeFailure) continue;
      excludedIds.add(targetId);
    }
    for (const targetId of retryPending.keys()) {
      if (excludedIds.has(targetId)) retryPending.delete(targetId);
    }

    // 3. Query candidates
    // Dislama sorguya tasindi: eskiden 50 satir SIRALAMASIZ cekilip dislama
    // sonrasinda bellekte yapiliyordu, yani havuzun bir kismi hicbir izleyiciye
    // gorunmuyordu (prod: 72 adayin 22'si).
    // `.not()` degeri HAM PostgREST sozdizimi olarak gecirir (postgrest-js
    // sanitize etmez, parantez eklemez): dizi verilirse URL `id=not.in.a,b`
    // olur ve PostgREST parse hatasi doner. Parantezi biz kuruyoruz, degerleri
    // de UUID suzgecinden geciriyoruz — bicim disi bir id filtreyi bozamaz.
    const excludeList = [...excludedIds].filter(isUuid).slice(0, MAX_EXCLUDE_IDS);
    const excludeFilter = `(${excludeList.join(",")})`;

    let query = supabase
      .from("users")
      .select(
        "id, name, bio, age, gender, city, lat, lng, photos, profile_completion, green_diamonds, like_received_count, times_shown_count, last_seen_at, boost_until, relationship_goal, is_seed_profile",
      )
      .eq("is_deleted", false)
      .eq("is_banned", false)
      // email_verified filtresi YOK (2026-10-04): doğrulanmamış kullanıcı da havuzda görünür
      // (havuz küçük, giriş artık doğrulamasız). Kötüye kullanım kapısı yazmada: eşleşmeye
      // mesaj/medya/soru göndermek doğrulama ister (middleware/emailVerifiedGuard).
      .not("lat", "is", null)
      .not("lng", "is", null)
      // Gercek kullanicilar ONCE cekilir: seed'ler (416 profil) surekli "cevrimici"
      // ritmi tuttugu icin salt last_seen_at siralamasinda tavani doldurur ve
      // gercek adaylar 500'un disinda kalabilir. Bu anahtar bellekteki
      // siralamayla ayni (adim 7) — seed'ler her zaman en sonda.
      .order("is_seed_profile", { ascending: true, nullsFirst: true })
      // `id` ikincil anahtar: `last_seen_at` esitliginde tiebreak yoksa kesme
      // noktasi yine belirsizlesir ve havuz 500'u astiginda ayni bug'in kucuk
      // bir versiyonu geri gelir.
      .order("last_seen_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(CANDIDATE_FETCH_LIMIT);

    if (excludeList.length > 0) {
      query = query.not("id", "in", excludeFilter);
    }

    // Seed profiller (`is_seed_profile`) HERKESE gorunur — soguk baslangic havuzu.
    // Diger test hesaplari (tester_*, magaza inceleme hesaplari) yalniz test admin'e.
    // Seed'in `is_test_account` bayragi yerinde kalir: botun yazma kapisi iki bayragi
    // birden ister (`botYazabilir`), o yuzden gorunurluk burada ayrica acilir.
    if (!user.is_test_admin) {
      query = query.or("is_test_account.eq.false,is_seed_profile.eq.true");
    }

    // Age filter
    if (user.age_pref_min != null) {
      query = query.gte("age", user.age_pref_min);
    }
    if (user.age_pref_max != null) {
      query = query.lte("age", user.age_pref_max);
    }

    // Cinsiyet tercihi. Karşılıklı kural (compatibility.ts): aday benim istediğim kovada
    // VE adayın tercihi benim kovamı kapsıyor. Test hesabı `.or()`'u ile AND'lenir
    // (PostgREST birden çok `or=` parametresini AND'ler).
    if (mutualMatch && viewerBucket) {
      query = query.in("gender", [...wantsOf(user)]).or(candidatePrefFilter(viewerBucket));
    } else if (user.gender_pref && user.gender_pref !== "BOTH") {
      query = query.eq("gender", user.gender_pref);
    }

    const { data: candidates, error: candError } = await query;

    if (candError) {
      console.error("[matching] Candidate query error:", candError);
      throw Errors.SERVER_ERROR();
    }

    if (!candidates || candidates.length === 0) {
      return { cards: [], page, has_more: false, empty_reason: 'no_candidates' };
    }

    // 4. Sert mesafe filtresi YOK — aday tier ile isaretlenir ve siralamada
    // yakin olan garanti once tuketilir (bkz. adim 7). Prod olcumunde mesafe
    // adaylarin %72'sini siliyor ve izleyicilerin %31'ini tek basina sifira
    // dusuruyordu.
    const filtered: (CandidateRow & {
      distance_km: number;
      distance_tier: number;
      distance_boundary_km: number;
    })[] = [];
    for (const c of candidates as CandidateRow[]) {
      if (excludedIds.has(c.id)) continue;

      const dist = haversineDistance(myLat, myLng, c.lat, c.lng);
      const { tier, boundaryKm } = resolveDistanceTier(dist, maxRadius);

      filtered.push({
        ...c,
        distance_km: Math.round(dist * 10) / 10,
        distance_tier: tier,
        distance_boundary_km: boundaryKm,
      });
    }

    // 5. Batch fetch question stats for candidates (single query — count derived in-memory)
    const candidateIds = filtered.map((c) => c.id);
    const questionCountMap = new Map<string, number>();
    const questionInfoMap = new Map<string, QuestionInfo>();
    const questionLocalesByUser = new Map<string, string[]>();
    const rowsByUser = new Map<string, any[]>();

    if (candidateIds.length > 0) {
      // PostgREST sorgusu URL'de gider: 486 aday icin tek `.in()` ~18 KB olur ve istek
      // "TypeError: fetch failed" ile patlar. Hata YAKALANMADIGI icin questionStats bos
      // kaliyor, her adayin soru sayisi 0 sayiliyor ve discover TAMAMEN bosaliyordu
      // (canli olay 2026-09-17: seed profiller acilinca havuz 70 -> 486, tum kullanicilar
      // icin `no_candidates`). Ayni tuzak seed hattinda uc kez yasanmisti.
      const ID_PARCA = 100;
      const questionStats: Array<Record<string, any>> = [];
      for (let i = 0; i < candidateIds.length; i += ID_PARCA) {
        const { data: parca, error: parcaError } = await supabase
          .from('questions')
          .select('user_id, category, stats_correct, stats_wrong, locale, created_at')
          .in('user_id', candidateIds.slice(i, i + ID_PARCA));
        if (parcaError) {
          // Sessizce bos donmek "aday yok" gibi gorunur; bu yanlis sonuc, hatadan beterdir.
          console.error('[matching] question stats query error:', parcaError.message);
          throw Errors.SERVER_ERROR();
        }
        if (parca) questionStats.push(...parca);
      }

      // Tek gecisde indeksle. Onceki kod her aday icin questionStats'i bastan
      // filtreliyordu (O(aday x soru)); limit 50 -> 500 ile bu yuk kabul edilemez.
      for (const row of questionStats) {
        const uid = row.user_id as string;
        const rows = rowsByUser.get(uid);
        if (rows) rows.push(row);
        else rowsByUser.set(uid, [row]);
      }

      // 5.2 — Enrich candidates with question info (category + difficulty)
      for (const cId of candidateIds) {
        const userQuestions = rowsByUser.get(cId) ?? [];

        questionCountMap.set(cId, userQuestions.length);
        questionLocalesByUser.set(
          cId,
          userQuestions.map((q: any) => questionLocale(q.locale)),
        );

        let totalAttempts = 0;
        let totalCorrect = 0;
        for (const q of userQuestions) {
          totalAttempts += q.stats_correct + q.stats_wrong;
          totalCorrect += q.stats_correct;
        }
        const successRate = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 50;

        let difficulty = 'unranked';
        if (totalAttempts >= 10) {
          if (successRate > 70) difficulty = 'easy';
          else if (successRate > 40) difficulty = 'medium';
          else if (successRate > 20) difficulty = 'hard';
          else difficulty = 'legendary';
        }

        const categories = [...new Set(userQuestions.map((q: any) => q.category).filter(Boolean))] as string[];
        const languages = [...new Set(userQuestions.map((q: any) => questionLocale(q.locale)))];

        questionInfoMap.set(cId, {
          count: userQuestions.length,
          categories,
          avg_difficulty: difficulty,
          languages,
        });
      }
    }

    // 5.5 — Filter out users with < 2 questions (not discoverable)
    let discoverableFiltered = filtered.filter((c) => {
      const qCount = questionCountMap.get(c.id) ?? 0;
      return qCount >= 2;
    });

    // Hard gate: must have at least 1 photo (profile-setup-gate enforcement)
    discoverableFiltered = discoverableFiltered.filter((c) => {
      const photoCount = c.photos?.length ?? 0;
      return photoCount >= 1;
    });

    // 5.6 — Language filter: candidate must have 2+ questions in user's languages.
    // Kaynak users.preferred_languages (054 sonrasi tek kaynak). Eski satirlar icin
    // user_languages'a, o da bossa uygulama diline duser — hicbir yol "filtresiz"e dusmez
    // (bos liste = kullanici okuyamadigi dilde profiller gorur).
    const prefColumn = (user.preferred_languages as string[] | null) ?? [];
    const langPrefs = prefColumn.length > 0
      ? prefColumn
      : userLanguages.length > 0
        ? userLanguages
        : [resolveLocale(user.locale as string | null)];

    // Dil kapisi tek eleyen mi, yoksa zaten aday mi yoktu? Bos ekranda dogru
    // metni gosterebilmek icin dil oncesi sayiyi tut.
    const beforeLanguageCount = discoverableFiltered.length;

    // Reuse locale data from step 5 (no extra DB query needed)
    // Language-based filtering: candidate MUST have 2+ questions in user's languages
    // Always strict — no fallback candidates
    discoverableFiltered = discoverableFiltered.filter((c) => {
      const qLocales = questionLocalesByUser.get(c.id) || [];
      const matchingCount = qLocales.filter((l: string) => langPrefs.includes(l)).length;
      return matchingCount >= 2;
    });

    // 5.7 — Tekrar adayinin kesin karari: bekleme dolmadiysa hedef izleyicinin dilinde YENI soru
    // eklemis olmali (son basarisizliktan sonra olusturulmus). Kalan beklemedekiler elenir.
    const retryIds = new Set<string>();
    if (retryPending.size > 0) {
      const retryNow = new Date();
      discoverableFiltered = discoverableFiltered.filter((c) => {
        const sessions = retryPending.get(c.id)?.sessions;
        if (!sessions) return true;
        const questionCreatedAts = (rowsByUser.get(c.id) ?? [])
          .filter((q: any) => langPrefs.includes(questionLocale(q.locale)))
          .map((q: any) => (q.created_at as string | null) ?? null);
        const { verdict } = evaluateRetry(sessions, { retryDays, now: retryNow, questionCreatedAts });
        if (verdict !== "eligible") return false;
        retryIds.add(c.id);
        return true;
      });
    }

    // 6. Score each candidate
    const now = new Date();
    // Uyuyan aday: son `dormantDays` gundur gorulmemis (last_seen_at — presence heartbeat'i
    // yazar; last_active_at yalniz resume'da yazildigi icin guvenilmez). Prod 29 Eyl-3 Eki:
    // 15 eslesmenin 2'sinde yanit geldi, kohort disi 8 karsi tarafin 7'si Haziran-Eylul'den
    // beri gorulmuyordu. Sert filtre DEGIL: havuz kucuk, uyuyanlar listenin sonunda kalir.
    const dormantCutoff = dormantDays > 0 ? now.getTime() - dormantDays * 24 * 60 * 60 * 1000 : null;
    const isDormant = (lastSeenAt: string | null): boolean =>
      dormantCutoff != null && (lastSeenAt == null || new Date(lastSeenAt).getTime() < dormantCutoff);
    const isBoostActive = (boostUntil: string | null): boolean =>
      boostUntil != null && new Date(boostUntil) > now;

    const scored = discoverableFiltered.map((c) => {
      const photoCount = c.photos?.length ?? 0;
      const qCount = questionCountMap.get(c.id) ?? 0;

      const desirability = scoringService.desirabilityScore(c.like_received_count, c.times_shown_count);
      const engagement = scoringService.engagementScore(c.green_diamonds, 0); // quizCompletionRate not available yet
      const recency = scoringService.recencyScore(c.last_seen_at);
      // Denominator tier'in ust siniri — boylece "yakin olan daha iyi" her tier'in
      // ICINDE de calisir. maxRadius kullanilsaydi tier 1-3'un hepsi 0 alirdi.
      const distance = scoringService.distanceScore(c.distance_km, c.distance_boundary_km);
      const profile = scoringService.profileScore(c.profile_completion, photoCount, !!c.bio);

      const score = scoringService.totalScore({
        desirability,
        engagement,
        recency,
        distance,
        profile,
        boostActive: isBoostActive(c.boost_until),
      });

      return {
        candidate: c,
        score,
        questionCount: qCount,
        tier: c.distance_tier,
        groupRank: discoverGroupRank(c.is_seed_profile === true, isDormant(c.last_seen_at)),
        retry: retryIds.has(c.id) ? 1 : 0,
      };
    });

    // 7. Grup (aktif gercek -> seed -> uyuyan gercek), sonra tier artan, sonra tier icinde skor azalan.
    // Aktif gercek kullanici her zaman en onde: uzak bir aktif aday bile yakin bir seed'in onundedir.
    // Seed'ler (yanit veren AI profiller) uyuyan gercek kullanicilarin ONUNDE: yanit vermeyecek
    // biriyle eslesmek ilk gunu oldurur (29 Eyl-3 Eki: 15 eslesmenin 2'sinde yanit, 12/15 kullanici
    // eslesmeden 5 dk sonra ayrildi). Uyuyanlar sert filtrelenmez, listenin sonunda kalir.
    // Boost (+50) tier'i asamaz: boostlu uzak aday yakinlarin onune gecmez,
    // kendi tier'inin icinde yukselir. Bilincli — boost gorunurluk satar,
    // mesafe algisini bozmaz.
    // Tekrar profili (basarisiz quiz'in hedefi, adim 5.7) KENDI grubunun sonunda: grup sirasi yanit
    // olasiligini kodlar (asil tutma kaldiraci), o yuzden tekrar edilen aktif gercek kisi yeni bir
    // seed'in onunde kalir; grup icinde ise gorulmemis profiller once gelir.
    scored.sort((a, b) =>
      a.groupRank - b.groupRank || a.retry - b.retry || a.tier - b.tier || b.score - a.score);

    // 8. Paginate
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = scored.slice(start, start + PAGE_SIZE);
    const hasMore = start + PAGE_SIZE < scored.length;

    // 9. Increment times_shown_count for returned users
    if (pageItems.length > 0) {
      const shownIds = pageItems.map((s) => s.candidate.id);
      await supabase.rpc("increment_times_shown", { user_ids: shownIds });
    }

    // 10. Build profile cards
    const cards: ProfileCard[] = pageItems.map((s) => ({
      user_id: s.candidate.id,
      name: s.candidate.name,
      age: s.candidate.age,
      city: s.candidate.city,
      bio: s.candidate.bio,
      photos: s.candidate.photos,
      distance_km: s.candidate.distance_km,
      distance_tier: s.candidate.distance_tier,
      question_count: s.questionCount,
      profile_completion: s.candidate.profile_completion,
      is_boosted: isBoostActive(s.candidate.boost_until),
      question_info: questionInfoMap.get(s.candidate.id) ?? { count: 0, categories: [], avg_difficulty: 'unranked', languages: [] },
      relationship_goal: s.candidate.relationship_goal,
    }));

    // empty_reason HAVUZUN neden bos oldugunu anlatir; sayfa sonuna gelmek
    // havuz sebebi degildir (has_more=false zaten onu soyluyor). Bu yuzden
    // `scored` doluyken sebep gonderilmez — aksi halde page=3 istegi, dil
    // filtresi hic elemedigi halde 'language' metnini gosterirdi.
    if (scored.length === 0) {
      return {
        cards,
        page,
        has_more: hasMore,
        empty_reason: beforeLanguageCount > 0 ? 'language' : 'no_candidates',
      };
    }

    return { cards, page, has_more: hasMore };
  }

  /**
   * Swipe on a user (LIKE or REJECT).
   */
  async swipe(swiperId: string, targetId: string, action: "LIKE" | "REJECT") {
    // Self-swipe check
    if (swiperId === targetId) {
      throw Errors.SELF_SWIPE();
    }

    // Check for existing swipe (idempotent — fire-and-forget safe)
    const { data: existing } = await supabase
      .from("swipes")
      .select("id, action, created_at")
      .eq("swiper_id", swiperId)
      .eq("target_id", targetId)
      .maybeSingle();

    if (existing) {
      // Basarisiz quiz'in hedefi Discover'a geri donduyse (quiz-retry) ikinci LIKE yeni satir
      // acamaz (UNIQUE swiper+target) — mevcut satir yenilenir, gunluk hak bir kez daha harcanir.
      if (existing.action === "LIKE" && action === "LIKE") {
        await quizRetryService.renewLike(swiperId, targetId, existing.id as string, existing.created_at as string);
      }
      return { matched: false };
    }

    // Daily swipe limit check + increment
    await subscriptionService.incrementDailySwipes(swiperId);

    // Question compatibility is checked at quiz start, not at swipe time

    // Insert swipe
    const { error: swipeError } = await supabase
      .from("swipes")
      .insert({ swiper_id: swiperId, target_id: targetId, action });

    if (swipeError) {
      // Race condition: another request inserted between our check and insert
      if (swipeError.code === "23505") {
        return { matched: false };
      }
      console.error("[matching] Swipe insert error:", swipeError);
      throw Errors.SERVER_ERROR();
    }

    // If LIKE, increment like_received_count
    // Match is only created via quiz completion (quiz.service.ts → completeSession)
    if (action === "LIKE") {
      await supabase.rpc("increment_like_received", { target_user_id: targetId });
    }

    return { matched: false };
  }

  /**
   * Undo the last swipe (delete the swipe record and return the card).
   */
  async undoSwipe(userId: string, targetId: string): Promise<ProfileCard> {
    assertUuid(targetId, "targetId");

    // Basarisiz quiz'in kilitli hedefi geri getirilmez: undo eskiden bedava tekrar yoluydu, simdi
    // quiz'i baslatilamayan bir kart icin undo hakki harcatirdi (quiz-retry).
    await quizRetryService.assertNotLocked(userId, targetId);

    // Check daily undo limit
    await subscriptionService.incrementDailyUndos(userId);

    // Delete the swipe record
    const { error, count } = await supabase
      .from("swipes")
      .delete({ count: "exact" })
      .eq("swiper_id", userId)
      .eq("target_id", targetId);

    if (error) {
      console.error("[matching] Undo swipe error:", error);
      throw Errors.SERVER_ERROR();
    }
    if (count === 0) throw Errors.SESSION_NOT_FOUND();

    // Fetch the target user's card data to return
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name, age, city, bio, photos, lat, lng, profile_completion, boost_until, relationship_goal")
      .eq("id", targetId)
      .single();

    if (userError || !user) throw Errors.USER_NOT_FOUND();

    // Get question info
    const { data: questions } = await supabase
      .from("questions")
      .select("user_id, category, stats_correct, stats_wrong, locale")
      .eq("user_id", targetId);

    const userQuestions = questions ?? [];
    const totalAttempts = userQuestions.reduce((s, q: any) => s + q.stats_correct + q.stats_wrong, 0);
    const totalCorrect = userQuestions.reduce((s, q: any) => s + q.stats_correct, 0);
    const successRate = totalAttempts > 0 ? (totalCorrect / totalAttempts) * 100 : 50;

    let difficulty = "unranked";
    if (totalAttempts >= 10) {
      if (successRate > 70) difficulty = "easy";
      else if (successRate > 40) difficulty = "medium";
      else if (successRate > 20) difficulty = "hard";
      else difficulty = "legendary";
    }

    const categories = [...new Set(userQuestions.map((q: any) => q.category).filter(Boolean))] as string[];
    const languages = [...new Set(userQuestions.map((q: any) => questionLocale(q.locale)))];

    // Calculate distance
    const { data: me } = await supabase
      .from("users")
      .select("lat, lng, passport_lat, passport_lng, match_radius_km")
      .eq("id", userId)
      .single();

    const myLat = (me?.passport_lat as number | null) ?? me?.lat;
    const myLng = (me?.passport_lng as number | null) ?? me?.lng;
    const dist = myLat && myLng ? haversineDistance(myLat, myLng, user.lat, user.lng) : 0;
    // discover ile ayni fonksiyon — undo edilen kart listenin basina eklendigi
    // icin tier'i digerleriyle tutarli olmali.
    const { tier: distanceTier } = resolveDistanceTier(
      dist,
      (me?.match_radius_km as number | null) ?? 100,
    );

    const now = new Date();
    const isBoostActive = user.boost_until != null && new Date(user.boost_until) > now;

    return {
      user_id: user.id,
      name: user.name,
      age: user.age,
      city: user.city,
      bio: user.bio,
      photos: user.photos,
      distance_km: Math.round(dist * 10) / 10,
      distance_tier: distanceTier,
      question_count: userQuestions.length,
      profile_completion: user.profile_completion,
      is_boosted: isBoostActive,
      question_info: { count: userQuestions.length, categories, avg_difficulty: difficulty, languages },
      relationship_goal: user.relationship_goal,
    };
  }

  /**
   * Get all active matches for a user.
   *
   * `locale`: ses/foto son mesaj onizlemesinin dili. Eskiden her dilde sabit
   * Turkce ("🎤 Sesli mesaj") donuyordu; istemci metni oldugu gibi gosteriyor.
   */
  async getMatches(userId: string, locale: SupportedLocale) {
    assertUuid(userId, "userId");

    const { data: matches, error } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, matched_at, is_active")
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .eq("is_active", true)
      .order("matched_at", { ascending: false });

    if (error) {
      console.error("[matching] Get matches error:", error);
      throw Errors.SERVER_ERROR();
    }

    if (!matches || matches.length === 0) return [];

    const matchIds = matches.map((m) => m.id as string);

    // Gather other user IDs
    const otherIds = matches.map((m) =>
      m.user1_id === userId ? (m.user2_id as string) : (m.user1_id as string),
    );

    // Karsi kullanicilar + eslesme basina TEK ozet satiri (son mesaj + okunmamis, migration 070).
    // Eskiden tum eslesmelerin tum mesajlari cekilip JS'te ilki seciliyordu: cevap sohbet
    // gecmisiyle sinirsiz buyuyor, PostgREST max-rows (1000) sonrasini sessizce kesiyordu.
    const [usersResult, ozetResult] = await Promise.all([
      supabase
        .from("users")
        .select("id, name, age, city, photos, bio, is_online, last_seen_at")
        .in("id", otherIds),
      supabase.rpc("match_list_summaries", { p_user_id: userId, p_match_ids: matchIds }),
    ]);

    const otherMap = new Map<string, (typeof usersResult.data extends (infer U)[] | null ? U : never)>();
    if (usersResult.data) {
      for (const o of usersResult.data) {
        otherMap.set(o.id as string, o);
      }
    }

    // Karsi kullanicilar okunamazsa her eslesme `user: null` donuyordu (sessiz). Liste bu haliyle
    // kullanilamaz: hata firlatilir ve loglanir.
    if (usersResult.error) {
      console.error("[matching] getMatches users error:", usersResult.error.message);
      throw Errors.SERVER_ERROR();
    }
    // Ozet okunamazsa liste yine doner (onizlemesiz, okunmamis 0) — eski davranis; ama sessiz degil.
    if (ozetResult.error) {
      console.error("[matching] match_list_summaries error:", ozetResult.error.message);
    }
    const ozetMap = new Map<string, MatchListSummary>();
    for (const ozet of (ozetResult.data ?? []) as MatchListSummary[]) {
      ozetMap.set(ozet.match_id, ozet);
    }

    return matches.map((m) => {
      const otherId = m.user1_id === userId ? (m.user2_id as string) : (m.user1_id as string);
      const other = otherMap.get(otherId);
      const ozet = ozetMap.get(m.id as string);
      // Mesajsiz eslesmede ozet satiri var ama son mesaj alanlari NULL.
      const lastMsg = ozet?.created_at ? ozet : undefined;
      const unread = ozet?.unread_count ?? 0;

      let lastMessagePreview: string | null = null;
      if (lastMsg) {
        if (lastMsg.audio_url) lastMessagePreview = `🎤 ${localeText(locale, "chat_preview", "voice")}`;
        else if (lastMsg.is_image) lastMessagePreview = `📷 ${localeText(locale, "chat_preview", "photo")}`;
        else lastMessagePreview = lastMsg.content;
      }

      return {
        match_id: m.id,
        matched_at: m.matched_at,
        last_message: lastMessagePreview,
        last_message_sent_at: lastMsg?.created_at ?? null,
        last_message_sender_id: lastMsg?.sender_id ?? null,
        unread_count: unread,
        user: other
          ? {
              user_id: other.id,
              name: other.name,
              age: other.age,
              city: other.city,
              photos: other.photos,
              bio: other.bio,
              is_online: other.is_online,
              last_seen: other.last_seen_at,
            }
          : null,
      };
    });
  }

  /**
   * Unmatch — deactivate a match.
   */
  async unmatch(userId: string, matchId: string) {
    const { data: match, error: fetchError } = await supabase
      .from("matches")
      .select("id, user1_id, user2_id, is_active")
      .eq("id", matchId)
      .maybeSingle();

    if (fetchError || !match) {
      throw Errors.NOT_MATCHED();
    }

    // Ensure user is part of the match
    if (match.user1_id !== userId && match.user2_id !== userId) {
      throw Errors.NOT_MATCHED();
    }

    if (!match.is_active) {
      throw Errors.MATCH_INACTIVE();
    }

    const { error: updateError } = await supabase
      .from("matches")
      .update({ is_active: false })
      .eq("id", matchId);

    if (updateError) {
      console.error("[matching] Unmatch error:", updateError);
      throw Errors.SERVER_ERROR();
    }

    return { message: "Unmatched successfully" };
  }
}

export const matchingService = new MatchingService();
