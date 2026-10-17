/**
 * Kâhin (ORACLE) gücünün varsayılan doğruluğu: `powers.accuracy_rate` okunamazsa/boşsa bu değer
 * kullanılır. Quiz + sohbet sorusu yolu ve herkese açık `GET /app/economy` yanıtı (`oracleAccuracy`,
 * auth öncesi güç demosu) aynı sayıyı paylaşır — iki yerde ayrı "0.7" yazılırsa demo ile gerçek oyun ayrışır.
 */
export const ORACLE_DEFAULT_ACCURACY = 0.7;
