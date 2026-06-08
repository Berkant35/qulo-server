import { describe, it, expect, vi } from 'vitest';
import { pushTemplateBodySchema } from '../../src/validators/push-template.validator.js';

describe('push-template validator', () => {
  it('accepts a full override', () => {
    const r = pushTemplateBodySchema.safeParse({ title: 'X', body: 'Y', is_active: true });
    expect(r.success).toBe(true);
  });

  it('accepts partial override (body only)', () => {
    const r = pushTemplateBodySchema.safeParse({ body: 'Y', is_active: true });
    expect(r.success).toBe(true);
  });

  it('rejects empty active payload', () => {
    const r = pushTemplateBodySchema.safeParse({ is_active: true });
    expect(r.success).toBe(false);
  });

  it('rejects unknown placeholder', () => {
    const r = pushTemplateBodySchema.safeParse({ body: 'Hi {foo}', is_active: true });
    expect(r.success).toBe(false);
  });

  it('allows known placeholders', () => {
    const r = pushTemplateBodySchema.safeParse({ body: 'Hi {name}, your {badge}', is_active: true });
    expect(r.success).toBe(true);
  });

  it('accepts is_active=false with no content', () => {
    const r = pushTemplateBodySchema.safeParse({ is_active: false });
    expect(r.success).toBe(true);
  });
});

describe('pushTemplateAdminService.list (shape)', () => {
  it('returns one entry per PUSH_TYPE', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/supabase.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      },
    }));
    const { pushTemplateAdminService: svc } = await import('../../src/admin/admin.service.js');
    const rows = await svc.list('tr');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => {
      expect(r).toHaveProperty('type');
      expect(r).toHaveProperty('default_title');
      expect(r).toHaveProperty('is_active');
    });
  });

  it('returns exactly 6 admin-editable types (no campaign, no quiz_started, no passport_expired)', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/supabase.js', () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      },
    }));
    const { pushTemplateAdminService: svc } = await import('../../src/admin/admin.service.js');
    const rows = await svc.list('tr');
    expect(rows.length).toBe(6);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual([
      'chat_question_answered',
      'new_match',
      'new_match_badge',
      'new_match_solver',
      'new_message',
      'new_message_image',
    ]);
    expect(types).not.toContain('campaign');
    expect(types).not.toContain('quiz_started');
    expect(types).not.toContain('passport_expired');
  });
});
