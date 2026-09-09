/** Radius disindaki adaylar icin ilk kademe siniri carpani. */
const NEAR_TIER_MULTIPLIER = 3;
/** Orta kademe ust siniri (km). */
const MID_TIER_MAX_KM = 1000;
/** En uzak kademenin skorlama denominatoru (km) — dunya olcegi. */
const FAR_TIER_BOUNDARY_KM = 20000;

export interface DistanceTier {
  /** 0 = kullanicinin radius'u icinde, 3 = en uzak. Siralamada birincil anahtar. */
  tier: number;
  /** Bu kademenin ust siniri; distanceScore denominatoru olarak kullanilir. */
  boundaryKm: number;
}

/**
 * Adayin mesafe kademesini hesaplar.
 *
 * Kademe sinirlari monotonik artmak ZORUNDA: aksi halde daha uzak bir kademenin
 * denominatoru daha kucuk olur ve uzak aday yakin adaydan yuksek mesafe skoru
 * alir. Bu yuzden orta kademe, yakin kademenin sinirini gecemiyorsa atlanir
 * (ornek: radius=500 -> yakin sinir 1500, sabit 1000'lik orta kademe araya giremez).
 */
export function resolveDistanceTier(distanceKm: number, radiusKm: number): DistanceTier {
  if (distanceKm <= radiusKm) return { tier: 0, boundaryKm: radiusKm };

  const nearBoundaryKm = radiusKm * NEAR_TIER_MULTIPLIER;
  if (distanceKm <= nearBoundaryKm) return { tier: 1, boundaryKm: nearBoundaryKm };

  if (MID_TIER_MAX_KM > nearBoundaryKm && distanceKm <= MID_TIER_MAX_KM) {
    return { tier: 2, boundaryKm: MID_TIER_MAX_KM };
  }

  return { tier: 3, boundaryKm: FAR_TIER_BOUNDARY_KM };
}
