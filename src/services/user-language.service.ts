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
   * Listeyi tek transaction'da degistirir (`set_user_languages`, migration 043 + 054):
   * user_languages tablosu VE users.preferred_languages sutunu birlikte yazilir.
   * Dil listesine yazan TEK yol budur — tabloya/sutuna dogrudan yazma.
   * Eski delete+insert deseninde insert patlayinca kullanicinin dilleri silinmis kaliyordu.
   */
  async setUserLanguages(userId: string, languages: SupportedLocale[]): Promise<string[]> {
    const { data, error } = await supabase.rpc('set_user_languages', {
      p_user_id: userId,
      p_languages: languages,
    });

    if (error) {
      console.error('[user-language] set_user_languages rpc error:', error);
      throw Errors.SERVER_ERROR();
    }

    // 054 sonrasi RPC nihai listeyi doner (uygulama dili eklenmis, tekillesmis).
    return Array.isArray(data) ? (data as string[]) : languages;
  }

  /**
   * PATCH /me sonrasi senkronlanacak liste; senkron gerekmiyorsa null.
   * Kural (DB fonksiyonuyla ayni): uygulama dili her zaman listede, tekrarlar
   * sira korunarak duser. Burada da uygulanir ki gereksiz RPC olmasin ve yanit
   * senkron sonucunu tasisin.
   */
  languagesToSync(
    data: { preferred_languages?: readonly string[]; locale?: string },
    current: readonly string[] | null,
  ): SupportedLocale[] | null {
    const hasLocale = data.locale !== undefined;
    const base = data.preferred_languages ?? (hasLocale ? (current ?? []) : null);
    if (!base) return null;
    const merged = [...new Set(hasLocale ? [...base, data.locale as string] : base)];
    if (!data.preferred_languages && merged.length === (current ?? []).length) return null;
    return merged as SupportedLocale[];
  }
}

export const userLanguageService = new UserLanguageService();
