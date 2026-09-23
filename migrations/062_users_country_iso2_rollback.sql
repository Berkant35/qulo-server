-- 062 rollback: kayıplı — 2.0.12 sonrası gerçek TR kullanıcıları da tam ada döner.
UPDATE users SET country = 'Türkiye' WHERE country = 'TR';
