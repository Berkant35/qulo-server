import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

describe('fake-supabase interleave', () => {
  it('update anında satırı değiştirir; eski değerle CAS tutmaz, yeniyle tutar', async () => {
    const fake = createFakeSupabase(
      { users: [{ id: 'u1', n: 1 }] },
      { interleave: [{ table: 'users', mutate: (rows) => { rows[0].n = 5; } }] },
    );

    const first = await fake.client.from('users').update({ n: 2 }).eq('id', 'u1').eq('n', 1).select('n').maybeSingle();
    expect(first.data).toBeNull();
    expect(fake.table('users')[0].n).toBe(5);

    const second = await fake.client.from('users').update({ n: 6 }).eq('id', 'u1').eq('n', 5).select('n').maybeSingle();
    expect(second.data).toMatchObject({ n: 6 });
  });

  it('times kadar tetiklenir, sonra durur', async () => {
    let calls = 0;
    const fake = createFakeSupabase(
      { users: [{ id: 'u1', n: 1 }] },
      { interleave: [{ table: 'users', times: 2, mutate: () => { calls++; } }] },
    );
    for (let i = 0; i < 3; i++) {
      await fake.client.from('users').update({ n: i }).eq('id', 'u1');
    }
    expect(calls).toBe(2);
  });
});
