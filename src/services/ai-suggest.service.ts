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
  async getCachedSuggestions(
    userId: string,
    category: string,
    locale: string = 'tr',
    count: number = 5,
  ) {
    const existingTexts = await this.getUserQuestionTexts(userId);

    const { data, error } = await supabase
      .from('ai_question_bank')
      .select('*')
      .eq('locale', locale)
      .eq('category', category)
      .eq('is_active', true)
      .limit(200);

    if (error) throw Errors.SERVER_ERROR();
    if (!data || data.length === 0) return [];

    const filtered = (data as QuestionBankRow[]).filter(
      (q) => !existingTexts.has(q.question_text.toLowerCase().trim()),
    );
    if (filtered.length === 0) return [];

    const suggestions = this.scoreAndPick(filtered, count);
    await this.incrementShownCount(suggestions.map((s) => s.id));

    return suggestions.map((s) => this.shuffleAnswers(s));
  }

  async getProfileBasedSuggestions(
    userId: string,
    locale: string = 'tr',
    count: number = 5,
  ) {
    const { data: user } = await supabase
      .from('users')
      .select('age, gender')
      .eq('id', userId)
      .single();

    if (!user) throw Errors.USER_NOT_FOUND();

    const existingTexts = await this.getUserQuestionTexts(userId);

    const { data, error } = await supabase
      .from('ai_question_bank')
      .select('*')
      .eq('locale', locale)
      .eq('is_active', true)
      .limit(500);

    if (error) throw Errors.SERVER_ERROR();
    if (!data || data.length === 0) return [];

    const filtered = (data as QuestionBankRow[]).filter((q) => {
      if (existingTexts.has(q.question_text.toLowerCase().trim())) return false;
      if (q.target_gender && q.target_gender !== user.gender) return false;
      if (user.age) {
        if (q.target_age_min && user.age < q.target_age_min) return false;
        if (q.target_age_max && user.age > q.target_age_max) return false;
      }
      return true;
    });

    if (filtered.length === 0) return [];

    const suggestions = this.scoreAndPick(filtered, count);
    await this.incrementShownCount(suggestions.map((s) => s.id));

    return suggestions.map((s) => this.shuffleAnswers(s));
  }

  /**
   * Shuffle answer order and track the new position of the correct answer (originally at index 0).
   * Prevents predictable "always answer A" pattern for quiz solvers.
   */
  private shuffleAnswers(s: ScoredQuestion) {
    const answers = [...s.answers];
    const correctOriginal = answers[0];
    // Fisher-Yates shuffle
    for (let i = answers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [answers[i], answers[j]] = [answers[j], answers[i]];
    }
    // correct_answer is 1-indexed (position of originally-correct answer in new array)
    const correctAnswer = answers.indexOf(correctOriginal) + 1;
    return {
      question_text: s.question_text,
      answers,
      correct_answer: correctAnswer,
      hint: s.hint ?? null,
      category: s.category,
    };
  }

  async trackSelection(locale: string, questionText: string): Promise<void> {
    try {
      await supabase.rpc('increment_selected_count', {
        p_locale: locale,
        p_question_text: questionText,
      });
    } catch {
      // Fire-and-forget
    }
  }

  private scoreAndPick(questions: QuestionBankRow[], count: number): ScoredQuestion[] {
    const scored: ScoredQuestion[] = questions.map((q) => ({
      ...q,
      score: (q.selected_count + 1) / (q.shown_count + 2),
    }));

    scored.sort((a, b) => b.score - a.score);
    const pool = scored.slice(0, count * 3);
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private async getUserQuestionTexts(userId: string): Promise<Set<string>> {
    const { data } = await supabase
      .from('questions')
      .select('question_text')
      .eq('user_id', userId);

    return new Set(
      (data ?? []).map((q: any) => (q.question_text as string).toLowerCase().trim()),
    );
  }

  private async incrementShownCount(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      await supabase.rpc('increment_shown_count', { question_ids: ids });
    } catch {
      // Non-critical
    }
  }
}

export const aiSuggestService = new AiSuggestService();
