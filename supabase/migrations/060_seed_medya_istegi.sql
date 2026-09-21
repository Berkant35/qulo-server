-- 060: Seed profiller kendilerine gelen medya (fotograf/sesli mesaj) isteklerini de
-- kuyruga alir; bot bunlara nazikce ret yazar.
--
-- Oncesinde `seed_reply_queue.kind` yalniz mesaj ve soru yollarini biliyordu, yani
-- `media_requests` hic taranmiyordu. Sonuc: bir kullanicinin seed'e attigi istek
-- sonsuza dek `pending` kaliyor. Bu tek basina bir tik degil, KALICI kilitlenme:
-- `MediaService.requestMedia` bekleyen istek varken MEDIA_REQUEST_PENDING firlatir
-- ve isteklerin timeout'u yoktur — o kullanici o eslesmede bir daha foto/ses
-- gonderemez. Canli kanit: 2026-09-17'den beri bekleyen bir istek.
--
-- Bot medya GONDEREMEZ (chatService.sendMessage yalniz metin alir), bu yuzden
-- kabul degil ret yolu secildi: verilen sozun tutulamamasi botu ele verirdi.

alter table seed_reply_queue
  add column if not exists media_request_id uuid references media_requests(id) on delete cascade;

alter table seed_reply_queue drop constraint if exists seed_reply_queue_kind_check;
alter table seed_reply_queue add constraint seed_reply_queue_kind_check
  check (kind = any (array['message', 'question', 'question_answer', 'media_request']));
