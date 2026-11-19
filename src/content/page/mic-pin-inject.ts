/**
 * Ранний инжектор перехвата микрофона (content-скрипт, document_start).
 *
 * Отдельный скрипт, потому что основной content.js грузится на document_end,
 * а обёртка должна стоять к первому запросу микрофона. Комната делает его не
 * при выполнении бандла, а после ответа сервера с данными игры — этого запаса
 * и хватает: `async=false` упорядочивает наш тег только среди динамических
 * скриптов и разбор страницы НЕ блокирует. Жёсткой гарантии нет и не нужно:
 * опоздавшая обёртка просто пропустит первый запрос (см. mic-pin-page), а
 * content/mic-pin.ts запишет это в лог вердиктом «late».
 *
 * ГЕЙТ ПО НАСТРОЙКЕ обязателен: подменять getUserMedia у всех подряд нельзя.
 * «Брать только выбранный микрофон» ВЫКЛЮЧЕНА по умолчанию — значит по
 * умолчанию API браузера на сайте никто не трогает. `storage` асинхронный,
 * поэтому решение читается синхронно из зеркала в localStorage страницы
 * (пишет content/mic-pin.ts, учитывая и главный выключатель расширения).
 *
 * ИЗВЕСТНОЕ ОКНО. Зеркало обновляет только content.js открытой вкладки сайта.
 * Если опцию (или всё расширение) выключили, когда вкладок сайта не было,
 * ключ «1» доживёт до следующей загрузки игры: обёртка встанет, а content.js
 * через мгновение ключ уберёт — и она перестанет что-либо менять (флаг
 * перечитывается на каждом запросе). Зеркально: включили без вкладок сайта —
 * первая загрузка игры пройдёт без обёртки.
 *
 * Никаких импортов из core/*: см. шапку room-probe-inject.ts.
 */
import { micPinAllowed } from "@shared/mic-pin";
import { isGameRoomPath } from "@shared/routes";

const MARK = "data-pn-mic-pin-inject";

/** Сам доступ к localStorage бросает там, где хранилище запрещено политикой. */
function pageStore(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Экспорт — тестовый шов: гейт обязан быть покрыт мутационно. */
export function injectMicPin(): void {
  // Манифест матчит `/game*` — это ещё и страница поиска `/game-search`,
  // где микрофон не запрашивают. Обёртка нужна только в комнате.
  if (!isGameRoomPath(location.pathname)) return;
  if (!micPinAllowed(pageStore())) return;
  if (document.querySelector(`script[${MARK}]`)) return;
  const runtime = (globalThis as { browser?: typeof chrome; chrome?: typeof chrome }).browser
    ?.runtime ?? (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!runtime?.getURL) return;
  const s = document.createElement("script");
  s.setAttribute(MARK, "");
  s.async = false;
  s.src = runtime.getURL("mic-pin-page.js");
  // Тег нужен только на время загрузки: лишний узел в <html> мешал бы сайту.
  s.onload = () => s.remove();
  s.onerror = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
}

injectMicPin();
