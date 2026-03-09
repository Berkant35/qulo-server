import { supabase } from "../config/supabase.js";

interface AppConfigRow {
  id: string;
  min_version_ios: string;
  min_version_android: string;
  latest_version_ios: string;
  latest_version_android: string;
  store_url_ios: string;
  store_url_android: string;
  is_maintenance: boolean;
  maintenance_message_tr: string | null;
  maintenance_message_en: string | null;
  is_force_update_enabled: boolean;
  updated_at: string;
}

class AppConfigService {
  async getConfig(platform: "ios" | "android", locale: string) {
    const { data, error } = await supabase
      .from("app_config")
      .select("*")
      .limit(1)
      .single();

    if (error || !data) {
      return {
        minVersion: "0.0.0",
        latestVersion: "0.0.0",
        storeUrl: "",
        isMaintenance: false,
        maintenanceMessage: null,
        isForceUpdateEnabled: false,
      };
    }

    const row = data as AppConfigRow;
    const isIos = platform === "ios";
    const lang = locale.startsWith("tr") ? "tr" : "en";

    return {
      minVersion: isIos ? row.min_version_ios : row.min_version_android,
      latestVersion: isIos ? row.latest_version_ios : row.latest_version_android,
      storeUrl: isIos ? row.store_url_ios : row.store_url_android,
      isMaintenance: row.is_maintenance,
      maintenanceMessage: row.is_maintenance
        ? (lang === "tr" ? row.maintenance_message_tr : row.maintenance_message_en)
        : null,
      isForceUpdateEnabled: row.is_force_update_enabled,
    };
  }

  async updateConfig(updates: Partial<Omit<AppConfigRow, "id" | "updated_at">>) {
    const { data, error } = await supabase
      .from("app_config")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .select("*")
      .limit(1)
      .single();

    if (error) throw error;
    return data;
  }
}

export const appConfigService = new AppConfigService();
