/**
 * Приписка под опцией «Брать только выбранный микрофон» для Firefox на macOS:
 * там опция отключена (см. isFirefoxOnMac в @shared/mic-pin). В разметке
 * строка скрыта и исключена из поиска; здесь она открывается и возвращается
 * в поиск — только при обоих признаках.
 */
import { isFirefoxOnMac, type BrowserSigns } from "@shared/mic-pin";

export const MIC_PIN_NOTE_ROW_ID = "mic_pin_firefox_row";

export function showFirefoxMacMicNote(doc: Document, signs: BrowserSigns): boolean {
  if (!isFirefoxOnMac(signs)) return false;
  const row = doc.getElementById(MIC_PIN_NOTE_ROW_ID);
  if (!row) return false;
  row.style.display = "";
  delete row.dataset.search;
  return true;
}
