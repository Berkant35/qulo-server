# AI Question Bank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gemini API dependency with a pre-built question bank (5000 questions, 10 languages) served from Supabase, with popularity tracking and admin CRUD.

**Architecture:** New `ai_question_bank` table replaces Gemini calls. Service rewrites DB queries with Laplace-smoothed scoring. Tracking hooks into existing `POST /questions` flow. Admin REST API endpoints under existing admin auth. Seed script populates 5000 questions from JSON files.

**Tech Stack:** TypeScript, Express, Supabase (PostgreSQL), Zod, Vitest, EJS (admin views)

**Spec:** `docs/superpowers/specs/2026-03-20-ai-question-bank-design.md`

---

## File Structure

```
src/
├── constants/
│   └── locales.ts                          # MODIFY: add 'hi' locale
├── validators/
│   ├── question.validator.ts               # MODIFY: expand QUESTION_CATEGORIES to 18
│   ├── ai-suggest.validator.ts             # MODIFY: locale → SUPPORTED_LOCALES import
│   └── question-bank.validator.ts          # CREATE: admin CRUD validation schemas
├── services/
│   ├── ai-suggest.service.ts               # REWRITE: Gemini → DB queries with scoring
│   └── question.service.ts                 # MODIFY: add tracking hook in createQuestion
├── controllers/
│   └── ai-suggest.controller.ts            # MODIFY: minimal (service API same)
├── admin/
│   ├── admin.routes.ts                     # MODIFY: add question-bank REST routes
│   ├── admin.controller.ts                 # MODIFY: add question-bank page render
│   └── views/
│       └── question-bank.ejs              # CREATE: admin UI page
├── migrations/
│   └── 013_ai_question_bank.sql           # CREATE: table + indexes + constraints
├── data/
│   └── seed/
│       ├── questions_tr.json              # CREATE: 500 Turkish questions
│       ├── questions_en.json              # CREATE: 500 English questions
│       ├── questions_es.json              # CREATE: 500 Spanish questions
│       ├── questions_ar.json              # CREATE: 500 Arabic questions
│       ├── questions_pt.json              # CREATE: 500 Portuguese questions
│       ├── questions_fr.json              # CREATE: 500 French questions
│       ├── questions_de.json              # CREATE: 500 German questions
│       ├── questions_ja.json              # CREATE: 500 Japanese questions
│       ├── questions_hi.json              # CREATE: 500 Hindi questions
│       └── questions_zh.json             # CREATE: 500 Chinese questions
scripts/
│   └── seed-question-bank.ts              # CREATE: seed script
src/__tests__/
│   └── ai-suggest.service.test.ts         # CREATE: service unit tests
```

---

### Task 1: Database Migration

**Files:**
- Create: `src/migrations/013_ai_question_bank.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 013_ai_question_bank.sql
-- AI Question Bank: pre-built question suggestions replacing Gemini API

CREATE TABLE IF NOT EXISTS ai_question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locale TEXT NOT NULL,
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answers JSONB NOT NULL,
  hint TEXT,
  target_gender TEXT,
  target_age_min INTEGER,
  target_age_max INTEGER,
  tone TEXT NOT NULL DEFAULT 'fun',
  shown_count INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_qbank_locale_question UNIQUE(locale, question_text),
  CONSTRAINT chk_qbank_tone CHECK (tone IN ('flirty', 'fun', 'deep')),
  CONSTRAINT chk_qbank_gender CHECK (target_gender IS NULL OR target_gender IN ('male', 'female')),
  CONSTRAINT chk_qbank_answers CHECK (jsonb_array_length(answers) = 4)
);

CREATE INDEX idx_qbank_locale_cat_active ON ai_question_bank(locale, category, is_active);
CREATE INDEX idx_qbank_locale_active ON ai_question_bank(locale, is_active);
CREATE INDEX idx_qbank_locale_qtext ON ai_question_bank(locale, question_text);

-- RPC for atomic counter increments
CREATE OR REPLACE FUNCTION increment_shown_count(question_ids UUID[])
RETURNS void AS $$
BEGIN
  UPDATE ai_question_bank
  SET shown_count = shown_count + 1
  WHERE id = ANY(question_ids);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_selected_count(p_locale TEXT, p_question_text TEXT)
RETURNS void AS $$
BEGIN
  UPDATE ai_question_bank
  SET selected_count = selected_count + 1
  WHERE locale = p_locale
    AND LOWER(TRIM(question_text)) = LOWER(TRIM(p_question_text))
    AND is_active = true;
END;
$$ LANGUAGE plpgsql;

-- Cleanup old Gemini cache table (guard against missing table)
DO $$ BEGIN
  TRUNCATE TABLE ai_question_suggestions;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
```

- [ ] **Step 2: Run migration on Supabase**

Run via Supabase MCP tool `execute_sql` or SQL Editor. Verify table created:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ai_question_bank' ORDER BY ordinal_position;
```

- [ ] **Step 3: Commit**

```bash
git add src/migrations/013_ai_question_bank.sql
git commit -m "feat: add ai_question_bank migration with atomic counter RPCs"
```

---

### Task 2: Expand Constants (Categories + Locales)

**Files:**
- Modify: `src/constants/locales.ts:1-25`
- Modify: `src/validators/question.validator.ts:4-7`

- [ ] **Step 1: Add 'hi' to SUPPORTED_LOCALES**

In `src/constants/locales.ts`, add `'hi'` to the array and `LOCALE_NAMES`:

```typescript
export const SUPPORTED_LOCALES = [
  'tr', 'en', 'de', 'fr', 'es', 'ar', 'ru',
  'pt', 'it', 'ja', 'ko', 'zh', 'nl', 'pl', 'sv', 'hi',
] as const;

// Add to LOCALE_NAMES:
hi: 'हिन्दी',
```

- [ ] **Step 2: Expand QUESTION_CATEGORIES to 18**

In `src/validators/question.validator.ts`, replace the categories array:

```typescript
export const QUESTION_CATEGORIES = [
  'personality', 'music', 'film', 'sports', 'travel',
  'food', 'technology', 'general', 'other',
  'fun', 'entertainment', 'lifestyle', 'humor',
  'hobby', 'science', 'history', 'art', 'nature',
] as const;
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/constants/locales.ts src/validators/question.validator.ts
git commit -m "feat: expand categories to 18 and add Hindi locale"
```

---

### Task 3: Update AI-Suggest Validator

**Files:**
- Modify: `src/validators/ai-suggest.validator.ts`

- [ ] **Step 1: Update validator to use SUPPORTED_LOCALES**

Rewrite `src/validators/ai-suggest.validator.ts`:

```typescript
import { z } from 'zod';
import { QUESTION_CATEGORIES } from './question.validator.js';
import { SUPPORTED_LOCALES } from '../constants/locales.js';

export const aiSuggestSchema = z.object({
  category: z.enum(QUESTION_CATEGORIES).optional(),
  profile_based: z.boolean().optional().default(false),
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional().default('tr'),
  count: z.number().int().min(1).max(10).optional().default(5),
});

export type AiSuggestInput = z.infer<typeof aiSuggestSchema>;
```

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/validators/ai-suggest.validator.ts
git commit -m "feat: ai-suggest validator now accepts all supported locales"
```

---

### Task 4: Rewrite AI-Suggest Service

**Files:**
- Rewrite: `src/services/ai-suggest.service.ts`
- Test: `src/__tests__/ai-suggest.service.test.ts`

- [ ] **Step 1: Write tests for scoring logic**

Create `src/__tests__/ai-suggest.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

// Test the scoring formula in isolation
function calculateScore(selectedCount: number, shownCount: number): number {
  return (selectedCount + 1) / (shownCount + 2);
}

describe('AI Question Bank Scoring', () => {
  it('new questions get ~0.5 score', () => {
    const score = calculateScore(0, 0);
    expect(score).toBe(0.5);
  });

  it('popular questions score higher', () => {
    const popular = calculateScore(50, 100);   // 51/102 ≈ 0.5
    const veryPopular = calculateScore(80, 100); // 81/102 ≈ 0.794
    expect(veryPopular).toBeGreaterThan(popular);
  });

  it('unpopular questions score lower', () => {
    const unpopular = calculateScore(5, 100);  // 6/102 ≈ 0.059
    const newQ = calculateScore(0, 0);          // 0.5
    expect(unpopular).toBeLessThan(newQ);
  });

  it('score is always between 0 and 1', () => {
    const cases = [
      [0, 0], [0, 1000], [1000, 1000], [500, 100],
    ];
    for (const [sel, shown] of cases) {
      const score = calculateScore(sel, shown);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/ai-suggest.service.test.ts`
Expected: All PASS

- [ ] **Step 3: Rewrite ai-suggest.service.ts**

Replace entire file `src/services/ai-suggest.service.ts`:

```typescript
import { supabase } from '../config/supabase.js';
import { Errors } from '../utils/errors.js';

interface QuestionBankRow {
  id: string;
  locale: string;
  category: string;
  question_text: string;
  answers: string[];
  hint: string | null;
  target_gender: string | null;
  target_age_min: number | null;
  target_age_max: number | null;
  tone: string;
  shown_count: number;
  selected_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ScoredQuestion extends QuestionBankRow {
  score: number;
}

class AiSuggestService {
  /**
   * Get suggestions by category from the question bank.
   * Scores by popularity (Laplace smoothing), picks random subset.
   */
  async getCachedSuggestions(
    userId: string,
    category: string,
    locale: string = 'tr',
    count: number = 5,
  ) {
    // 1. Get user's existing questions for dedup
    const existingTexts = await this.getUserQuestionTexts(userId);

    // 2. Query question bank
    let query = supabase
      .from('ai_question_bank')
      .select('*')
      .eq('locale', locale)
      .eq('category', category)
      .eq('is_active', true);

    const { data, error } = await query.limit(200);
    if (error) throw Errors.SERVER_ERROR();
    if (!data || data.length === 0) return [];

    // 3. Filter out user's existing questions
    const filtered = data.filter(
      (q) => !existingTexts.has(q.question_text.toLowerCase().trim()),
    );
    if (filtered.length === 0) return [];

    // 4. Score, sort, pick top pool, then random select
    const suggestions = this.scoreAndPick(filtered, count);

    // 5. Atomically increment shown_count
    const ids = suggestions.map((s) => s.id);
    await this.incrementShownCount(ids);

    // 6. Format response (client-compatible)
    return suggestions.map((s) => ({
      question_text: s.question_text,
      answers: s.answers,
      correct_answer: 1, // Personal preference questions have no correct answer
      hint: s.hint ?? null,
      category: s.category,
    }));
  }

  /**
   * Get profile-based suggestions filtered by user's age/gender.
   */
  async getProfileBasedSuggestions(
    userId: string,
    locale: string = 'tr',
    count: number = 5,
  ) {
    // 1. Get user profile
    const { data: user } = await supabase
      .from('users')
      .select('age, gender')
      .eq('id', userId)
      .single();

    if (!user) throw Errors.USER_NOT_FOUND();

    // 2. Get user's existing questions for dedup
    const existingTexts = await this.getUserQuestionTexts(userId);

    // 3. Query with profile filters
    let query = supabase
      .from('ai_question_bank')
      .select('*')
      .eq('locale', locale)
      .eq('is_active', true);

    const { data, error } = await query.limit(500);
    if (error) throw Errors.SERVER_ERROR();
    if (!data || data.length === 0) return [];

    // 4. Filter by profile + dedup
    const filtered = data.filter((q) => {
      // Dedup
      if (existingTexts.has(q.question_text.toLowerCase().trim())) return false;
      // Gender filter
      if (q.target_gender && q.target_gender !== user.gender) return false;
      // Age filter
      if (user.age) {
        if (q.target_age_min && user.age < q.target_age_min) return false;
        if (q.target_age_max && user.age > q.target_age_max) return false;
      }
      return true;
    });

    if (filtered.length === 0) return [];

    // 5. Score and pick
    const suggestions = this.scoreAndPick(filtered, count);

    // 6. Increment shown_count
    const ids = suggestions.map((s) => s.id);
    await this.incrementShownCount(ids);

    // 7. Format response
    return suggestions.map((s) => ({
      question_text: s.question_text,
      answers: s.answers,
      correct_answer: 1,
      hint: s.hint ?? null,
      category: s.category,
    }));
  }

  /**
   * Track when a user selects a suggestion (fire-and-forget).
   * Called from question.service.ts createQuestion.
   */
  async trackSelection(locale: string, questionText: string): Promise<void> {
    try {
      await supabase.rpc('increment_selected_count', {
        p_locale: locale,
        p_question_text: questionText,
      });
    } catch {
      // Fire-and-forget: tracking failure should never block question creation
    }
  }

  // --- Private helpers ---

  private scoreAndPick(questions: QuestionBankRow[], count: number): ScoredQuestion[] {
    // Calculate Laplace-smoothed score
    const scored = questions.map((q) => ({
      ...q,
      score: (q.selected_count + 1) / (q.shown_count + 2),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take top pool (count * 3)
    const pool = scored.slice(0, count * 3);

    // Random pick from pool
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private async getUserQuestionTexts(userId: string): Promise<Set<string>> {
    const { data } = await supabase
      .from('questions')
      .select('question_text')
      .eq('user_id', userId);

    return new Set(
      (data ?? []).map((q) => q.question_text.toLowerCase().trim()),
    );
  }

  private async incrementShownCount(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await supabase.rpc('increment_shown_count', { question_ids: ids });
    } catch {
      // Non-critical: don't fail the request
    }
  }
}

export const aiSuggestService = new AiSuggestService();
```

- [ ] **Step 4: Update controller (pass userId)**

In `src/controllers/ai-suggest.controller.ts`, update to pass userId to getCachedSuggestions:

```typescript
import { Request, Response, NextFunction } from 'express';
import { aiSuggestService } from '../services/ai-suggest.service.js';

export async function aiSuggestHandler(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const userId = req.user!.userId;
    const { category, profile_based, locale, count } = req.body;

    let suggestions;
    if (profile_based) {
      suggestions = await aiSuggestService.getProfileBasedSuggestions(userId, locale, count);
    } else if (category) {
      suggestions = await aiSuggestService.getCachedSuggestions(userId, category, locale, count);
    } else {
      return res.status(400).json({ error: 'category or profile_based required' });
    }

    res.json({ suggestions });
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/services/ai-suggest.service.ts src/controllers/ai-suggest.controller.ts src/__tests__/ai-suggest.service.test.ts
git commit -m "feat: rewrite ai-suggest service with DB-backed question bank and popularity scoring"
```

---

### Task 5: Add Tracking Hook to Question Service

**Files:**
- Modify: `src/services/question.service.ts:20-63`

- [ ] **Step 1: Add tracking import and hook**

In `src/services/question.service.ts`, add import at top:

```typescript
import { aiSuggestService } from './ai-suggest.service.js';
```

Then in `createQuestion` method, after the successful insert (after line 62 `return data;`), add tracking call before the return:

```typescript
  async createQuestion(userId: string, input: CreateQuestionInput) {
    // ... existing count check ...
    // ... existing insert ...

    if (error) {
      if (error.code === "23505") {
        throw new AppError("DUPLICATE_ORDER_NUM", 409, "Question with this order number already exists");
      }
      throw Errors.SERVER_ERROR();
    }

    // Fire-and-forget: track if this question came from AI suggestion bank
    aiSuggestService.trackSelection(
      input.locale || 'tr',
      input.question_text,
    ).catch(() => {}); // Never block question creation

    return data;
  }
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/services/question.service.ts
git commit -m "feat: add tracking hook for AI question bank selection"
```

---

### Task 6: Admin Question Bank Validator

**Files:**
- Create: `src/validators/question-bank.validator.ts`

- [ ] **Step 1: Create validator schemas**

Create `src/validators/question-bank.validator.ts`:

```typescript
import { z } from 'zod';
import { QUESTION_CATEGORIES } from './question.validator.js';
import { SUPPORTED_LOCALES } from '../constants/locales.js';

const TONES = ['flirty', 'fun', 'deep'] as const;

export const createQuestionBankSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]),
  category: z.enum(QUESTION_CATEGORIES),
  question_text: z.string().min(5).max(500),
  answers: z.array(z.string().min(1).max(200)).length(4),
  hint: z.string().max(300).optional(),
  target_gender: z.enum(['male', 'female']).optional(),
  target_age_min: z.number().int().min(13).max(100).optional(),
  target_age_max: z.number().int().min(13).max(100).optional(),
  tone: z.enum(TONES).optional().default('fun'),
});

export const bulkCreateQuestionBankSchema = z.object({
  questions: z.array(createQuestionBankSchema).min(1).max(500),
});

export const updateQuestionBankSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES as unknown as [string, ...string[]]).optional(),
  category: z.enum(QUESTION_CATEGORIES).optional(),
  question_text: z.string().min(5).max(500).optional(),
  answers: z.array(z.string().min(1).max(200)).length(4).optional(),
  hint: z.string().max(300).optional().nullable(),
  target_gender: z.enum(['male', 'female']).optional().nullable(),
  target_age_min: z.number().int().min(13).max(100).optional().nullable(),
  target_age_max: z.number().int().min(13).max(100).optional().nullable(),
  tone: z.enum(TONES).optional(),
  is_active: z.boolean().optional(),
});

export const listQuestionBankSchema = z.object({
  locale: z.string().optional(),
  category: z.string().optional(),
  tone: z.string().optional(),
  is_active: z.string().optional(), // "true" or "false" from query params
  sort: z.enum(['created_at', 'updated_at', 'shown_count', 'selected_count', 'acceptance_rate']).optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export type CreateQuestionBankInput = z.infer<typeof createQuestionBankSchema>;
export type BulkCreateQuestionBankInput = z.infer<typeof bulkCreateQuestionBankSchema>;
export type UpdateQuestionBankInput = z.infer<typeof updateQuestionBankSchema>;
export type ListQuestionBankInput = z.infer<typeof listQuestionBankSchema>;
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/validators/question-bank.validator.ts
git commit -m "feat: add question bank admin CRUD validators"
```

---

### Task 7: Admin Question Bank Controller + Routes

**Files:**
- Create: `src/admin/question-bank.controller.ts`
- Modify: `src/admin/admin.routes.ts:44-46`
- Create: `src/admin/views/question-bank.ejs`

- [ ] **Step 1: Create question-bank controller**

Create `src/admin/question-bank.controller.ts`:

```typescript
import type { Request, Response } from 'express';
import { supabase } from '../config/supabase.js';
import {
  createQuestionBankSchema,
  bulkCreateQuestionBankSchema,
  updateQuestionBankSchema,
  listQuestionBankSchema,
} from '../validators/question-bank.validator.js';

class QuestionBankController {
  /** GET /admin/question-bank — render EJS page */
  async page(req: Request, res: Response) {
    res.render('question-bank', { session: req.session });
  }

  /** GET /admin/question-bank/api — JSON list with pagination */
  async list(req: Request, res: Response) {
    const params = listQuestionBankSchema.parse(req.query);
    const { page, limit, sort, order, locale, category, tone, is_active } = params;
    const offset = (page - 1) * limit;

    let query = supabase.from('ai_question_bank').select('*', { count: 'exact' });

    if (locale) query = query.eq('locale', locale);
    if (category) query = query.eq('category', category);
    if (tone) query = query.eq('tone', tone);
    if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');

    // Sort — acceptance_rate is computed, handle separately
    if (sort === 'acceptance_rate') {
      // Supabase doesn't support computed column sort, fetch all and sort in memory
      const { data, error, count } = await query;
      if (error) return res.status(500).json({ error: 'DB error' });

      const withRate = (data ?? []).map((q) => ({
        ...q,
        acceptance_rate: q.shown_count > 0 ? q.selected_count / q.shown_count : null,
      }));
      withRate.sort((a, b) => {
        const aRate = a.acceptance_rate ?? -1;
        const bRate = b.acceptance_rate ?? -1;
        return order === 'desc' ? bRate - aRate : aRate - bRate;
      });

      const paged = withRate.slice(offset, offset + limit);
      return res.json({
        data: paged,
        pagination: { page, limit, total: count ?? 0 },
      });
    }

    query = query.order(sort, { ascending: order === 'asc' });
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ error: 'DB error' });

    const withRate = (data ?? []).map((q) => ({
      ...q,
      acceptance_rate: q.shown_count > 0 ? q.selected_count / q.shown_count : null,
    }));

    res.json({
      data: withRate,
      pagination: { page, limit, total: count ?? 0 },
    });
  }

  /** POST /admin/question-bank/api — create single question */
  async create(req: Request, res: Response) {
    const input = createQuestionBankSchema.parse(req.body);
    const { data, error } = await supabase
      .from('ai_question_bank')
      .insert(input)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Duplicate question for this locale' });
      }
      return res.status(500).json({ error: 'DB error' });
    }
    res.status(201).json(data);
  }

  /** POST /admin/question-bank/api/bulk — bulk create (max 500) */
  async bulkCreate(req: Request, res: Response) {
    const { questions } = bulkCreateQuestionBankSchema.parse(req.body);
    const { data, error } = await supabase
      .from('ai_question_bank')
      .insert(questions)
      .select('id');

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    res.status(201).json({ inserted: data?.length ?? 0 });
  }

  /** PUT /admin/question-bank/api/:id — update question */
  async update(req: Request, res: Response) {
    const id = req.params.id;
    const input = updateQuestionBankSchema.parse(req.body);
    const updateData = { ...input, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('ai_question_bank')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: 'DB error' });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  }

  /** DELETE /admin/question-bank/api/:id — soft delete */
  async remove(req: Request, res: Response) {
    const id = req.params.id;
    const { error } = await supabase
      .from('ai_question_bank')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return res.status(500).json({ error: 'DB error' });
    res.json({ message: 'Deactivated' });
  }
}

export const questionBankController = new QuestionBankController();
```

- [ ] **Step 2: Add routes to admin.routes.ts**

In `src/admin/admin.routes.ts`, add after the existing questions routes (after line 46):

```typescript
import { questionBankController } from './question-bank.controller.js';

// Question Bank (AI suggestions)
router.get("/question-bank", (req, res) => questionBankController.page(req, res));
router.get("/question-bank/api", (req, res) => questionBankController.list(req, res));
router.post("/question-bank/api", csrfValidate, (req, res) => questionBankController.create(req, res));
router.post("/question-bank/api/bulk", csrfValidate, (req, res) => questionBankController.bulkCreate(req, res));
router.put("/question-bank/api/:id", csrfValidate, (req, res) => questionBankController.update(req, res));
router.delete("/question-bank/api/:id", csrfValidate, (req, res) => questionBankController.remove(req, res));
```

- [ ] **Step 3: Create EJS view**

Create `src/admin/views/question-bank.ejs` — a simple admin page with:
- Table with columns: question_text (truncated), locale, category, tone, target, shown/selected/rate, actions
- Filters: locale dropdown, category dropdown, tone dropdown, active/inactive toggle
- "Add Question" modal
- Edit/deactivate buttons per row
- Uses fetch() to call `/admin/question-bank/api` endpoints

(Full EJS template is implementation detail — follow existing admin view patterns like `users.ejs`)

- [ ] **Step 4: Add navigation link to admin header**

Find the admin layout/header partial (e.g., `src/admin/views/_header.ejs` or the layout that contains the nav menu). Add a "Question Bank" link alongside existing nav items:

```html
<a href="/admin/question-bank" class="<%= path === '/admin/question-bank' ? 'active' : '' %>">Question Bank</a>
```

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/admin/question-bank.controller.ts src/admin/admin.routes.ts src/admin/views/
git commit -m "feat: add admin question bank CRUD with EJS view"
```

---

### Task 8: Seed Script

**Files:**
- Create: `scripts/seed-question-bank.ts`

- [ ] **Step 1: Create seed script**

Create `scripts/seed-question-bank.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BATCH_SIZE = 200;

interface SeedQuestion {
  locale: string;
  category: string;
  question_text: string;
  answers: string[];
  hint?: string;
  target_gender?: 'male' | 'female';
  target_age_min?: number;
  target_age_max?: number;
  tone?: 'flirty' | 'fun' | 'deep';
}

async function seed() {
  const seedDir = join(__dirname, '..', 'src', 'data', 'seed');
  const files = readdirSync(seedDir).filter((f) => f.startsWith('questions_') && f.endsWith('.json'));

  if (files.length === 0) {
    console.error('No seed files found in src/data/seed/');
    process.exit(1);
  }

  let totalInserted = 0;

  for (const file of files) {
    const locale = file.replace('questions_', '').replace('.json', '');
    console.log(`\nSeeding ${locale}...`);

    const raw = readFileSync(join(seedDir, file), 'utf-8');
    const questions: SeedQuestion[] = JSON.parse(raw);

    // Batch insert
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE).map((q) => ({
        locale: q.locale || locale,
        category: q.category,
        question_text: q.question_text,
        answers: q.answers,
        hint: q.hint || null,
        target_gender: q.target_gender || null,
        target_age_min: q.target_age_min || null,
        target_age_max: q.target_age_max || null,
        tone: q.tone || 'fun',
      }));

      const { data, error } = await supabase
        .from('ai_question_bank')
        .upsert(batch, { onConflict: 'locale,question_text', ignoreDuplicates: true })
        .select('id');

      if (error) {
        console.error(`  Error batch ${i}-${i + BATCH_SIZE}: ${error.message}`);
      } else {
        const count = data?.length ?? 0;
        totalInserted += count;
        console.log(`  Batch ${i}-${i + BATCH_SIZE}: ${count} inserted`);
      }
    }
  }

  console.log(`\nDone! Total inserted: ${totalInserted}`);
}

async function deleteAll() {
  console.log('Deleting all question bank entries...');
  const { error } = await supabase.from('ai_question_bank').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('All entries deleted.');
  }
}

const args = process.argv.slice(2);
if (args.includes('--delete')) {
  deleteAll();
} else {
  seed();
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-question-bank.ts
git commit -m "feat: add question bank seed script with batch upsert"
```

---

### Task 9: Generate Seed Questions (TR + EN)

**Files:**
- Create: `src/data/seed/questions_tr.json`
- Create: `src/data/seed/questions_en.json`

This is the content-heavy task. Generate 500 Turkish + 500 English dating-app personal preference questions following spec rules:

- Personal preference, NOT trivia
- 4 answer choices reflecting personality
- Category distribution as per spec (personality: 80, travel: 55, lifestyle: 55, fun: 50, food: 45, music: 40, film: 40, sports: 35, humor: 35, hobby: 35, technology: 30)
- Tone distribution: 50% fun, 30% flirty, 20% deep
- Target audience: 80% everyone, 10% male, 10% female, 20% age-filtered

- [ ] **Step 1: Create `src/data/seed/` directory**

```bash
mkdir -p src/data/seed
```

- [ ] **Step 2: Generate questions_tr.json**

Create JSON file with 500 Turkish questions. Each question:
```json
{
  "category": "personality",
  "question_text": "Ilk bulusmada karsi taraf seni nereye goturse en cok etkilenirsin?",
  "answers": ["Gizli bir kafeye", "Kitapciya", "Catida film izlemeye", "Gece muzesine"],
  "tone": "flirty",
  "target_gender": null,
  "target_age_min": null,
  "target_age_max": null
}
```

- [ ] **Step 3: Generate questions_en.json**

Same structure, 500 English questions with cultural adaptation (not direct translation).

- [ ] **Step 4: Run seed script**

```bash
source .env && npx tsx scripts/seed-question-bank.ts
```
Expected: "Done! Total inserted: 1000"

- [ ] **Step 5: Verify data in Supabase**

```sql
SELECT locale, COUNT(*) FROM ai_question_bank GROUP BY locale;
-- Expected: tr: 500, en: 500

SELECT category, COUNT(*) FROM ai_question_bank WHERE locale = 'tr' GROUP BY category ORDER BY count DESC;
-- Expected: personality: 80, travel: 55, ...
```

- [ ] **Step 6: Commit**

```bash
git add src/data/seed/questions_tr.json src/data/seed/questions_en.json
git commit -m "feat: add 1000 seed questions (500 TR + 500 EN)"
```

---

### Task 10: Generate Remaining 8 Language Seed Files

**Files:**
- Create: `src/data/seed/questions_es.json`
- Create: `src/data/seed/questions_ar.json`
- Create: `src/data/seed/questions_pt.json`
- Create: `src/data/seed/questions_fr.json`
- Create: `src/data/seed/questions_de.json`
- Create: `src/data/seed/questions_ja.json`
- Create: `src/data/seed/questions_hi.json`
- Create: `src/data/seed/questions_zh.json`

Each file: 500 culturally adapted questions following same distribution rules.

- [ ] **Step 1: Generate questions for es, ar, pt, fr**

Cultural adaptation, not direct translation. Each file 500 questions.

- [ ] **Step 2: Generate questions for de, ja, hi, zh**

Same approach.

- [ ] **Step 3: Run seed script**

```bash
source .env && npx tsx scripts/seed-question-bank.ts
```
Expected: "Done! Total inserted: 4000" (previous 1000 skipped as upsert)

- [ ] **Step 4: Verify totals**

```sql
SELECT locale, COUNT(*) FROM ai_question_bank GROUP BY locale ORDER BY locale;
-- Expected: 10 rows, each with 500
```

- [ ] **Step 5: Commit**

```bash
git add src/data/seed/
git commit -m "feat: add 4000 seed questions for 8 remaining languages"
```

---

### Task 11: Integration Test & Cleanup

**Files:**
- Modify: `src/config/env.ts` (optional: make GEMINI_API_KEY truly optional)

- [ ] **Step 1: Test endpoint locally**

Start server: `npm run dev`

```bash
# Category-based
curl -X POST http://localhost:3000/api/v1/questions/ai-suggest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"category":"personality","locale":"tr","count":3}'

# Profile-based
curl -X POST http://localhost:3000/api/v1/questions/ai-suggest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"profile_based":true,"locale":"tr","count":3}'
```

Expected: 200 with `{ suggestions: [...] }` containing 3 questions

- [ ] **Step 2: Test admin panel**

Open browser → `/admin/question-bank`
Verify: table loads, filters work, pagination works, metrics visible

- [ ] **Step 3: Test tracking**

Create a question via POST /questions with a question_text that matches a bank entry.
Verify: `selected_count` incremented in ai_question_bank.

- [ ] **Step 4: Make GEMINI_API_KEY optional in env.ts**

In `src/config/env.ts`, the GEMINI_API_KEY is already `.default('')` so no change needed. But we can remove the import/usage from the service since it's no longer used.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete AI question bank — Gemini replaced with 5000 pre-built questions"
```

---

## Summary

| Task | Description | Dependencies |
|------|-------------|-------------|
| 1 | Database migration | None |
| 2 | Expand categories + locales | None |
| 3 | Update ai-suggest validator | Task 2 |
| 4 | Rewrite ai-suggest service | Tasks 1, 2, 3 |
| 5 | Add tracking hook | Task 4 |
| 6 | Admin validators | Task 2 |
| 7 | Admin controller + routes + view | Tasks 1, 6 |
| 8 | Seed script | Task 1 |
| 9 | Generate TR + EN questions | Task 8 |
| 10 | Generate remaining 8 languages | Task 8 |
| 11 | Integration test & cleanup | All |

**Parallel opportunities:** Tasks 1+2 can run in parallel. Tasks 6+8 can run in parallel (after 1+2). Tasks 9+10 can run in parallel.
