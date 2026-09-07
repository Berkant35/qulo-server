import { describe, it, expect } from 'vitest';
import { clientKey } from '../../src/middleware/rateLimit.js';

/**
 * IPv6'da istemci /64 prefix altındaki adresleri değiştirerek IP bazlı limiti aşabilir;
 * anahtar prefix'e indirilince aşamaz. IPv4 ve IPv4-mapped adresler olduğu gibi kalır.
 */
describe('clientKey', () => {
  it('IPv4 adresini aynen kullanır', () => {
    expect(clientKey({ ip: '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('IPv4-mapped IPv6 adresini IPv4 olarak kullanır', () => {
    expect(clientKey({ ip: '::ffff:203.0.113.7' })).toBe('203.0.113.7');
  });

  it('IPv6 adresini /64 prefix anahtarına indirir — aynı prefix, aynı anahtar', () => {
    const a = clientKey({ ip: '2001:db8:85a3:1:8d3:1319:8a2e:370' });
    const b = clientKey({ ip: '2001:db8:85a3:1:ffff:ffff:ffff:ffff' });
    expect(a).toBe('2001:db8:85a3:1::/64');
    expect(b).toBe(a);
  });

  it('farklı /64 prefix farklı anahtar', () => {
    expect(clientKey({ ip: '2001:db8:85a3:1::1' })).not.toBe(clientKey({ ip: '2001:db8:85a3:2::1' }));
  });

  it('IP yoksa "unknown"', () => {
    expect(clientKey({})).toBe('unknown');
  });
});
