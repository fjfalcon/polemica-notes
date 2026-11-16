/** Типы чистых функций site-snapshot.mjs — для tests/unit/site-snapshot.test.ts. */
export interface SiteVersion {
  sha256: string;
  bytes?: number;
  lastModified?: string;
  seen: string;
  note?: string;
}
export interface SiteJournal {
  schemaVersion: 1;
  files: Record<string, { url: string; versions: SiteVersion[] }>;
}
export const WATCHED: Record<string, string>;
export function sha256Of(bytes: Uint8Array): string;
export function emptyJournal(): SiteJournal;
export function recordVersion(journal: SiteJournal, key: string, url: string, observed: SiteVersion): boolean;
export function archiveName(url: string, version: SiteVersion): string;
export function literalsOf(text: string): Set<string>;
export function literalDiff(oldText: string, newText: string): { added: string[]; removed: string[] };
