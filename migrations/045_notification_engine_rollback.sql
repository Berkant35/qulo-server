-- 045 rollback — motor tablolarini kaldirir. SIRA: once sunucuda motoru kapat (config enabled=false)
-- veya cron'u durdur; sonra bu dosya. Kayit gecmisi (push_log) bilincli olarak silinir.

DROP TABLE IF EXISTS push_log;
DROP TABLE IF EXISTS notification_engine_config;
