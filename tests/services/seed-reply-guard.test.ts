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
    expect(gecer('yok artık daha neler 🙈 sen nbr').ok).toBe(true);
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
  ];

  it.each(vakalar)('%s reddedilir', (_ad, metin, sebep) => {
    const r = gecer(metin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(sebep);
  });
});
