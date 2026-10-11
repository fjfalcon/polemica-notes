/** Сборка файла бэкапа для экспорта в попапе. */
import { browser } from "@core/env";
import { getSettings } from "@core/settings";
import { loadNotes } from "@core/notes-store";

/** null = заметки не прочитались: выгружать пустую карту как бэкап нельзя. */
export async function collectBackup(): Promise<{ payload: Record<string, unknown>; count: number } | null> {
  // Палитра — из loadNotes(): до переноса из sync это объединённый вид local + sync.
  const { notes, customTags, loadFailed } = await loadNotes();
  if (loadFailed) return null;
  const settings = await getSettings();
  // Пароль OBS в файл не кладём: бэкап уезжает в облака и мессенджеры.
  const { obs_password: _pw, ...safeSettings } = settings;
  const extra = (await browser.storage.local.get({
    pn_muted_players: [],
    pn_hidden_players: [],
    roleMarks: {},
  })) as Record<string, unknown>;
  const payload = {
    app: "polemica-notes",
    type: "notes-backup",
    version: browser.runtime.getManifest().version,
    exportedAt: new Date().toISOString(),
    settings: safeSettings,
    notes,
    customTags,
    mutedPlayers: Array.isArray(extra.pn_muted_players) ? extra.pn_muted_players : [],
    hiddenPlayers: Array.isArray(extra.pn_hidden_players) ? extra.pn_hidden_players : [],
    roleMarks: extra.roleMarks && typeof extra.roleMarks === "object" ? extra.roleMarks : {},
  };
  return { payload, count: Object.keys(notes).length };
}
