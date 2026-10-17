import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";
import {
  SETTING_KEYS,
  SETTING_META,
  mergeSettingValue,
  readAttendanceSettings,
  readPrivacyNotice,
  readRetention,
  type AttendanceSettings,
  type DemoCounts,
  type PrivacyNotice,
  type RetentionSettings,
  type SettingKey,
} from "./settings";

export type LoadedSettings = {
  privacy: PrivacyNotice;
  privacyUpdatedAt: string | null;
  retention: RetentionSettings;
  attendance: AttendanceSettings;
};

export async function loadSettings(supabase: ServerSupabase): Promise<LoadedSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value, updated_at")
    .in("key", [SETTING_KEYS.privacy, SETTING_KEYS.retention, SETTING_KEYS.attendance]);
  if (error) throw new Error(error.message);
  const byKey = new Map((data ?? []).map((row) => [row.key, row]));
  const privacyRow = byKey.get(SETTING_KEYS.privacy);
  return {
    privacy: readPrivacyNotice(privacyRow?.value),
    privacyUpdatedAt: privacyRow?.updated_at ?? null,
    retention: readRetention(byKey.get(SETTING_KEYS.retention)?.value),
    attendance: readAttendanceSettings(byKey.get(SETTING_KEYS.attendance)?.value),
  };
}

/** Conteo de filas de demostración (is_demo). */
export async function loadDemoCounts(supabase: ServerSupabase): Promise<DemoCounts> {
  const count = async (table: "facilities" | "workers" | "shifts") => {
    const { count: n, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("is_demo", true);
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const [facilities, workers, shifts] = await Promise.all([count("facilities"), count("workers"), count("shifts")]);
  return { facilities, workers, shifts };
}

type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };

/**
 * Guarda un valor de configuración conservando claves desconocidas. RLS solo
 * permite escribir a administración. Devuelve el error (o null).
 */
export async function saveSettingValue(
  supabase: ServerSupabase,
  key: SettingKey,
  next: Record<string, string | number | boolean | null>,
): Promise<DbError | null> {
  const { data: current, error: readError } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (readError) return readError;
  const value = mergeSettingValue(current?.value, next) as { [k: string]: Json | undefined };

  if (current) {
    const { data, error } = await supabase.from("app_settings").update({ value }).eq("key", key).select("key");
    if (error) return error;
    if (!data || data.length === 0) return { message: "No tienes permiso para realizar esta acción.", code: "42501" };
    return null;
  }
  const meta = SETTING_META[key];
  const { error } = await supabase.from("app_settings").insert({ key, value, description: meta.description, is_public: meta.isPublic });
  return error ?? null;
}
