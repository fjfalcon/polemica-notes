/**
 * «Брать только выбранный микрофон» — PAGE-скрипт (мир страницы).
 *
 * Оборачивает navigator.mediaDevices.getUserMedia: запрос микрофона без
 * конкретного устройства получает deviceId, сохранённый сайтом в настройках
 * устройств комнаты. Зачем и почему именно так — шапка @shared/mic-pin.
 *
 * Из мира content-скрипта это невозможно: у изолированного мира свой
 * navigator, и вызовы сайта через него не проходят.
 *
 * НЕ ЛОМАТЬ САЙТ — камера и микрофон игрока важнее профиля наушников:
 *  - запрос, который мы НЕ меняли, уходит браузеру как был, тем же объектом;
 *  - любая наша ошибка — то же самое;
 *  - изменённый запрос отвергнут (сохранённый микрофон в списке есть, но не
 *    открывается) — повторяем исходный запрос сайта, кроме отказа в
 *    разрешении. Без этого окно настроек устройств посреди игры ходило бы по
 *    кругу «попробуйте ещё раз» (ревью 19.11.2026);
 *  - объект ограничений сайта не меняем (копия), `this` и результат — как у
 *    оригинала;
 *  - устройство, названное сайтом явно (выбор в окне настроек), не трогаем.
 *
 * Ставится ТОЛЬКО при включённой настройке (по умолчанию выключена, гейт в
 * mic-pin-inject). Флаг перечитывается на каждом запросе: выключение опции
 * действует сразу, без перезагрузки игры.
 *
 * Сайт зовёт navigator.mediaDevices.getUserMedia в момент запроса и ссылку
 * заранее не сохраняет (сверено по бандлу 12.11.2026), поэтому обёртка,
 * вставшая позже бандла, но раньше первого запроса, работает. Опоздала и к
 * нему — первый запрос просто уйдёт как раньше; сломаться нечему.
 *
 * Наружу — только счётчики на <html> (для лога расширения). Ни deviceId, ни
 * названий устройств скрипт никуда не отдаёт.
 */
import {
  MIC_PIN_STATE_ATTR,
  SITE_MIC_KEY,
  emptyMicPinCounts,
  formatMicPinState,
  micPinAllowed,
  pinAudioConstraints,
  shouldRetryUnpinned,
} from "@shared/mic-pin";

interface PinWindow extends Window {
  __pnMicPinInstalled?: boolean;
}

/**
 * Выдал ли браузер именно тот микрофон, который мы просили. `ideal` — мягкое
 * ограничение: если устройства в системе нет, придёт системное, и без этой
 * сверки лог говорил бы «перенаправлено», когда на деле ничего не сработало.
 * Браузер deviceId не сообщил — не гадаем, считаем попаданием.
 */
function landedOn(stream: unknown, micId: string): boolean {
  const track = (stream as MediaStream | null)?.getAudioTracks?.()[0];
  const actual = track?.getSettings?.().deviceId;
  return typeof actual !== "string" || actual === "" || actual === micId;
}

(() => {
  const w = window as PinWindow;
  if (w.__pnMicPinInstalled) return;
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  // http-страница или древний браузер: API нет — оборачивать нечего.
  if (!devices || typeof devices.getUserMedia !== "function") return;
  w.__pnMicPinInstalled = true;

  const original = devices.getUserMedia;
  // Ставим обёртку там же, где метод живёт (в браузере — на прототипе). Своё
  // свойство на экземпляре заслонило бы тех, кто патчит прототип ПОСЛЕ нас
  // (расширения виртуальных камер), и их подмена перестала бы работать.
  let holder: object = devices;
  for (let o: object | null = devices; o; o = Object.getPrototypeOf(o)) {
    if (Object.prototype.hasOwnProperty.call(o, "getUserMedia")) {
      holder = o;
      break;
    }
  }
  const counts = emptyMicPinCounts();
  const publish = (): void => {
    try {
      document.documentElement.setAttribute(MIC_PIN_STATE_ATTR, formatMicPinState(counts));
    } catch {
      /* документа ещё нет — счётчик допишется на следующем запросе */
    }
  };

  (holder as { getUserMedia: unknown }).getUserMedia = function getUserMedia(
    this: MediaDevices,
    ...args: [constraints?: MediaStreamConstraints]
  ): Promise<MediaStream> {
    let pinned: unknown[] | null = null;
    let micId = "";
    try {
      if (args.length > 0 && micPinAllowed(localStorage)) {
        const result = pinAudioConstraints(args[0], localStorage.getItem(SITE_MIC_KEY));
        if (result.outcome === "pinned" && result.micId) {
          counts.pinned++;
          micId = result.micId;
          pinned = [result.constraints, ...args.slice(1)];
        } else if (result.outcome === "explicit") counts.explicit++;
        else if (result.outcome === "no-saved") counts.noSaved++;
        if (result.outcome !== "no-audio") publish();
      }
    } catch {
      pinned = null;
    }
    // Запрос не меняли — ни одной нашей строчки между сайтом и браузером.
    if (!pinned) return original.apply(this, args);

    // Повтор — ровно тот запрос, который сделал бы сайт. В счётчик он идёт,
    // только если прошёл: иначе занятая КАМЕРА (оба запроса отвергнуты)
    // читалась бы в логе как «микрофон недоступен».
    const retryAsAsked = (): Promise<MediaStream> => {
      const retried = original.apply(this, args);
      if (!retried || typeof retried.then !== "function") return retried;
      return retried.then((stream) => {
        counts.fallback++;
        publish();
        return stream;
      });
    };
    let attempt: Promise<MediaStream>;
    try {
      attempt = original.apply(this, pinned as [MediaStreamConstraints?]);
    } catch {
      return retryAsAsked();
    }
    if (!attempt || typeof attempt.then !== "function") return attempt;
    return attempt.then(
      (stream) => {
        try {
          if (landedOn(stream, micId)) counts.landed++;
          else counts.missed++;
          publish();
        } catch {
          /* сверка — только для лога */
        }
        return stream;
      },
      (error: unknown) => {
        if (!shouldRetryUnpinned(error)) throw error;
        return retryAsAsked();
      },
    );
  };

  publish();
})();
