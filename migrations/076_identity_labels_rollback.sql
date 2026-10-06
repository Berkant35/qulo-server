-- 076 rollback · Kimlik & yönelim etiketleri
-- ÖNCE sunucu deploy'u geri alınır (yeni kod user_identity'yi okur), SONRA bu dosya.
-- user_consents.identity_labels ispat satırları SİLİNMEZ (KVKK ispatı); CHECK genişletilmiş kalır.

DROP TABLE IF EXISTS public.user_identity;
