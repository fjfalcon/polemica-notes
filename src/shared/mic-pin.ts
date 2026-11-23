/**
 * «Брать только выбранный микрофон» — общая чистая логика (просьба владельца
 * 19.11.2026: Bluetooth-наушники + микрофон макбука).
 *
 * Что болит. macOS переводит Bluetooth-наушники из A2DP в гарнитурный режим
 * («телефонный» звук), как только кто-то открывает МИКРОФОН НАУШНИКОВ. Комната
 * сайта при входе делает getUserMedia({audio:true, video:…}) — микрофон «по
 * умолчанию» — только ради списка устройств, и лишь вторым запросом берёт
 * сохранённый (room/bundle/main.js от 12.11.2026: tryGetUserMedia →
 * getAvailableSources → getUserMedia). Если системный вход в этот момент — наушники, профиль
 * падает на каждом входе в игру, хотя в настройках сайта выбран микрофон
 * макбука.
 *
 * Что делаем. В мире страницы оборачиваем getUserMedia: запрос микрофона БЕЗ
 * конкретного устройства получает deviceId того микрофона, который сайт сам
 * сохранил в localStorage (`audioSourceId`, пишет окно настроек устройств
 * комнаты). Своего выбора устройства у расширения нет — источник правды один,
 * сайт.
 *
 * `ideal`, а не `exact`: если сохранённого микрофона уже нет (отключили),
 * браузер молча возьмёт системный — игра важнее профиля наушников. С `exact`
 * запрос упал бы OverconstrainedError, и сайт показал бы ошибку устройств.
 * Если же микрофон в списке есть, но не открывается (занят, отвалился после
 * сна), page-скрипт повторяет запрос в исходном виде — см. shouldRetryUnpinned.
 *
 * Модуль без зависимостей: его тянут ранний инжектор (document_start) и
 * page-скрипт, которым нельзя полифилл и core/*.
 */

/** Зеркало настройки `mic_pin_enabled` в localStorage страницы (пишет content.js). */
export const MIC_PIN_FLAG_KEY = "pn_mic_pin";
/** Ключ САЙТА: deviceId микрофона, выбранного в настройках устройств комнаты. */
export const SITE_MIC_KEY = "audioSourceId";
/** Счётчики перехвата на <html> — читает content-скрипт для лога. */
export const MIC_PIN_STATE_ATTR = "data-pn-mic-pin";

/** deviceId — непрозрачная строка браузера; длиннее не бывает, а localStorage пишет и сайт. */
const DEVICE_ID_MAX = 512;

export type MicPinOutcome =
  /** Микрофон не запрашивали (только видео) — не наше дело. */
  | "no-audio"
  /** Сайт сам назвал устройство — уважаем его выбор. */
  | "explicit"
  /** Запрос был «по умолчанию», а на сайте микрофон не выбран (пусто или «default») — подставить нечего. */
  | "no-saved"
  /** Запрос «по умолчанию» перенаправлен на сохранённый микрофон. */
  | "pinned";

/**
 * Читать флаг без падений: приватный режим запрещает localStorage целиком.
 * Ключа нет — настройка выключена (её дефолт), перехват не ставим.
 */
export function micPinAllowed(store: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return store?.getItem(MIC_PIN_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function isNamedId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Назвал ли сайт устройство сам (строка, список, exact/ideal).
 * «default» здесь тоже считается названным: так окно настроек комнаты
 * запрашивает строку «по умолчанию», если игрок выбрал в списке именно её, —
 * это его явный выбор, и подменять его нельзя.
 */
export function hasConcreteDevice(deviceId: unknown): boolean {
  if (isNamedId(deviceId)) return true;
  if (Array.isArray(deviceId)) return deviceId.some(isNamedId);
  if (deviceId && typeof deviceId === "object") {
    const d = deviceId as { exact?: unknown; ideal?: unknown };
    return hasConcreteDevice(d.exact) || hasConcreteDevice(d.ideal);
  }
  return false;
}

/**
 * Псевдоустройства Chrome: «default» — системный вход, «communications» —
 * устройство связи Windows. Подставлять их бессмысленно: это и есть «какой
 * даст система», от которого опция уводит. Сайт сохраняет «default», если
 * игрок ни разу не выбрал микрофон сам: в Chrome эта строка первая в списке.
 */
const SYSTEM_CHOICE_IDS: ReadonlySet<string> = new Set(["default", "communications"]);

/** Сохранённый сайтом deviceId, если это настоящее устройство разумной длины. */
export function usableMicId(raw: unknown): string | null {
  return isNamedId(raw) && raw.length <= DEVICE_ID_MAX && !SYSTEM_CHOICE_IDS.has(raw) ? raw : null;
}

/**
 * Подставить сохранённый микрофон в запрос без устройства.
 * Чужой объект НЕ меняем: сайт переиспользует свои streamConstraints, и
 * правка «на месте» превратила бы его следующий запрос в наш.
 */
export function pinAudioConstraints(
  constraints: unknown,
  savedMicId: unknown,
): { constraints: unknown; outcome: MicPinOutcome; micId?: string } {
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
    return { constraints, outcome: "no-audio" };
  }
  const audio = (constraints as { audio?: unknown }).audio;
  if (audio === undefined || audio === null || audio === false) {
    return { constraints, outcome: "no-audio" };
  }
  let base: Record<string, unknown>;
  if (audio === true) {
    base = {};
  } else if (typeof audio === "object" && !Array.isArray(audio)) {
    const a = audio as Record<string, unknown>;
    // Старый синтаксис Chrome (mandatory/optional) с новым deviceId не
    // смешивается — браузер отвергает такой запрос целиком. Не трогаем.
    if ("mandatory" in a || "optional" in a) return { constraints, outcome: "explicit" };
    if (hasConcreteDevice(a.deviceId)) return { constraints, outcome: "explicit" };
    base = a;
  } else {
    // Непонятная форма — пусть её судит браузер, а не мы.
    return { constraints, outcome: "explicit" };
  }
  const micId = usableMicId(savedMicId);
  if (!micId) return { constraints, outcome: "no-saved" };
  return {
    constraints: { ...(constraints as object), audio: { ...base, deviceId: { ideal: micId } } },
    outcome: "pinned",
    micId,
  };
}

/**
 * Повторять ли запрос в исходном виде, если наш вариант отвергнут.
 *
 * Да — почти всегда: без повтора недоступный сохранённый микрофон оставил бы
 * игрока без устройств там, где сайт сам взял бы системный (ревью 19.11.2026:
 * окно настроек посреди игры уходило в «попробуйте ещё раз» по кругу).
 * Нет — только при отказе в разрешении: повтор показал бы запрос браузера
 * второй раз, а ответ игрока уже известен.
 */
export function shouldRetryUnpinned(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name !== "NotAllowedError" && name !== "SecurityError";
}

/** Счётчики запросов микрофона за жизнь страницы. */
export interface MicPinCounts {
  /** Запросов без устройства, в которые подставлен сохранённый микрофон (попыток). */
  pinned: number;
  /** Запросов, где устройство назвал сам сайт. */
  explicit: number;
  /** Запросов без устройства, когда на сайте микрофон не выбран. */
  noSaved: number;
  /** Из pinned: браузер выдал именно сохранённый микрофон. */
  landed: number;
  /** Из pinned: браузер выдал ДРУГОЙ микрофон (сохранённого нет в системе). */
  missed: number;
  /** Из pinned: наш запрос отвергнут, а повтор в исходном виде прошёл. */
  fallback: number;
}

export function emptyMicPinCounts(): MicPinCounts {
  return { pinned: 0, explicit: 0, noSaved: 0, landed: 0, missed: 0, fallback: 0 };
}

export function formatMicPinState(c: MicPinCounts): string {
  return `${c.pinned}:${c.explicit}:${c.noSaved}:${c.landed}:${c.missed}:${c.fallback}`;
}

/** Атрибут пишет page-скрипт, но <html> доступен и сайту — разбираем строго. */
export function parseMicPinState(raw: string | null | undefined): MicPinCounts | null {
  const m = /^(\d{1,9}):(\d{1,9}):(\d{1,9}):(\d{1,9}):(\d{1,9}):(\d{1,9})$/.exec(raw ?? "");
  if (!m) return null;
  return {
    pinned: Number(m[1]),
    explicit: Number(m[2]),
    noSaved: Number(m[3]),
    landed: Number(m[4]),
    missed: Number(m[5]),
    fallback: Number(m[6]),
  };
}

/**
 * Нужна ли в попапе приписка про настройку Firefox.
 *
 * Firefox на macOS ведёт микрофон через системный блок обработки голоса
 * (VPIO) в паре с устройством вывода. С Bluetooth-наушниками на выходе и
 * встроенным микрофоном на входе это ломается: наушники уходят в гарнитурный
 * режим, а микрофон в игре замолкает (жалобы владельца 20.11 и 23.11.2026).
 * Без нашей опции это маскирует сам сайт: поток, открытый ради списка
 * устройств, он не закрывает, тот держит системный микрофон (наушников), и
 * микрофон игры идёт вторым, уже без VPIO. Опция убирает этот случайный
 * костыль — значит, обязана сказать про настройку браузера
 * `media.getusermedia.microphone.prefer_voice_stream_with_processing.enabled`.
 * Прочитать или поменять её расширение не может.
 */
export function needsFirefoxMacMicNote(userAgent: string, os: string): boolean {
  return /\bFirefox\/\d/.test(userAgent) && os === "mac";
}
