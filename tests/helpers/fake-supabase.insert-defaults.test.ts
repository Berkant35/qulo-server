import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/** `insertDefaults`: Postgres kolon varsayılanı modeli — opt-in, tablo başına, payload önceliklidir. */
describe('fake-supabase insertDefaults', () => {
  it('payload\'da olmayan kolonu varsayılanla doldurur, payload değeri önceliklidir', async () => {
    const fake = createFakeSupabase({}, { insertDefaults: { logs: () => ({ created_at: 'D', level: 'info' }) } });

    await fake.client.from('logs').insert({ msg: 'a' });
    await fake.client.from('logs').insert([{ msg: 'b', created_at: 'X' }]);

    expect(fake.table('logs')).toEqual([
      expect.objectContaining({ msg: 'a', created_at: 'D', level: 'info' }),
      expect.objectContaining({ msg: 'b', created_at: 'X', level: 'info' }),
    ]);
  });

  it('tanımsız tabloya dokunmaz', async () => {
    const fake = createFakeSupabase({}, { insertDefaults: { logs: () => ({ created_at: 'D' }) } });

    await fake.client.from('other').insert({ msg: 'a' });

    expect(fake.table('other')[0]).not.toHaveProperty('created_at');
  });
});
