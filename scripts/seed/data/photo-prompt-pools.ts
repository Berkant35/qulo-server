import { pickRandom } from '../lib/random.js';

export const HAIR_OPTIONS = [
  'dark brown', 'black', 'chestnut', 'dyed blonde', 'auburn', 'light brown',
] as const;

export const EXPRESSION_OPTIONS = [
  'gentle smile', 'soft gaze at camera', 'slight laughter', 'thoughtful look',
] as const;

export const OUTFIT_OPTIONS = [
  'oversized sweater', 'casual summer dress', 'plain blouse',
  'linen shirt', 'leather jacket', 'denim jacket over t-shirt',
] as const;

export const SETTING_OPTIONS = [
  'Istanbul rooftop with city skyline',
  'cozy cafe with warm lighting',
  'park bench in autumn',
  'Bosphorus view at golden hour',
  'sunlit apartment by a window',
  'Cappadocia balloon background',
  'Antalya beach at sunset',
  'autumn street with fallen leaves',
] as const;

export function buildPhotoPrompt(age: number): string {
  const hair = pickRandom(HAIR_OPTIONS);
  const expression = pickRandom(EXPRESSION_OPTIONS);
  const outfit = pickRandom(OUTFIT_OPTIONS);
  const setting = pickRandom(SETTING_OPTIONS);
  return (
    `Portrait of a ${age}-year-old Turkish woman with ${hair} hair, ` +
    `${expression}, wearing ${outfit}, in ${setting}, natural lighting, ` +
    `shot on iPhone, slight grain, candid selfie aesthetic, photorealistic, ` +
    `NOT glamour, NOT studio lighting, casual everyday look`
  );
}
