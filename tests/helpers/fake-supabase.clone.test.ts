import { describe, it, expect } from 'vitest';
import { createFakeSupabase } from './fake-supabase.js';

/**
 * PostgREST gövdeyi JSON olarak gönderir ve alır: çağıranın dizisi/nesnesi depoyla asla PAYLAŞILMAZ.
 * Sığ kopyada `photos.push()` depoyu doğrudan değiştiriyordu; `users.update({ photos })` silinse de
 * yükleme testi geçiyordu (2026-09-28 review, kod bozularak kanıtlandı).
 */
describe('fake-supabase derin kopya', () => {
  it('okunan satirdaki dizi degistirilirse depoya sizmaz', async () => {
    const fake = createFakeSupabase({ users: [{ id: 'u1', photos: ['a'] }] });
    const { data } = await fake.client.from('users').select('photos').eq('id', 'u1').single();
    data.photos.push('b');
    expect(fake.table('users')[0].photos).toEqual(['a']);
  });

  it('update govdesindeki dizi sonradan degisirse depoya sizmaz', async () => {
    const fake = createFakeSupabase({ users: [{ id: 'u1', photos: [] }] });
    const photos = ['a'];
    await fake.client.from('users').update({ photos }).eq('id', 'u1');
    photos.push('b');
    expect(fake.table('users')[0].photos).toEqual(['a']);
  });

  it('insert edilen satir sonradan degisirse depoya sizmaz', async () => {
    const fake = createFakeSupabase({ notes: [] });
    const satir = { id: 'n1', tags: ['x'] };
    await fake.client.from('notes').insert(satir);
    satir.tags.push('y');
    expect(fake.table('notes')[0].tags).toEqual(['x']);
  });

  it('ayni seed fixture iki fake arasinda paylasilmaz', async () => {
    const fixture = { users: [{ id: 'u1', photos: ['a'] }] };
    const ilk = createFakeSupabase(fixture);
    const ikinci = createFakeSupabase(fixture);
    ilk.table('users')[0].photos.push('b');
    expect(ikinci.table('users')[0].photos).toEqual(['a']);
    expect(fixture.users[0].photos).toEqual(['a']);
  });
});
