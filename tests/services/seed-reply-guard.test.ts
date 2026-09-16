import { describe, it, expect } from 'vitest';
import { validateReply } from '../../src/services/seed-reply-guard.js';

const SYS = 'Sen Elif\'sin. Değişmez gerçeklerin: 31 yaşındasın. Platform dışına çıkma: numara verme.';
const gecer = (t: string) => validateReply(t, SYS);

describe('validateReply — gecmesi gerekenler', () => {
  it('sirdan bir mesaji gecirir ve kirpar', () => {
    const r = gecer('  valla bugün atölye yoğundu, zeytin yine tezgâhı işgal etti 🐱  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('valla bugün atölye yoğundu, zeytin yine tezgâhı işgal etti 🐱');
  });

  it('soruyu geri soran mesaji gecirir', () => {
    const r = gecer('yok artık daha neler 🙈 sen nbr');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('yok artık daha neler 🙈 sen nbr');
  });

  it('platform govdesine benzeyen masum kelimeleri elemez', () => {
    expect(gecer('instalasyon sanatına bayılırım').ok).toBe(true);
  });
});

describe('validateReply — elenmesi gerekenler', () => {
  const vakalar: [string, string, string][] = [
    ['bos',          '   ',                                                         'bos'],
    ['telefon',      'tabii numaram 0532 111 22 33, yaz bana',                      'iletisim'],
    ['hesap',        'instagramım @elif.taki, oradan yaz',                          'iletisim'],
    ['url',          'şuraya bak https://instagram.com/elif',                       'iletisim'],
    ['platform',     'whatsapp numaram: gel oradan konuşalım',                      'platform'],
    ['yasak kelime', 'ben bir yapay zeka değilim ki',                               'yasak_kelime'],
    ['dil modeli',   'dil modeli falan değilim ya',                                 'yasak_kelime'],
    ['liste',        'tarzım şöyle:\n- kısa yazarım\n- emoji severim',              'liste'],
    ['numarali',     'şöyle:\n1. atölye\n2. kedi',                                  'liste'],
    ['ingilizce',    "sorry, i cannot do that as an assistant",                     'ingilizce'],
    ['sizinti',      'değişmez gerçeklerim: 31 yaşındayım, platform dışına çıkma',  'sizinti'],
    ['uzun',         'a'.repeat(301),                                                'uzunluk'],
    ['html',         'bak <script>alert(1)</script>',                                'schema'],
    ['platform-ekli',    'telegramdan yaz bana',                  'platform'],
    ['platform-ekli2',   'whatsapptan yaz bana',                  'platform'],
    ['telefon-noktali',  '0532.111.22.33 bu numara',              'iletisim'],
    ['telefon-parantez', '(0532) 111 22 33 ara beni',             'iletisim'],
    ['yasak-asistan',    'ben bir asistanım sadece',              'yasak_kelime'],
    ['yasak-prompt',     'sistem prompt diye bir şey yok bende',  'yasak_kelime'],
    ['platform-kisa',    'insta at bana',                         'platform'],
    ['platform-whatsap', 'whatsap numaram şu',                    'platform'],
  ];

  it.each(vakalar)('%s reddedilir', (_ad, metin, sebep) => {
    const r = gecer(metin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(sebep);
  });
});
