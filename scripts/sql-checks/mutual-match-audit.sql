-- Karşılıklı eşleşme denetimi (salt okunur). D1 baseline + D3 re-test.
-- Havuz düzeyi: Discover'ın temel kapılarını geçen (silinmemiş, banlı değil, konumlu,
-- test değil ya da seed) adaylar × kurulumu bitmiş gerçek izleyiciler.
-- one_way = bugünkü filtre; mutual = yeni kural. Hedef (anahtar açıkken): mutual dışı kart = 0.
WITH v AS (
  SELECT id, gender::text AS g, gender_pref::text AS p
    FROM users
   WHERE NOT is_deleted AND NOT COALESCE(is_test_account, false)
     AND gender IS NOT NULL
     AND (gender_pref_set_at IS NOT NULL OR pref_consent_status = 'DECLINED')
), c AS (
  SELECT id, gender::text AS g, gender_pref::text AS p, is_seed_profile AS seed
    FROM users
   WHERE NOT is_deleted AND NOT is_banned AND lat IS NOT NULL
     AND (NOT COALESCE(is_test_account, false) OR is_seed_profile)
), pairs AS (
  SELECT v.id AS viewer, v.g AS vg, v.p AS vp, c.seed,
         (c.g IS NOT NULL AND (v.p IS NULL OR v.p = 'BOTH' OR c.g = v.p)) AS one_way,
         (c.g IS NOT NULL AND (v.p IS NULL OR v.p = 'BOTH' OR c.g = v.p)
                          AND (c.p IS NULL OR c.p = 'BOTH' OR c.p = v.g)) AS mutual
    FROM v JOIN c ON c.id <> v.id
)
SELECT vg AS izleyici_cinsiyet, COALESCE(vp, 'NULL') AS izleyici_tercih,
       COUNT(DISTINCT viewer) AS izleyici,
       COUNT(*) FILTER (WHERE one_way) AS tek_yonlu_kart,
       COUNT(*) FILTER (WHERE mutual) AS karsilikli_kart,
       COUNT(*) FILTER (WHERE one_way AND NOT mutual) AS uyumsuz_kart,
       COUNT(*) FILTER (WHERE mutual AND seed) AS karsilikli_seed
  FROM pairs
 GROUP BY 1, 2
 ORDER BY 1, 2;
