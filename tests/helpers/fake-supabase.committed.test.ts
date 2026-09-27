import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

describe('fake-supabase failOn — committed (yazım uygulanır, hata sonra döner)', () => {
  it('insert: satır gerçekten yazılır ama hata döner (commit sonrası kayıp cevap)', async () => {
    const fake = createFakeSupabase({ t: [] }, { failOn: [{ table: 't', op: 'insert', committed: true }] });
    const result = await fake.client.from('t').insert({ id: 'x', v: 1 }).select().single();

    expect(result.error).not.toBeNull();
    expect(fake.table('t')).toHaveLength(1);
    expect(fake.table('t')[0]).toMatchObject({ id: 'x', v: 1 });
  });

  it('update: satır güncellenir ama hata döner', async () => {
    const fake = createFakeSupabase(
      { t: [{ id: 'x', v: 1 }] },
      { failOn: [{ table: 't', op: 'update', committed: true }] },
    );
    const result = await fake.client.from('t').update({ v: 2 }).eq('id', 'x');

    expect(result.error).not.toBeNull();
    expect(fake.table('t')[0].v).toBe(2);
  });

  it('delete: satır silinir ama hata döner', async () => {
    const fake = createFakeSupabase(
      { t: [{ id: 'x' }] },
      { failOn: [{ table: 't', op: 'delete', committed: true }] },
    );
    const result = await fake.client.from('t').delete().eq('id', 'x');

    expect(result.error).not.toBeNull();
    expect(fake.table('t')).toHaveLength(0);
  });

  it('varsayılan (committed olmayan) davranış değişmez: hata döner, hiçbir şey yazılmaz', async () => {
    const fake = createFakeSupabase({ t: [] }, { failOn: [{ table: 't', op: 'insert' }] });
    const result = await fake.client.from('t').insert({ id: 'x' });

    expect(result.error).not.toBeNull();
    expect(fake.table('t')).toHaveLength(0);
  });
});
