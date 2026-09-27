import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

describe('fake-supabase unique — bileşik anahtar', () => {
  it('aynı (user_id, key) ikinci insert 23505; farklı kullanıcı aynı key serbest', async () => {
    const fake = createFakeSupabase({ t: [] }, { unique: { t: ['user_id,key'] } });

    expect((await fake.client.from('t').insert({ user_id: 'a', key: 'k' })).error).toBeNull();
    expect((await fake.client.from('t').insert({ user_id: 'b', key: 'k' })).error).toBeNull();
    const dup = await fake.client.from('t').insert({ user_id: 'a', key: 'k' });

    expect(dup.error?.code).toBe('23505');
    expect(fake.table('t')).toHaveLength(2);
  });

  it('NULL içeren bileşik anahtar kısıta takılmaz (Postgres)', async () => {
    const fake = createFakeSupabase({ t: [] }, { unique: { t: ['user_id,key'] } });
    await fake.client.from('t').insert({ user_id: null, key: 'k' });
    expect((await fake.client.from('t').insert({ user_id: null, key: 'k' })).error).toBeNull();
  });

  it('tek kolon davranışı değişmez', async () => {
    const fake = createFakeSupabase({ t: [] }, { unique: { t: ['dedupe_key'] } });
    await fake.client.from('t').insert({ dedupe_key: 'x' });
    expect((await fake.client.from('t').insert({ dedupe_key: 'x' })).error?.code).toBe('23505');
  });
});
