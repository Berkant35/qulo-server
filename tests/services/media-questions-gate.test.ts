import { describe, it, expect, vi, beforeEach } from 'vitest';

const getFlag = vi.fn();
vi.mock('../../src/services/app-config.service.js', () => ({
  appConfigService: { getMediaQuestionsEnabled: () => getFlag() },
}));

import { mediaQuestionsActive } from '../../src/services/media-questions-gate.js';

beforeEach(() => getFlag.mockReset());

describe('mediaQuestionsActive', () => {
  it('bayrak acik + surum >= 2.0.18+101 → true', async () => {
    getFlag.mockResolvedValue(true);
    expect(await mediaQuestionsActive({ 'x-app-version': '2.0.18+101' })).toBe(true);
  });
  it('2.0.18+100 (medya UI yok) → false', async () => {
    getFlag.mockResolvedValue(true);
    expect(await mediaQuestionsActive({ 'x-app-version': '2.0.18+100' })).toBe(false);
  });
  it('bayrak kapali → false', async () => {
    getFlag.mockResolvedValue(false);
    expect(await mediaQuestionsActive({ 'x-app-version': '2.0.19+101' })).toBe(false);
  });
  it('eski surum → false (bayrak okunmaz)', async () => {
    getFlag.mockResolvedValue(true);
    expect(await mediaQuestionsActive({ 'x-app-version': '2.0.18+100' })).toBe(false);
    expect(getFlag).not.toHaveBeenCalled();
  });
  it('baslik yok → false', async () => {
    getFlag.mockResolvedValue(true);
    expect(await mediaQuestionsActive({})).toBe(false);
  });
});
