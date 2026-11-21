# Soru analizi — `GET /api/v1/questions/me/analytics` (2.2.0, C7a) — mobil sözleşmesi

Bearer gerekir; yalnız çağıranın kendi soruları. Yanıt: `{ questions: [...], totals: {...} }`. Eski alanlar değişmedi;
`totals` altına 3 alan eklendi (eski istemciler yok sayar).

## `totals`
| Alan | Anlam |
|---|---|
| `total_solve_count` | (eski) Sorularına verilen toplam cevap sayısı |
| `total_correct` | (yeni) Doğru cevap sayısı |
| `total_wrong` | (yeni) Yanlış cevap sayısı |
| `total_attempts` | (yeni) `total_correct + total_wrong` |
| `overall_success_rate` | (eski) `round(total_correct / total_attempts * 100)`, çözüm yoksa `0` (tam sayı %) |
| `total_green_earned`, `best_question_order` | (eski) değişmedi |

## Tanımlar
- **Çözüm** = bir soruya verilen tek cevap (quiz oturumu değil). Her cevapta sunucu `solve_count` ile `correct` ya da
  `wrong` sayacını birlikte artırır; bu yüzden `total_correct + total_wrong = total_solve_count` (aralarında
  üçüncü kalem yok; süre aşımı cevap kaydetmez (TIME_UP hatası), sayaçlara girmez; SKIP/SKIP_ALL ile geçilen soru doğru sayılır). Mobil ayrı `skipped` göstermez.
- **Silinen sorular** toplamdan düşer (soru satırı kalıcı silinir, sayaçlar satırla gider); `total_solve_count` ile aynı kural.
- Veri kaynağı: `questions.stats_*` sayaçları; tek sorgu, ek tablo taraması yok.
- Premium ekran önerisi: halka = `overall_success_rate`; bölünmüş çubuk = `total_correct : total_wrong`;
  kartlar = `total_attempts` / `total_correct` / `total_wrong`.
