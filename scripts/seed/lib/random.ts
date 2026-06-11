/**
 * Random utility helpers for seed scripts.
 * Pure functions, no side effects.
 */

export function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function jitter(magnitude: number): number {
  return (Math.random() * 2 - 1) * magnitude;
}

export function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pickRandom: empty array');
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function weightedPick<K extends string>(weights: Record<K, number>): K {
  const total = Object.values(weights).reduce((a, b) => (a as number) + (b as number), 0) as number;
  if (total <= 0) throw new Error('weightedPick: total weight must be > 0');
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(weights) as [K, number][]) {
    r -= w;
    if (r <= 0) return key;
  }
  // Floating point fallback
  return Object.keys(weights)[Object.keys(weights).length - 1] as K;
}

export function sample<T>(arr: readonly T[], n: number): T[] {
  if (n > arr.length) throw new Error(`sample: n=${n} > arr.length=${arr.length}`);
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]!);
  }
  return out;
}
