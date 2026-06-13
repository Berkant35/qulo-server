import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Supabase chain mocks ----------------------------------------------------
// users SELECT chain: from('users').select(...).eq('id', userId).single()
const userSingleMock = vi.fn();
// questions INSERT chain: from('questions').insert(rows).select('id')
const insertSelectMock = vi.fn();
const insertMock = vi.fn((_rows: Array<Record<string, unknown>>) => ({
  select: insertSelectMock,
}));

const fromMock = vi.fn((table: string) => {
  if (table === 'users') {
    return {
      select: () => ({
        eq: () => ({ single: userSingleMock }),
      }),
    };
  }
  if (table === 'questions') {
    return {
      insert: insertMock,
    };
  }
  throw new Error(`Unexpected table: ${table}`);
});

vi.mock('../config/supabase.js', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

// --- Subscription service mock ----------------------------------------------
const getLimitsMock = vi.fn();
vi.mock('../services/subscription.service.js', () => ({
  subscriptionService: {
    getLimits: (plan: string | null) => getLimitsMock(plan),
    getStatus: vi.fn(),
  },
}));

// --- AI suggest service mock -------------------------------------------------
const suggestMock = vi.fn();
vi.mock('../services/ai-suggest.service.js', () => ({
  aiSuggestService: {
    getProfileBasedSuggestions: (...args: unknown[]) => suggestMock(...args),
    trackSelection: vi.fn(() => Promise.resolve()),
  },
}));

// Import AFTER mocks
import { questionService } from '../services/question.service.js';

function fakeSuggestion(text: string, correct = 1) {
  return {
    question_text: text,
    answers: ['A', 'B', 'C', 'D'],
    correct_answer: correct,
    hint: null,
    category: 'general',
  };
}

beforeEach(() => {
  userSingleMock.mockReset();
  insertMock.mockClear();
  insertSelectMock.mockReset();
  getLimitsMock.mockReset();
  suggestMock.mockReset();
});

describe('QuestionService.quickAssignQuestions', () => {
  it('user has 0 questions, max 3 → assigns 2 (capped at MIN_REQUIRED)', async () => {
    userSingleMock.mockResolvedValue({
      data: { question_count: 0, locale: 'tr', subscription_plan: null },
      error: null,
    });
    getLimitsMock.mockResolvedValue({ maxQuestions: 3 });
    suggestMock.mockResolvedValue([fakeSuggestion('Q1'), fakeSuggestion('Q2')]);
    insertSelectMock.mockResolvedValue({
      data: [{ id: 'id-1' }, { id: 'id-2' }],
      error: null,
    });

    const result = await questionService.quickAssignQuestions('user-1');

    expect(suggestMock).toHaveBeenCalledWith('user-1', 'tr', 2);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertedRows = insertMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(insertedRows.length).toBe(2);
    expect(insertedRows[0].order_num).toBe(1);
    expect(insertedRows[1].order_num).toBe(2);
    expect(insertedRows[0].user_id).toBe('user-1');
    expect(insertedRows[0].locale).toBe('tr');
    expect(insertedRows[0].time_limit).toBe(30);
    expect(result).toEqual({
      assignedCount: 2,
      assignedQuestionIds: ['id-1', 'id-2'],
    });
  });

  it('user has 1 question, max 3 → assigns 1 (needs only 1 more)', async () => {
    userSingleMock.mockResolvedValue({
      data: { question_count: 1, locale: 'tr', subscription_plan: 'free' },
      error: null,
    });
    getLimitsMock.mockResolvedValue({ maxQuestions: 3 });
    suggestMock.mockResolvedValue([fakeSuggestion('Q1')]);
    insertSelectMock.mockResolvedValue({
      data: [{ id: 'id-1' }],
      error: null,
    });

    const result = await questionService.quickAssignQuestions('user-2');

    expect(suggestMock).toHaveBeenCalledWith('user-2', 'tr', 1);
    const insertedRows = insertMock.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(insertedRows.length).toBe(1);
    expect(insertedRows[0].order_num).toBe(2); // currentCount + index + 1 = 1+0+1
    expect(result.assignedCount).toBe(1);
  });

  it('user has 2 questions → assigns 0 (already at minimum) and does not call ai-suggest', async () => {
    userSingleMock.mockResolvedValue({
      data: { question_count: 2, locale: 'tr', subscription_plan: 'free' },
      error: null,
    });
    getLimitsMock.mockResolvedValue({ maxQuestions: 3 });

    const result = await questionService.quickAssignQuestions('user-3');

    expect(suggestMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(result).toEqual({ assignedCount: 0, assignedQuestionIds: [] });
  });

  it('user has 3 questions, max 3 → assigns 0 (at hard cap)', async () => {
    userSingleMock.mockResolvedValue({
      data: { question_count: 3, locale: 'tr', subscription_plan: 'free' },
      error: null,
    });
    getLimitsMock.mockResolvedValue({ maxQuestions: 3 });

    const result = await questionService.quickAssignQuestions('user-4');

    expect(suggestMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(result).toEqual({ assignedCount: 0, assignedQuestionIds: [] });
  });

  it('user has 2 questions, max 3, needed=0 → does NOT call ai-suggest', async () => {
    userSingleMock.mockResolvedValue({
      data: { question_count: 2, locale: 'en', subscription_plan: 'free' },
      error: null,
    });
    getLimitsMock.mockResolvedValue({ maxQuestions: 3 });

    await questionService.quickAssignQuestions('user-5');

    expect(suggestMock).not.toHaveBeenCalled();
  });

  it('throws QUICK_ASSIGN_NO_BANK_MATCH when ai-suggest returns empty', async () => {
    userSingleMock.mockResolvedValue({
      data: { question_count: 0, locale: 'tr', subscription_plan: null },
      error: null,
    });
    getLimitsMock.mockResolvedValue({ maxQuestions: 3 });
    suggestMock.mockResolvedValue([]);

    await expect(questionService.quickAssignQuestions('user-6')).rejects.toMatchObject({
      code: 'QUICK_ASSIGN_NO_BANK_MATCH',
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('throws USER_NOT_FOUND when user select fails', async () => {
    userSingleMock.mockResolvedValue({ data: null, error: { message: 'no row' } });

    await expect(questionService.quickAssignQuestions('user-7')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });
});
