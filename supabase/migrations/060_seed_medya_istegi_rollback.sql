-- 060 geri alma. Once yeni kind'daki satirlar temizlenir, yoksa daraltilan
-- CHECK kisiti mevcut satirlar yuzunden eklenemez.
delete from seed_reply_queue where kind = 'media_request';

alter table seed_reply_queue drop constraint if exists seed_reply_queue_kind_check;
alter table seed_reply_queue add constraint seed_reply_queue_kind_check
  check (kind = any (array['message', 'question', 'question_answer']));

alter table seed_reply_queue drop column if exists media_request_id;
