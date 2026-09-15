/**
 * TR seed profilleri için isim / meslek / bio havuzları.
 * Seçim `tr-seed-lib.ts` içinde seed_id'den türetilen deterministik RNG ile yapılır.
 */

export const FEMALE_NAMES = [
  "Ayşe", "Zeynep", "Elif", "Merve", "Selin", "Ece", "Deniz", "Esra", "Burcu", "Damla",
  "Ceren", "Gizem", "Pınar", "Tuğçe", "Beyza", "İrem", "Yağmur", "Defne", "Aslı", "Eda",
  "Sude", "Naz", "Melisa", "Büşra", "Dilara", "Nisa", "Sena", "Gamze", "Hande", "Cansu",
  "Melis", "Simge", "Şeyma", "Duygu", "Özge", "Derya", "Nur", "Begüm", "Aylin", "Tuba",
];

export const MALE_NAMES = [
  "Mehmet", "Ahmet", "Mustafa", "Emre", "Burak", "Can", "Murat", "Kerem", "Onur", "Serkan",
  "Berk", "Efe", "Yusuf", "Ali", "Hakan", "Cem", "Oğuz", "Barış", "Tolga", "Umut",
  "Arda", "Kaan", "Furkan", "Eren", "Mert", "Batuhan", "Alp", "Sinan", "Volkan", "Tarık",
  "Doğan", "Enes", "Gökhan", "Okan", "Selim", "Ozan", "Taner", "Uğur", "Yiğit", "Caner",
];

export const SURNAMES = [
  "Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Aydın", "Öztürk", "Doğan", "Arslan", "Polat",
  "Çetin", "Kaplan", "Özdemir", "Tekin", "Korkmaz", "Aksoy", "Güneş", "Koç", "Kurt", "Özkan",
  "Şimşek", "Yıldız", "Yıldırım", "Aslan", "Erdoğan", "Bulut", "Keskin", "Acar", "Turan", "Ateş",
  "Karaca", "Kılıç", "Duman", "Sarı", "Avcı", "Uçar", "Taş", "Ergin", "Bozkurt", "Aktaş",
  "Ünal", "Can", "Sezer", "Işık", "Erdem", "Kara", "Gül", "Çakır", "Yavuz", "Tunç",
];

export const JOBS = [
  "Öğretmen", "Hemşire", "Pazarlama Uzmanı", "Grafik Tasarımcı", "Avukat", "Mimar", "Diyetisyen",
  "İnsan Kaynakları Uzmanı", "Yazılım Geliştirici", "Editör", "Mühendis", "Doktor", "Eczacı",
  "Muhasebeci", "Satış Temsilcisi", "Fizyoterapist", "Öğrenci", "Psikolog", "İç Mimar", "Bankacı",
  "Turizmci", "Kuaför", "Fotoğrafçı", "Emlak Danışmanı", "Aşçı", "Barista", "Girişimci",
  "Antrenör", "Sosyal Medya Uzmanı", "Veteriner",
];

/** Mobil `user_details.zodiac`'a İngilizce anahtar yazıyor (canlı: aries, taurus, …); aynı biçim. */
export const ZODIACS = [
  "aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",
];

export const PERSONALITIES = ["İçe dönük", "Dışa dönük", "Ambivert"];

/** Bio havuzu — kısa, gündelik; korpusta bio olmayan profillere. */
export const BIOS: Record<"WOMAN" | "MAN", string[]> = {
  WOMAN: [
    "Kahve, kitap ve uzun yürüyüşler.",
    "Yeni yerler keşfetmeyi seviyorum.",
    "Sabahları koşu, akşamları film.",
    "Espri anlayışı olan biri yazsın.",
    "Deniz kenarı, gün batımı, biraz sohbet.",
    "Hafta sonu kaçamakları ve iyi müzik.",
    "Kedi annesi. Ciddi olanlar öne.",
    "Konuşmayı seven, dinlemeyi bilen.",
    "Pilates ve tatlı arasında denge kuruyorum.",
    "Plansız seyahatler, planlı kahvaltılar.",
    "Yeni insanlar, yeni hikâyeler.",
    "Gülmeyi seviyorum, güldüreni de.",
  ],
  MAN: [
    "Spor, müzik ve iyi bir sohbet.",
    "Hafta sonu doğa, hafta içi iş.",
    "Kahvesini sert seven biri.",
    "Yeni tatlar denemeyi seviyorum.",
    "Motosiklet ve uzun yollar.",
    "Basketbol maçı izleyecek arkadaş aranıyor.",
    "Sakin, düzenli, biraz inatçı.",
    "Kamp ateşi başında en iyi sohbetler.",
    "İş dışında gitar ve sinema.",
    "Gerçek biriyle gerçek bir şeyler.",
    "Sabah antrenmanı, akşam dizi.",
    "Espriye açık, drama kapalı.",
  ],
};
