import { supabase } from '../config/supabase.js';
import type { SupportedLocale } from '../constants/locales.js';

class UserLanguageService {
  async getUserLanguages(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('user_languages')
      .select('language_code')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map((row: { language_code: string }) => row.language_code);
  }

  async setUserLanguages(userId: string, languages: SupportedLocale[]): Promise<string[]> {
    // Delete all existing languages
    const { error: deleteError } = await supabase
      .from('user_languages')
      .delete()
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    // Insert new languages
    const rows = languages.map(lang => ({
      user_id: userId,
      language_code: lang,
    }));

    const { error: insertError } = await supabase
      .from('user_languages')
      .insert(rows);

    if (insertError) throw insertError;

    return languages;
  }

  async addLanguage(userId: string, language: SupportedLocale): Promise<void> {
    await supabase
      .from('user_languages')
      .upsert({ user_id: userId, language_code: language }, { onConflict: 'user_id,language_code' });
  }
}

export const userLanguageService = new UserLanguageService();
