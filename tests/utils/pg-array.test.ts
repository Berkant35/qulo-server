import { describe, it, expect } from 'vitest';
import { pgTextArrayLiteral } from '../../src/utils/pg-array.js';

/** PostgREST `pgBuildArrayLiteral` ile aynı biçim: her öğe tırnaklı, önce `\`, sonra `"` kaçışlanır. */
describe('pgTextArrayLiteral', () => {
  it('öğeler tırnaklı ve virgülle; virgül içeren URL bölünmez', () => {
    expect(pgTextArrayLiteral(['https://x/a.jpg', 'https://x/b,c.jpg'])).toBe('{"https://x/a.jpg","https://x/b,c.jpg"}');
  });

  it('ters bölü önce, tırnak sonra kaçışlanır', () => {
    expect(pgTextArrayLiteral(['a\\b', 'c"d', '\\"'])).toBe('{"a\\\\b","c\\"d","\\\\\\""}');
  });

  it('boş dizi {} olur', () => {
    expect(pgTextArrayLiteral([])).toBe('{}');
  });
});
