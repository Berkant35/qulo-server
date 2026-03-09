import { supabase } from '../config/supabase.js';
import { env } from '../config/env.js';
import { Errors } from '../utils/errors.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

class AiSuggestService {
  async getCachedSuggestions(category: string, locale: string = 'tr', count: number = 5) {
    const { data, error } = await supabase
      .from('ai_question_suggestions')
      .select('*')
      .eq('category', category)
      .eq('locale', locale)
      .limit(count * 3);

    if (error) throw Errors.SERVER_ERROR();
    if (!data || data.length === 0) {
      return this.generateAndCache(category, locale, count);
    }

    const shuffled = data.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(s => ({
      question_text: s.question_text,
      answers: s.answers,
      correct_answer: s.correct_answer,
      hint: s.hint,
      category: s.category,
    }));
  }

  async getProfileBasedSuggestions(userId: string, locale: string = 'tr', count: number = 5) {
    if (!env.GEMINI_API_KEY) throw Errors.SERVER_ERROR();

    const { data: user } = await supabase
      .from('users')
      .select('name, age, gender, bio')
      .eq('id', userId)
      .single();

    if (!user) throw Errors.USER_NOT_FOUND();

    const profileContext = [
      user.name ? `İsim: ${user.name}` : '',
      user.age ? `Yaş: ${user.age}` : '',
      user.gender ? `Cinsiyet: ${user.gender}` : '',
      user.bio ? `Bio: ${user.bio}` : '',
    ].filter(Boolean).join(', ');

    return this.callGemini(profileContext, locale, count);
  }

  private async callGemini(context: string, locale: string, count: number) {
    if (!env.GEMINI_API_KEY) return [];

    const lang = locale === 'tr' ? 'Türkçe' : 'English';
    const prompt = `Sen bir dating uygulaması için kişisel soru oluşturucususun.

Kurallar:
- Sorular kişisel olmalı, Google'da aranamaz olmalı
- Her sorunun 4 şıkkı ve 1 doğru cevabı olmalı
- Sorular eğlenceli, flörtöz veya kişilik yansıtıcı olmalı
- ${lang} dilinde yaz
- JSON formatında dön

Profil bilgisi: ${context || 'Genel profil'}

${count} adet soru üret. Her soru için:
{
  "question_text": "soru metni",
  "answers": ["şık1", "şık2", "şık3", "şık4"],
  "correct_answer": 1,
  "hint": "ipucu (opsiyonel)",
  "category": "personality"
}

Sadece JSON array dön, başka bir şey yazma: [...]`;

    const response = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 2048 },
      }),
    });

    if (!response.ok) throw Errors.SERVER_ERROR();

    const result = await response.json() as any;
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const suggestions = JSON.parse(cleaned);
      return Array.isArray(suggestions) ? suggestions.slice(0, count) : [];
    } catch {
      return [];
    }
  }

  private async generateAndCache(category: string, locale: string, count: number) {
    const suggestions = await this.callGemini(`Kategori: ${category}`, locale, count);

    for (const s of suggestions) {
      await supabase.from('ai_question_suggestions').insert({
        category,
        question_text: s.question_text,
        answers: s.answers,
        correct_answer: s.correct_answer,
        hint: s.hint ?? null,
        locale,
      }); // ignore errors silently
    }

    return suggestions;
  }
}

export const aiSuggestService = new AiSuggestService();
