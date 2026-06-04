import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../../src/services/notification.service.js';

vi.mock('../../src/config/supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { supabase } from '../../src/config/supabase.js';

function mockSelect(result: { data?: unknown; error?: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq2 = vi.fn(() => ({ maybeSingle }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  (supabase.from as any).mockReturnValue({ select });
}

describe('NotificationService.getTemplate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns locale default when no override exists', async () => {
    mockSelect({ data: null, error: null });
    const tpl = await NotificationService.getTemplate('new_message', 'tr');
    expect(tpl).not.toBeNull();
    expect(tpl!.title.length).toBeGreaterThan(0);
    expect(tpl!.body.length).toBeGreaterThan(0);
  });

  it('full override replaces both title and body', async () => {
    mockSelect({ data: { title: 'X', body: 'Y', is_active: true }, error: null });
    const tpl = await NotificationService.getTemplate('new_message', 'tr');
    expect(tpl).toEqual({ title: 'X', body: 'Y' });
  });

  it('partial override (body only) keeps default title', async () => {
    mockSelect({ data: { title: null, body: 'Y', is_active: true }, error: null });
    const tpl = await NotificationService.getTemplate('new_message', 'tr');
    expect(tpl!.body).toBe('Y');
    expect(tpl!.title.length).toBeGreaterThan(0); // default
  });

  it('returns null when is_active=false', async () => {
    mockSelect({ data: { title: 'X', body: 'Y', is_active: false }, error: null });
    const tpl = await NotificationService.getTemplate('new_message', 'tr');
    expect(tpl).toBeNull();
  });

  it('falls back to locale default when DB throws', async () => {
    (supabase.from as any).mockImplementation(() => { throw new Error('db down'); });
    const tpl = await NotificationService.getTemplate('new_message', 'tr');
    expect(tpl).not.toBeNull();
    expect(tpl!.title.length).toBeGreaterThan(0);
  });

  it('returns null for unknown type with no override', async () => {
    mockSelect({ data: null, error: null });
    const tpl = await NotificationService.getTemplate('does_not_exist' as any, 'tr');
    expect(tpl).toBeNull();
  });
});
