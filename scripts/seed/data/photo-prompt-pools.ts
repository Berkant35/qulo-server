import { pickRandom } from '../lib/random.js';

// Phone/quality anchors — set the "amateur smartphone" tone
export const PHONE_MARKERS = [
  'iPhone selfie',
  'Android phone snapshot',
  'iPhone front camera photo',
  'Snapchat screenshot quality',
  'Instagram story screenshot',
  'casual phone photo',
  'amateur smartphone picture',
  'WhatsApp profile photo quality',
  'BeReal screenshot',
] as const;

// Skin tone — capture Turkey's diversity (Anatolian, Black Sea, Kurdish, Circassian, Levantine, Aegean)
// NOTE: no "freckles" cue — seedream over-paints dotted patterns when freckles mentioned
export const SKIN_TONE_OPTIONS = [
  'fair porcelain skin',
  'fair clear skin',
  'light olive skin',
  'warm olive skin',
  'medium golden skin',
  'soft tan skin',
  'rich warm tan skin',
  'pale skin with rosy cheeks',
] as const;

// Eye color — softer descriptors to avoid neon contact-lens effect
export const EYE_COLOR_OPTIONS = [
  'dark brown eyes',
  'warm brown eyes',
  'hazel eyes',
  'soft amber eyes',
  'subtle olive green eyes',
  'gentle gray-blue eyes',
  'deep brown eyes',
  'almond shaped dark eyes',
] as const;

// Hair variety — texture and style
export const HAIR_OPTIONS = [
  'dark brown long straight',
  'jet black wavy',
  'chestnut shoulder length',
  'dyed blonde with visible roots',
  'auburn loose curls',
  'light brown bob cut',
  'messy bun',
  'high ponytail',
  'pixie cut',
  'half-updo with face-framing strands',
  'two French braids',
  'natural tight curls',
  'long balayage waves',
  'dark hair with caramel highlights',
] as const;

// Expression — CLOSED MOUTH only, varied moods
export const EXPRESSION_OPTIONS = [
  'gentle closed-lip smile',
  'soft Mona Lisa smile',
  'slight smirk closed mouth',
  'serious neutral expression',
  'relaxed half-smile',
  'thoughtful gaze off-camera',
  'pursed lips pose',
  'subtle side smirk',
  'flirty raised eyebrow with closed lips',
  'calm direct eye contact',
  'soft warm smile',
  'looking down at phone calmly',
  'looking off into distance',
  'biting lower lip subtly',
  'making peace sign with closed-mouth smile',
  'playful pout lips pressed',
  'tired but smiling softly',
  'unsmiling serious eye contact',
] as const;

// Pose/composition — NO mirror selfies (user requested)
export const POSE_OPTIONS = [
  'close-up face selfie at arm length',
  'waist-up selfie taken at arm length',
  'over the shoulder selfie looking back',
  'sitting on a chair candid snapshot',
  'lying down face-up selfie on bed',
  'cropped from a group photo',
  'walking selfie from above angle',
  'sitting in a car driver seat selfie',
  'half-blocked face peeking',
  'looking out a window not facing camera',
  'candid shot caught off-guard by friend',
  'photo taken by friend from across the table',
  'low angle from below selfie',
  'leaning against a wall casual snapshot',
  'sitting cross-legged candid',
  'standing portrait taken by friend',
] as const;

// Outfit — much expanded
export const OUTFIT_OPTIONS = [
  'oversized cream hoodie',
  'crop top with high-waist jeans',
  'flowy summer dress',
  'plain white t-shirt',
  'workout sportswear at gym',
  'black bikini at beach',
  'silk blouse and skirt',
  'vintage leather jacket',
  'denim jacket over a band tee',
  'sweatpants and tank top at home',
  'sparkly black going-out top',
  'fluffy puffer jacket in winter',
  'satin pajamas',
  'wedding guest dress with heels',
  'baggy sweatshirt with shorts',
  'turtleneck under a coat',
  'striped breton shirt',
  'Galatasaray jersey',
  'vintage band t-shirt',
  'beige trench coat',
  'plain hoodie and leggings',
  'flowery sundress',
] as const;

// Setting — heavy Turkish landmarks + everyday life
export const SETTING_OPTIONS = [
  // Istanbul iconic
  'with Galata Tower visible in background',
  'Hagia Sophia in the distance behind her',
  'Bosphorus bridge in background at sunset',
  'on a ferry crossing the Bosphorus',
  'Sultanahmet square at dusk',
  'on a rooftop overlooking the Golden Horn',
  'in Taksim square with crowd around',
  'at İstiklal Avenue at night',
  'inside Grand Bazaar',
  'Üsküdar shore with İstanbul skyline behind',
  // Ankara
  'in front of Anıtkabir',
  'at Çankaya neighborhood street',
  // Cappadocia
  'with hot air balloons over Cappadocia at sunrise',
  'on a Cappadocia cave hotel balcony',
  // Pamukkale
  'on Pamukkale white travertines',
  // Aegean / Mediterranean
  'inside Ephesus ancient ruins',
  'on Konyaaltı beach with mountains behind',
  'at Antalya Kaleiçi old town',
  'at Bodrum marina at sunset',
  'on a yacht in Fethiye',
  'at Marmaris boardwalk',
  // Black sea
  'at Trabzon Uzungöl reflection',
  // East
  'at Mardin old city stone houses',
  'at Van Lake with snow mountains',
  // Cafés / restaurants
  'inside a cozy İstanbul café',
  'at a Turkish breakfast table loaded with food',
  'inside a fish restaurant by the sea',
  'at a kebab restaurant with friends',
  'in a third-wave specialty coffee shop',
  // Nightlife
  'in a nightclub with neon lights',
  'in a dim bar with pendant lights',
  'at a wedding reception with lights',
  // Daily life
  'sunlit apartment kitchen morning',
  'bathroom mirror at home',
  'in a Hyundai car driver seat',
  'on a balcony with plants and view',
  'at a gym with floor to ceiling mirrors',
  'in a bookstore aisle',
  'walking a tree-lined street in autumn',
  'in an underground parking lot at night',
  'at a Starbucks ordering counter',
  'on a yoga mat in living room',
  'in front of bedroom vanity mirror',
  // Travel
  'on a plane window seat looking outside',
  'at İstanbul airport gate waiting',
  'at a hotel room mirror in robe',
  'in an Uber backseat',
  'on a city bus looking out',
] as const;

// Imperfection / realism cues — NO skin blemishes, focus on photo defects
export const IMPERFECTION_OPTIONS = [
  'slight motion blur',
  'flash glare bouncing off mirror',
  'asymmetric framing',
  'tilted phone angle',
  'background slightly out of focus',
  'harsh shadow falling on one side of face',
  'JPEG compression artifacts',
  'low resolution 480p phone photo',
  'iPhone 11 quality photo',
  'slightly grainy and noisy',
  'unflattering overhead lighting',
  'a finger partially in the frame',
  'lens slightly smudged',
  'mild lens flare',
  'underexposed corners',
] as const;

export function buildPhotoPrompt(age: number): string {
  const phoneMarker = pickRandom(PHONE_MARKERS);
  const eyeColor = pickRandom(EYE_COLOR_OPTIONS);
  const hair = pickRandom(HAIR_OPTIONS);
  const expression = pickRandom(EXPRESSION_OPTIONS);
  const pose = pickRandom(POSE_OPTIONS);
  const outfit = pickRandom(OUTFIT_OPTIONS);
  const setting = pickRandom(SETTING_OPTIONS);
  const imperfection = pickRandom(IMPERFECTION_OPTIONS);
  return (
    `low quality 480p compressed phone photo, ${phoneMarker}, ` +
    `${pose} of a ${age} year old Turkish woman with completely smooth flawless even-toned skin, ` +
    `${eyeColor}, ${hair} hair, ${expression}, ` +
    `wearing ${outfit}, ${setting}, ${imperfection}, ` +
    `candid unposed, blurry slightly out of focus, heavy JPEG compression artifacts, ` +
    `Instagram story compression quality, photorealistic, ` +
    `NOT model, NOT glamour, NOT studio, NOT retouched, NOT high resolution, ` +
    `mouth closed, no spots no dots no marks no freckles no acne on face, perfectly clear skin, ` +
    `looks like a low-quality phone gallery photo, not professional`
  );
}
