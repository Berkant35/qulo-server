import { describe, it, expect, vi } from 'vitest';
import multer from 'multer';
import { errorHandler } from '../../src/middleware/errorHandler.js';

/** errorHandler'in istemci hatalarini 500'e dusurmemesi (2026-09-28: multer boyut siniri). */
function calistir(err: Error) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  errorHandler(err, {} as never, res as never, vi.fn());
  return { kod: res.status.mock.calls[0]?.[0], govde: res.json.mock.calls[0]?.[0] };
}

describe('errorHandler', () => {
  it('multer dosya boyutu siniri 413 PAYLOAD_TOO_LARGE olur (500 degil)', () => {
    const { kod, govde } = calistir(new multer.MulterError('LIMIT_FILE_SIZE', 'photo'));
    expect(kod).toBe(413);
    expect(govde).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('bilinmeyen hata 500 SERVER_ERROR ve ic ayrinti sizdirmaz', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { kod, govde } = calistir(new Error('db sifresi yanlis: xyz'));
    expect(kod).toBe(500);
    expect(govde).toEqual({ error: { code: 'SERVER_ERROR' } });
    log.mockRestore();
  });
});
