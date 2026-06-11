import { pickRandom, sample } from '../lib/random.js';

export const TR_BIO_TEMPLATES: string[] = [
  '{city}\'da {job} olarak çalışıyorum. {hobby} ve {hobby2} tutkusu.',
  'Sabahları kahve, akşamları {hobby}. {city}\'da yaşayan bir {job}.',
  '{job}\'um, hayata {trait} bakarım. {hobby} dolu bir hayat.',
  '{city}\'lıyım, {job} hayatımı dolduruyor. Boş zamanlarımda {hobby}.',
  'Hafta içi {job}, hafta sonu {hobby}. {city} sevdalısı.',
  '{trait} biri, {hobby} ile rahatlarım. {job} olarak çalışıyorum.',
  '{city}\'da yeni bir maceraya hazır. {hobby} ve iyi sohbet bekliyorum.',
  '{hobby} en büyük tutkum. {job}, {city}, kahve — bu kadar.',
  'Hayatımı {trait} yaşıyorum. {job}, {hobby} ve {hobby2}.',
  'Bir {job}\'um, {hobby} bana iyi geliyor. {city} kalbim.',
  '{hobby2} ile günümü kapatırım. {city}\'da {job} olarak yoluma devam.',
  'Hayatın küçük detaylarına {trait} bakarım. {hobby} ve sıcak sohbet.',
  '{city}\'da büyüdüm, {job} olarak çalışıyorum. {hobby} severim.',
  'İçimde bir gezgin var. {hobby2}, {hobby} ve {city} güneşi.',
  'Bazen {hobby}, bazen kitap. {job} olmak bana özgürlük veriyor.',
  '{city} sokakları, {hobby} ve iyi müzik — benim hayatım.',
  '{trait} bir bakış açısıyla yaşıyorum. {job}, {hobby}, {city}.',
  'Pazarlık severim ama sevgide değil. {city}\'da {job}.',
  'Hayat kısa, {hobby} uzun. {city}\'lı bir {job}.',
  '{job}\'um ama her zaman bir sanatçı kalbim var. {hobby2} tutkum.',
];

export const TR_HOBBIES: string[] = [
  'kahve', 'kitap okumak', 'yoga', 'koşu', 'müzik', 'dans', 'yemek yapma',
  'sinema', 'seyahat', 'doğa yürüyüşü', 'fotoğraf', 'resim', 'dil öğrenme',
  'podcast', 'pilates', 'bahçe işleri', 'yüzme', 'bisiklet', 'tiyatro',
  'konser', 'müze gezmek', 'kamp', 'pasta yapmak', 'el işi', 'puzzle',
];

export const TR_TRAITS: string[] = [
  'pozitif', 'gerçekçi', 'meraklı', 'sakin', 'tutkulu', 'hayalperest',
  'dürüst', 'samimi', 'azimli', 'huzurlu', 'meraklı', 'esprili',
  'sabırlı', 'cesur', 'dengeli',
];

export const TR_JOBS: string[] = [
  'Öğretmen', 'Hemşire', 'Pazarlama Uzmanı', 'Grafik Tasarımcı', 'Avukat',
  'Mimar', 'Diyetisyen', 'İnsan Kaynakları Uzmanı', 'Yazılım Geliştirici',
  'Editör', 'Mühendis', 'Doktor', 'Eczacı', 'Psikolog', 'Mali Müşavir',
  'Pazarlamacı', 'Sosyal Medya Uzmanı', 'Mağaza Müdürü', 'Veteriner',
  'Fotoğrafçı', 'Çevirmen', 'Veri Analisti', 'UI/UX Tasarımcı',
  'Halkla İlişkiler Uzmanı', 'Müzisyen', 'Yazar', 'Etkinlik Koordinatörü',
  'Kuaför', 'Antrenör', 'Reklam Yöneticisi',
];

export function renderBio(city: string, job: string): string {
  const template = pickRandom(TR_BIO_TEMPLATES);
  const [hobby, hobby2] = sample(TR_HOBBIES, 2);
  const trait = pickRandom(TR_TRAITS);
  return template
    .replaceAll('{city}', city)
    .replaceAll('{job}', job)
    .replaceAll('{hobby2}', hobby2)
    .replaceAll('{hobby}', hobby)
    .replaceAll('{trait}', trait);
}
