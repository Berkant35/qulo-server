# qulo-server — Kurallar

Root `CLAUDE.md` ("Test Disiplini") ve `tasks/test-cases.md` bu repo için de geçerlidir.
Burada sadece server'a özgü kısım var.

## Komutlar
- **Dev**: `npm run dev` (tsx watch)
- **Test**: `npx vitest run` | tek dosya: `npx vitest run tests/services/x.test.ts`
- **Typecheck**: `npx tsc -p tsconfig.test.json` (`tests/` dahil)
- **Build**: `npm run build`

`tsconfig.json` build içindir, `rootDir: src` olduğu için `tests/` klasörünü kapsamaz.
Tip kontrolü için **her zaman** `tsconfig.test.json` kullan, yoksa test kodundaki
tip hataları görünmez (vitest esbuild ile transpile eder, tip kontrolü yapmaz).

## Test konumu
- **Yeni testler `tests/` altına** — `tests/services/`, `tests/routes/`, `tests/admin/`
- `src/__tests__` **eski konum, oraya yeni test ekleme.** `src/**/*` build'e dahil
  olduğu için oradaki test kodu derlenip `dist/`'e, oradan da Railway'e gidiyor.
- Yardımcılar: `tests/helpers/`

## Supabase test double — `tests/helpers/fake-supabase.ts`

Servislerin ~%90'ı `config/supabase`'i doğrudan import ediyor (DI yok). Bu yüzden
**cevap script'leyen mock yazma** — helper bellek içi bir tablo deposu modelliyor:

```ts
const fake = createFakeSupabase({ users: [{ id: 'u1', green_diamonds: 30 }] });
vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
const { diamondService } = await import('../../src/services/diamond.service.js');

await diamondService.spendGreen('u1', 30, 'test');
expect(fake.table('users')[0].green_diamonds).toBe(0);
```

- `beforeEach(() => vi.resetModules())` **zorunlu** — servisler singleton, bazıları
  (örn. `economyConfigService`) 5 dk cache tutuyor.
- Servis `import` **dinamik** olmalı (`await import`), `doMock`'tan sonra.
- Config gerektiren servisler için `tests/helpers/economy-config.fixture.ts` ile
  `economy_config_versions` tablosunu seed et — gerçek zod parse'ı çalışsın.
- Helper zincirde eksik bir operasyon varsa **helper'a ekle**, dosyaya özel mock yazma.

### Hata dallarını test etme
```ts
// Sadece 2. users.update patlasın (1.'si başarılı olsun) — çok adımlı akışın ortası:
{ failOn: [{ table: 'users', op: 'update', failAfter: 1 }] }
```
Tüm operasyonu birden bozarsan akış erken patlar ve test **asıl iddiayı doğrulamaz**.

## Bilinen davranış: harcama akışları atomik değil
`exchange.convertGreenToPurple` ve `buyPower` çok adımlı ve transaction'sız —
ara adım patlarsa elmas gider, karşılığı gelmez. `tests/services/exchange.service.test.ts`
içindeki "atomiklik sınırı" testleri bunu **donduruyor, düzeltmiyor**.
Postgres fonksiyonuna alınırsa (desen: `migration 037 quiz_session_mark_power`)
o testler güncellenmelidir.

## Review
Feature/bugfix sonrası, commit öncesi `/server-review` skill'i çalıştırılır (SOLID + security).
