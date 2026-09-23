-- 061 rollback: kanalı silme (user_acquisition.channel_id referansı olabilir), pasifleştir.
UPDATE acquisition_channels SET is_active = false WHERE key = 'dont_remember';
