/**
 * Снимок бандлов polemicagame.com и журнал их версий (просьба владельца
 * 16.11.2026: «сохраним версии бандлов и будем хранить историю изменений»).
 *
 * До этого история жила случайно: sha в фикстуре контракта не обновлялись с
 * августа, а копии бандлов лежали во временных папках сессий и пропадали.
 * На вопрос «что сайт поменял между двумя датами» ответить было нечем.
 *
 * Две части:
 *  - docs/site-history.json — журнал (в git): url, sha256, размер, дата
 *    выкладки по Last-Modified сервера и день, когда версию увидели мы;
 *  - site-history/ — сами файлы в gzip (ВНЕ git, см. .gitignore): репозиторий
 *    публичный, а это чужой код, и по 4 МБ на каждую выкладку сайта истории
 *    репозитория не нужны.
 *
 * Запуск:
 *   npm run site:snapshot                  скачать, сравнить, сохранить новое
 *   npm run site:snapshot -- --log         показать журнал, без сети
 *   npm run site:snapshot -- --diff <имя>  чем две последние сохранённые
 *                                          версии отличаются по строкам
 *
 * Скачанное — недоверенные данные: только пишем на диск и читаем как текст,
 * ничего не исполняем.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOURNAL_PATH = path.join(ROOT, "docs/site-history.json");
const ARCHIVE_DIR = path.join(ROOT, "site-history");
const ORIGIN = "https://polemicagame.com";

/**
 * За чем следим. Первые строки — то, что читает расширение (те же имена, что
 * в tests/fixtures/site-contract.json); остальное — соседние страницы сайта,
 * чтобы выкладка была видна целиком.
 */
export const WATCHED = {
  gameSearch: "/bundle/game-search.js",
  roomMain: "/room/bundle/main.js",
  profile: "/bundle/profile.js",
  ratingPage: "/bundle/rating.js",
  localeRu: "/room/bundle/locales/RU.js",
  localeEn: "/room/bundle/locales/EN.js",
  mainCss: "/bundle/main.css",
  roomCss: "/room/bundle/style.css",
  siteMain: "/bundle/main.js",
  lobby: "/bundle/lobby.js",
  games: "/bundle/games.js",
  home: "/bundle/home.js",
  gameSearchCss: "/bundle/game-search.css",
  ratingCss: "/bundle/rating.css",
  profileCss: "/bundle/profile.css",
  lobbyCss: "/bundle/lobby.css",
};

const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;
/** Потолок вывода --diff на каждую сторону: бандл в одну строку, отличий бывают тысячи. */
const DIFF_LIMIT = 60;

export function sha256Of(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function emptyJournal() {
  return { schemaVersion: 1, files: {} };
}

/**
 * Записать наблюдение в журнал. Новая версия — когда sha отличается от
 * ПОСЛЕДНЕЙ записи: откат сайта к старой сборке тоже событие, и в истории
 * он должен быть виден отдельной строкой.
 * Возвращает true, если версия новая.
 */
export function recordVersion(journal, key, url, observed) {
  const entry = (journal.files[key] ??= { url, versions: [] });
  entry.url = url;
  const last = entry.versions[entry.versions.length - 1];
  if (last && last.sha256 === observed.sha256) return false;
  entry.versions.push({
    sha256: observed.sha256,
    bytes: observed.bytes,
    lastModified: observed.lastModified,
    seen: observed.seen,
  });
  return true;
}

/** Имя файла в архиве: дата выкладки (или дня наблюдения) + начало sha. */
export function archiveName(url, version) {
  const day = (version.lastModified || version.seen || "").slice(0, 10) || "unknown";
  const ext = path.extname(new URL(url, ORIGIN).pathname) || ".bin";
  return `${day}_${version.sha256.slice(0, 12)}${ext}.gz`;
}

/**
 * Строковые литералы бандла. Минифицированный файл — одна строка, построчный
 * diff бесполезен; а вот появившиеся и пропавшие строки (классы, события
 * сокета, тексты, пути API) показывают суть выкладки.
 *
 * Проход посимвольный, а не регуляркой: регулярка с нижней границей длины
 * принимала закрывающую кавычку пустой строки `""` за открывающую и дальше
 * читала файл «наизнанку» (поймано на EN.js при первой же проверке).
 * Это подсказка, а не парсер JS: кавычка внутри регулярного выражения может
 * сбить проход, но мусор тогда одинаков в обеих версиях и в разнице гасится.
 */
const LITERAL_MIN = 3;
const LITERAL_MAX = 200;
/** Закрывающей кавычки нет так далеко — это была не строка, идём дальше. */
const LITERAL_SCAN_MAX = 5000;

export function literalsOf(text) {
  const out = new Set();
  let i = 0;
  while (i < text.length) {
    const quote = text[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") {
      i++;
      continue;
    }
    let end = -1;
    const stop = Math.min(text.length, i + 1 + LITERAL_SCAN_MAX);
    for (let j = i + 1; j < stop; j++) {
      const c = text[j];
      if (c === "\\") j++;
      else if (c === quote) {
        end = j;
        break;
      } else if (c === "\n" && quote !== "`") break;
    }
    if (end === -1) {
      i++;
      continue;
    }
    const body = text.slice(i + 1, end);
    if (body.length >= LITERAL_MIN && body.length <= LITERAL_MAX) out.add(body);
    i = end + 1;
  }
  return out;
}

export function literalDiff(oldText, newText) {
  const before = literalsOf(oldText);
  const after = literalsOf(newText);
  return {
    added: [...after].filter((s) => !before.has(s)).sort(),
    removed: [...before].filter((s) => !after.has(s)).sort(),
  };
}

function readJournal() {
  if (!fs.existsSync(JOURNAL_PATH)) return emptyJournal();
  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8"));
  if (journal?.schemaVersion !== 1 || typeof journal.files !== "object") {
    throw new Error("docs/site-history.json: незнакомый формат — руками не чинить вслепую, сверить с git");
  }
  return journal;
}

function writeJournal(journal) {
  fs.writeFileSync(JOURNAL_PATH, `${JSON.stringify(journal, null, 2)}\n`);
}

function archivePath(key, url, version) {
  return path.join(ARCHIVE_DIR, key, archiveName(url, version));
}

async function download(url) {
  let last = "";
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (response.status === 404) throw Object.assign(new Error("HTTP 404"), { final: true });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Заглушка nginx/WAF с кодом 200 — не новая версия бандла.
      const type = response.headers.get("content-type") || "";
      if (!/javascript|css/.test(type)) throw new Error(`неожиданный content-type «${type}»`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const modified = Date.parse(response.headers.get("last-modified") || "");
      return {
        bytes,
        lastModified: Number.isFinite(modified) ? new Date(modified).toISOString() : undefined,
      };
    } catch (error) {
      last = String(error?.message || error);
      if (error?.final) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(last);
}

function shortDate(iso) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

async function snapshot() {
  const journal = readJournal();
  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.all(
    Object.entries(WATCHED).map(async ([key, pathname]) => {
      const url = ORIGIN + pathname;
      try {
        return { key, url, ...(await download(url)) };
      } catch (error) {
        return { key, url, error: String(error?.message || error) };
      }
    }),
  );

  let changed = 0;
  let failed = 0;
  for (const { key, url, bytes, lastModified, error } of results) {
    if (error) {
      failed++;
      console.log(`  ✗ ${key.padEnd(14)} не скачался: ${error}`);
      continue;
    }
    const known = journal.files[key]?.versions.length ?? 0;
    const observed = { sha256: sha256Of(bytes), bytes: bytes.length, lastModified, seen: today };
    const isNew = recordVersion(journal, key, url, observed);
    const versions = journal.files[key].versions;
    const current = versions[versions.length - 1];
    // Архив дописываем и для уже известной версии: журнал приезжает из git,
    // а папка с файлами на новой машине пуста.
    const file = archivePath(key, url, current);
    let saved = false;
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, zlib.gzipSync(bytes, { level: 9 }));
      saved = true;
    }
    if (isNew && known > 0) changed++;
    const mark = isNew ? (known > 0 ? "● ИЗМЕНИЛСЯ" : "+ первый снимок") : "  без изменений";
    console.log(
      `  ${mark.padEnd(16)} ${key.padEnd(14)} ${current.sha256.slice(0, 12)}  ${String(bytes.length).padStart(8)} Б  выложен ${shortDate(current.lastModified)}${saved ? "  → в архив" : ""}`,
    );
  }
  writeJournal(journal);

  console.log("");
  if (changed) {
    console.log(`Изменилось файлов: ${changed}. Что именно: npm run site:snapshot -- --diff <имя>`);
    console.log("Журнал docs/site-history.json обновлён — закоммитить вместе с разбором выкладки.");
  } else {
    console.log("Сайт не менялся с прошлого снимка.");
  }
  if (failed) {
    console.log(`Не скачалось: ${failed} — их записи в журнале не тронуты.`);
    process.exitCode = 1;
  }
}

function printLog() {
  const journal = readJournal();
  for (const [key, entry] of Object.entries(journal.files)) {
    console.log(`${key}  ${entry.url}`);
    for (const v of entry.versions) {
      const local = fs.existsSync(archivePath(key, entry.url, v)) ? "в архиве" : "нет копии";
      console.log(
        `  ${shortDate(v.lastModified).padEnd(16)} увидели ${v.seen}  ${v.sha256.slice(0, 12)}  ${String(v.bytes ?? "?").padStart(8)} Б  ${local}${v.note ? `  (${v.note})` : ""}`,
      );
    }
  }
}

function printDiff(key) {
  const journal = readJournal();
  const entry = journal.files[key];
  if (!entry) {
    throw new Error(`нет «${key}» в журнале; есть: ${Object.keys(journal.files).join(", ")}`);
  }
  const archived = entry.versions.filter((v) => fs.existsSync(archivePath(key, entry.url, v)));
  if (archived.length < 2) {
    console.log(`У «${key}» сохранена ${archived.length} версия из ${entry.versions.length} — сравнивать не с чем.`);
    return;
  }
  const [older, newer] = archived.slice(-2);
  const read = (v) => zlib.gunzipSync(fs.readFileSync(archivePath(key, entry.url, v))).toString("utf8");
  const { added, removed } = literalDiff(read(older), read(newer));
  console.log(`${key}: ${shortDate(older.lastModified)} (${older.sha256.slice(0, 12)}) → ${shortDate(newer.lastModified)} (${newer.sha256.slice(0, 12)})`);
  console.log(`размер: ${older.bytes} → ${newer.bytes} Б (${newer.bytes - older.bytes >= 0 ? "+" : ""}${newer.bytes - older.bytes})`);
  for (const [title, list] of [["появились строки", added], ["пропали строки", removed]]) {
    console.log(`\n${title}: ${list.length}`);
    for (const s of list.slice(0, DIFF_LIMIT)) console.log(`  ${s.length > 160 ? `${s.slice(0, 160)}…` : s}`);
    if (list.length > DIFF_LIMIT) console.log(`  … и ещё ${list.length - DIFF_LIMIT}`);
  }
  console.log(`\nПолные файлы: site-history/${key}/ (gunzip -c <файл>)`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--log")) return printLog();
  const diffAt = args.indexOf("--diff");
  if (diffAt !== -1) {
    const key = args[diffAt + 1];
    if (!key) throw new Error("после --diff нужно имя файла из журнала, например gameSearch");
    return printDiff(key);
  }
  if (args.length) throw new Error(`незнакомый аргумент: ${args.join(" ")}`);
  await snapshot();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`site-snapshot: ${error?.message || error}`);
    process.exit(1);
  });
}
