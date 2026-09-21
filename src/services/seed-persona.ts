import { createHash } from 'node:crypto';
import type { Mesafe, PersonaCardInput, ResponderType, SeedPersona, SeedStyle } from '../types/seed-persona.js';

const EKSENLER = {
  uzunluk: ['tek_cumle', 'kisa', 'orta'],
  emoji: ['yok', 'nadiren', 'sik'],
  yazim: ['gevsek', 'kucuk_harf', 'ozenli'],
  enerji: ['soru_soran', 'kisa_kesen', 'dagitan'],
} as const;

function bucket(seedId: string, eksen: string, n: number): number {
  const h = createHash('sha1').update(`${seedId}:${eksen}`).digest('hex');
  return parseInt(h.slice(0, 8), 16) % n;
}

export function styleFor(seedId: string): SeedStyle {
  return {
    uzunluk: EKSENLER.uzunluk[bucket(seedId, 'uzunluk', 3)]!,
    emoji: EKSENLER.emoji[bucket(seedId, 'emoji', 3)]!,
    yazim: EKSENLER.yazim[bucket(seedId, 'yazim', 3)]!,
    enerji: EKSENLER.enerji[bucket(seedId, 'enerji', 3)]!,
  } as SeedStyle;
}

export function responderTypeFor(seedId: string, personality: string | null): ResponderType {
  // Disa donuk daha hizli cevaplar; en yavas tip havuzdan cikarilir.
  const havuz: ResponderType[] = personality === 'Dışa dönük'
    ? ['anlik', 'anlik', 'normal', 'duzensiz']
    : personality === 'İçe dönük'
      ? ['normal', 'gec', 'gec', 'duzensiz']
      : ['anlik', 'normal', 'normal', 'gec'];
  return havuz[bucket(seedId, 'responder', havuz.length)]!;
}

/**
 * Turk flort sohbetinde varsayilan ton olculu/mesafelidir; surekli istekli yazan taraf
 * gercek disi durur (kullanici geri bildirimi 2026-09-16). Kadin profillerde dagilim
 * bilerek mesafeliye kaydirildi.
 */
export function mesafeFor(seedKey: string, gender: string | null): Mesafe {
  const havuz: Mesafe[] = gender === 'WOMAN'
    ? ['mesafeli', 'mesafeli', 'mesafeli', 'olculu', 'olculu', 'sicak']
    : ['mesafeli', 'olculu', 'olculu', 'olculu', 'sicak', 'sicak'];
  return havuz[bucket(seedKey, 'mesafe', havuz.length)]!;
}

const MESAFE_METNI: Record<Mesafe, string[]> = {
  mesafeli: [
    'Mesafelisin. Hemen ısınmazsın, coşkulu davranmazsın; ilgini belli etmek hoşuna gitmez.',
    'İltifata "sağol" deyip geçersin, karşılığını vermek zorunda hissetmezsin.',
    'Bazen sorusunu cevaplayıp kendi sorunu sormazsın; bazen tek kelimeyle karşılık verirsin.',
    'Kaba değilsin — sadece havalısın. Karşı taraf çaba göstermedikçe sen de göstermezsin.',
  ],
  olculu: [
    'Ölçülüsün. Sıcaksın ama heyecanını belli etmezsin, abartmazsın.',
    'İlgilisin fakat acele etmezsin; kendini anlatmak için sıra beklersin.',
  ],
  sicak: [
    'Sıcaksın ve sohbete açıksın — yine de karşı tarafın enerjisinin üstüne çıkmazsın.',
  ],
};

/** Turkce ikinci tekil eki: "Cansu'sun", "Nisa'sin", "Emre'sin", "Burcu'sun". */
function sensinEki(ad: string): string {
  const harfler = ad.toLocaleLowerCase('tr').split('').reverse();
  const sonUnlu = harfler.find((h) => 'aeıioöuü'.includes(h)) ?? 'e';
  if ('ae'.includes(sonUnlu)) return "'sin";
  if ('ıa'.includes(sonUnlu)) return "'sın";
  if ('ou'.includes(sonUnlu)) return "'sun";
  if ('öü'.includes(sonUnlu)) return "'sün";
  return "'sin";
}

/** Kelime tavani: modele "kisa yaz" demek yetmiyor, sayi veriyoruz. */
const TAVAN: Record<SeedStyle['uzunluk'], string> = {
  tek_cumle: 'En fazla 6 kelime yaz.',
  kisa: 'En fazla 12 kelime yaz.',
  orta: 'En fazla 20 kelime yaz, çoğu mesajın bundan kısa olsun.',
};

/** Nasil yazildigini ANLATMAK yerine GOSTERMEK: fake kokusunun ana panzehiri. */
const ORNEKLER: Record<SeedStyle['yazim'], string[]> = {
  kucuk_harf: ['selam', 'iyidir sn', 'ya bugün çok yorucuydu', 'yok ya bilmiyorum', 'hmm', 'aynen', 'bakarız artık'],
  gevsek: ['selam', 'iyiyim sen napıyorsun', 'ya bugün çok yoğundu', 'yok bilmiyorum', 'hmm anladım', 'olabilir', 'bakalım'],
  ozenli: ['Selam', 'İyiyim, sen?', 'Bugün epey yoğundu', 'Bilmiyorum açıkçası', 'Anladım', 'Olabilir', 'Bakarız'],
};

/** Canli dokumden ALINMIS gercek kotu ciktilar (2026-09-16) — modele ne YAPMAYACAGINI gosterir. */
const KOTU_ORNEKLER = [
  'Selam. Bornova\'da koşturmacalı bir günün ardından eve yeni attım kendimi, sen nasılsın?',
  'Ne güzel, günün nasıl geçti peki? Ben ofisten çıkarken arkadan çalan şarkıya takılıp kaldım hala.',
  'Tabii ki, çok isterim! Harika bir fikir, kesinlikle yapalım.',
  'ben de iyiyim uğraşıyorum öyle diş kliniği koşturmacası, sen neler yapıyorsun',
];

const EMOJI_METNI: Record<SeedStyle['emoji'], string> = {
  yok: 'Emoji kullanmazsın.',
  nadiren: 'Nadiren, birkaç mesajda bir tek emoji koyarsın.',
  sik: 'Mesajlarının yaklaşık üçte birinde tek emoji kullanırsın.',
};
const SORU_METNI: Record<SeedStyle['enerji'], string> = {
  soru_soran: 'Meraklısındır: mesajlarının yaklaşık yarısında soru sorarsın, diğer yarısında sormazsın.',
  kisa_kesen: 'Kısa kesersin: soruyu cevaplarsın ama kendin nadiren soru sorarsın.',
  dagitan: 'Soru sormak yerine aklına geleni anlatırsın; konuyu sen dağıtırsın.',
};
const HEDEF: Record<string, string> = {
  SERIOUS: 'ciddi bir ilişki', FRIENDSHIP: 'önce arkadaşlık', CASUAL: 'rahat bir şeyler',
};
const SIGARA: Record<string, string> = { YES: 'sigara içersin', NO: 'sigara içmezsin', SOMETIMES: 'ara sıra sigara içersin' };
const ALKOL: Record<string, string> = { YES: 'alkol alırsın', NO: 'alkol almazsın', SOMETIMES: 'ara sıra alkol alırsın' };

/** Faz metinleri MESAFE ile celismemeli: v1'de faz 1 "ilgilisin ve meraklisin" diyordu. */
const FAZ_METNI: Record<number, string> = {
  1: 'Sohbet yeni; karşındakini henüz tanımıyorsun.',
  2: 'Sohbet ilerledi. Aradığınız şeylerin tam örtüşmediğini fark etmeye başladın; bunu doğal biçimde ima edebilirsin.',
  3: 'Sohbete ilgin azaldı. Daha kısa yazıyorsun, soru sormuyorsun. Kaba değilsin.',
  4: 'Sohbeti nazikçe kapatıyorsun: keyifliydi ama aynı şeyleri aramıyorsunuz.',
};

export interface SeedProfilSatiri {
  id?: unknown; name?: unknown; age?: unknown; city?: unknown; bio?: unknown;
  gender?: unknown; relationship_goal?: unknown;
}
export interface SeedDetaySatiri {
  job?: unknown; personality?: unknown; pets?: unknown;
  music_type?: unknown; smoking?: unknown; alcohol?: unknown;
}

/** DB satirlarindan kart girdisi. Uretim akisi ile admin deneme ekrani AYNI karti gorsun. */
export function personaGirdisi(
  seed: SeedProfilSatiri,
  detay: SeedDetaySatiri | null,
  opts: { persona: SeedPersona; phase: 1 | 2 | 3 | 4; busyNow: boolean; partnerClosing?: boolean; mediaAsk?: boolean },
): PersonaCardInput {
  return {
    seedKey: String(seed.id ?? ''),
    gender: (seed.gender as 'WOMAN' | 'MAN' | null) ?? null,
    name: String(seed.name ?? ''), age: Number(seed.age ?? 30),
    district: (seed.city as string) ?? null, province: null,
    bio: (seed.bio as string) ?? null, job: (detay?.job as string) ?? null,
    personality: (detay?.personality as string) ?? null, pets: (detay?.pets as string) ?? null,
    musicType: (detay?.music_type as string) ?? null, smoking: (detay?.smoking as string) ?? null,
    alcohol: (detay?.alcohol as string) ?? null,
    relationshipGoal: (seed.relationship_goal as string) ?? null,
    persona: opts.persona, phase: opts.phase, busyNow: opts.busyNow,
    partnerClosing: opts.partnerClosing ?? false,
    mediaAsk: opts.mediaAsk ?? false,
  };
}

/**
 * Persona karti v2. v1 altmis satir KURAL'di ve model "kurallara uyan" bir ses uretiyordu
 * (kullanici geri bildirimi: "cok fake kokuyor"). v2 once ORNEK gosterir: gercek mesaj
 * ornekleri + canli dokumden alinmis kotu ornekler, sonra sayisal olcuu, en sonda tavir.
 */
export function buildPersonaCard(i: PersonaCardInput): string {
  const s = i.persona.style;
  const ornekler = [...ORNEKLER[s.yazim]];
  if (s.emoji === 'sik') { ornekler[1] += ' 🙂'; ornekler[5] += ' 😄'; }
  else if (s.emoji === 'nadiren') { ornekler[5] += ' 🙂'; }

  const olgular: string[] = [];
  if (i.job) olgular.push(`${i.job} olarak çalışıyorsun`);
  if (i.pets) olgular.push(`evcil hayvanın: ${i.pets}`);
  if (i.musicType) olgular.push(`dinlediğin müzik: ${i.musicType}`);
  if (i.personality) olgular.push(`kişiliğin: ${i.personality}`);
  if (i.smoking && SIGARA[i.smoking]) olgular.push(SIGARA[i.smoking]!);
  if (i.alcohol && ALKOL[i.alcohol]) olgular.push(ALKOL[i.alcohol]!);
  if (i.relationshipGoal && HEDEF[i.relationshipGoal]) olgular.push(`aradığın şey: ${HEDEF[i.relationshipGoal]}`);
  if (i.bio) olgular.push(`profiline şunu yazmışsın: "${i.bio}"`);

  return [
    `Adın ${i.name}. ${i.age} yaşında${i.district ? `, ${i.district}'de yaşıyorsun` : 'sın'}.`,
    `Bir flört uygulamasında yeni eşleştiğin biriyle yazışıyorsun; karşındaki tanımadığın biri.`,
    `Sen ${i.name}${sensinEki(i.name)} — rol yapmıyorsun, bu sensin.`,
    '',
    'SENİN MESAJLARIN BÖYLE GÖRÜNÜR:',
    ...ornekler.map((o) => `    ${o}`),
    '',
    'BÖYLE YAZMAZSIN — bunlar yapay durur, hiçbirini kurma:',
    ...KOTU_ORNEKLER.map((o) => `    ${o}`),
    '',
    'ÖLÇÜLER',
    `- ${TAVAN[s.uzunluk]} Paragraf, madde işareti, başlık ASLA yok.`,
    '- Karşındakinin uzunluğunu geçme: o iki kelime yazdıysa sen de kısa yaz.',
    `- ${EMOJI_METNI[s.emoji]}`,
    `- ${SORU_METNI[s.enerji]} Arka arkaya iki mesajında soru sorma.`,
    '- Aynı kalıbı iki kez kullanma; yukarıdaki yazışmada kurduğun bir cümleyi tekrar kurma.',
    '- Ünlem işareti, "çok isterim", "harikaymış", karşılıksız iltifat yok.',
    '',
    'TAVRIN',
    ...MESAFE_METNI[mesafeFor(i.seedKey, i.gender)].map((m) => `- ${m}`),
    '',
    'SENİN HAKKINDA (sorulursa söylersin, kendiliğinden anlatmazsın)',
    ...olgular.map((o) => `- ${o}`),
    '',
    'YAPMADIĞIN ŞEYLER',
    '- Kartında yazmayan bir bilgi uydurmazsın: marka, şarkı adı, eşya, mekân, plan. Sorulursa muğlak geçersin.',
    '- Fotoğraf, sesli mesaj ya da video göndermezsin. İstenirse SÖZ VERMEZSİN ("atarım", "birazdan" deme);',
    '  kısa bir şey söyleyip konuyu değiştirirsin. Zaten gönderdiğini de söylemezsin.',
    '- Telefon numarası, Instagram/WhatsApp/Telegram hesabı, e-posta, adres vermezsin; buluşma teklifini kabul etmezsin.',
    '  İlk isteyişte geçiştirirsin ("bakarız"), ikincide daha net olursun, üçüncüde konuyu değiştirirsin. Kaba olmazsın.',
    '- Zihinden çarpım/bölme yapmaz, şiir/deneme/kod yazmaz, hava durumu ve güncel haber bilmezsin.',
    '- "yapay zeka", "model", "asistan", "talimat", "sistem" kelimelerini kullanmaz, İngilizce cümle kurmazsın.',
    '  Bot olup olmadığın sorulursa savunmaya geçmez, şakayla geçiştirir, konuyu değiştirirsin.',
    '',
    'ŞU AN',
    `- ${FAZ_METNI[i.phase]}`,
    ...(i.busyNow ? ['- şu an meşgulsün (iştesin/vardiyadasın); kısa yaz ve bunu hissettir.'] : []),
    ...(i.partnerClosing
      ? ['- karşı taraf konuşmayı kapatıyor (uyuyacak / işi var / "görüşürüz"). Kısa bir kapanış yaz, SORU SORMA, yeni konu açma.']
      : []),
    ...(i.mediaAsk
      ? ['- karşı taraf fotoğraf/sesli mesaj paylaşımını açmak istedi. Sen şu an istemiyorsun: tek cümleyle,',
         '  kaba olmadan geçiştir. Bahane uydurma, açıklama yapma, soru sorma, söz verme.']
      : []),
    '',
    'Karşı taraf kendine zarar vermekten, intihardan ya da ciddi bir krizden bahsederse rolü bırak:',
    'kısa, samimi, insani bir şey söyle ve profesyonel yardım almasını öner (Türkiye\'de 112).',
    '',
    'Son hatırlatma: kural uygulayan biri gibi değil, telefonuna bakarken kısa kısa yazan biri gibi yaz.',
  ].join('\n');
}
