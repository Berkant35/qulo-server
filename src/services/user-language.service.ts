import { supabase } from '../config/supabase.js';
import type { SupportedLocale } from '../constants/locales.js';
import { Errors } from '../utils/errors.js';

class UserLanguageService {
  async getUserLanguages(userId: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('user_languages')
      .select('language_code')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[user-language] getUserLanguages error:', error);
      throw Errors.SERVER_ERROR();
    }
    return (data || []).map((row: { language_code: string }) => row.language_code);
  }

  /**
   * Listeyi tek transaction'da degistirir (migration 043 `set_user_languages`).
   * Eski delete+insert deseninde insert patlayinca kullanicinin dilleri silinmis kaliyordu.
   */
  async setUserLanguages(userId: string, languages: SupportedLocale[]): Promise<string[]> {
    const { error } = await supabase.rpc('set_user_languages', {
      p_user_id: userId,
      p_languages: languages,
    });

    if (error) {
      console.error('[user-language] set_user_languages rpc error:', error);
      throw Errors.SERVER_ERROR();
    }

    return languages;
  }

  async addLanguage(userId: string, language: SupportedLocale): Promise<void> {
    await supabase
      .from('user_languages')
      .upsert({ user_id: userId, language_code: language }, { onConflict: 'user_id,language_code' });
  }
}

export const userLanguageService = new UserLanguageService();
