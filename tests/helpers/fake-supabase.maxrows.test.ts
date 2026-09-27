import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/**
 * PostgREST `max-rows` (Supabase varsayılanı 1000): sayfalanmayan okuma sessizce kırpılır. Fake
 * varsayılanda kırpmaz (eski testler aynı kalsın); `maxRows` verilince okuma sonucu range/limit'ten
 * SONRA bu sayıyla kesilir — sayfalamayı unutan kod testte de eksik satır görür.
 */
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${String(i).padStart(4, '0')}` }));

describe('fake-supabase maxRows', () => {
  it('verilmezse kırpma yok', async () => {
    const fake = createFakeSupabase({ t: rows(1500) });
    const { data } = await fake.client.from('t').select('id');
    expect(data).toHaveLength(1500);
  });

  it('sayfasız okuma maxRows ile kesilir; count gerçek toplamı döner', async () => {
    const fake = createFakeSupabase({ t: rows(1500) }, { maxRows: 1000 });
    const { data, count } = await fake.client.from('t').select('id', { count: 'exact' }).order('id');
    expect(data).toHaveLength(1000);
    expect(count).toBe(1500);
  });

  it('range sayfalaması kalan satırları getirir; limit maxRows altındaysa limit geçerli', async () => {
    const fake = createFakeSupabase({ t: rows(1500) }, { maxRows: 1000 });
    const second = await fake.client.from('t').select('id').order('id').range(1000, 1999);
    expect(second.data).toHaveLength(500);
    expect((second.data as Array<{ id: string }>)[0].id).toBe('r1000');
    expect((await fake.client.from('t').select('id').limit(5)).data).toHaveLength(5);
    expect((await fake.client.from('t').select('id').limit(2000)).data).toHaveLength(1000);
  });
});
